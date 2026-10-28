import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { batchToolDefinitions, ToolApprovalStopped } from './batch-tools'
import { piProjectTools } from './pi-tools'
import { agentSystemPrompt } from './pi-system-prompt'
import { PLAN_READ_TOOLS } from './plan-tools'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function temporary() { const root = await mkdtemp(path.join(os.tmpdir(), 'pi-batch-')); roots.push(root); return root }
function fake(name: string, execute: any): ToolDefinition<any, any> { return { name, label: name, description: name, parameters: { type: 'object', properties: {} } as any, execute } }
function batch(name: string, execute: any) { return batchToolDefinitions(os.tmpdir(), [fake('read', execute), fake('download', execute)]).find(tool => tool.name === name)! }
const run = (tool: ToolDefinition<any, any>, items: any[], signal?: AbortSignal) => tool.execute('batch', { items }, signal, undefined, undefined as never)
const result = (text: string) => ({ content: [{ type: 'text' as const, text }], details: {} })

describe('批量文件工具', () => {
  it('接受 100 项，拒绝空列表或超过上限', async () => {
    const execute = vi.fn(async () => result('ok'))
    const tool = batch('read_many', execute)
    expect((await run(tool, Array.from({ length: 100 }, (_, i) => ({ path: `${i}` })))).details.results).toHaveLength(100)
    for (const items of [[], Array.from({ length: 101 }, () => ({ path: 'x' }))]) await expect(run(tool, items)).rejects.toThrow('1–100')
    expect(execute).toHaveBeenCalledTimes(100)
  })

  it('读取并发不超过 4，顺序与分段参数不变', async () => {
    let active = 0, maximum = 0
    const execute = vi.fn(async (_id, args) => {
      active++; maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, args.path === '0' ? 10 : 1)); active--
      return result(args.path)
    })
    const items = Array.from({ length: 9 }, (_, i) => ({ path: `${i}`, offset: 2, limit: 3 }))
    const output = await run(batch('read_many', execute), items)
    expect(maximum).toBe(4)
    expect(output.details.results.map((item: any) => item.path)).toEqual(items.map(item => item.path))
    expect(execute.mock.calls[0][1]).toEqual(items[0])
  })

  it('限制文本与图片，明确标记未返回内容', async () => {
    const tool = batch('read_many', async () => ({ content: [{ type: 'text', text: 'x'.repeat(150000) }, ...Array.from({ length: 5 }, () => ({ type: 'image', data: 'fake', mimeType: 'image/png' }))], details: { hidden: '不复制' } }))
    const output = await run(tool, Array.from({ length: 8 }, (_, i) => ({ path: `${i}` })))
    expect(output.content.filter((block: any) => block.type === 'image')).toHaveLength(8)
    expect(output.content.filter((block: any) => block.type === 'text' && /^x+$/.test(block.text)).reduce((sum: number, block: any) => sum + block.text.length, 0)).toBe(200000)
    expect(output.details.results.some((item: any) => item.status === 'output_limited')).toBe(true)
    expect(output.details.results[4].status).toBe('not_executed')
    expect(JSON.stringify(output.details)).not.toContain('不复制')
  })

  it('下载顺序执行，普通失败继续，重复路径在执行前拒绝', async () => {
    const execute = vi.fn(async (_id, args) => { if (args.path === 'bad') throw new Error('网络错误'); return result('ok') })
    const tool = batch('download_many', execute)
    const output = await run(tool, [{ path: 'a' }, { path: 'bad' }, { path: 'c' }])
    expect(output.details.results.map((item: any) => item.status)).toEqual(['success', 'failed', 'success'])
    execute.mockClear()
    await expect(run(tool, [{ path: 'a' }, { path: './a' }])).rejects.toThrow('重复')
    expect(execute).not.toHaveBeenCalled()
  })

  it('授权拒绝或取消后停止，保留先前结果', async () => {
    for (const cancel of [false, true]) {
      const controller = new AbortController()
      let calls = 0
      const tool = batch('download_many', async () => {
        if (++calls === 2) { if (cancel) controller.abort(); throw new ToolApprovalStopped('拒绝或取消') }
        return result('ok')
      })
      const output = await run(tool, ['a', 'b', 'c'].map(path => ({ path })), controller.signal)
      expect(output.details.results.map((item: any) => item.status)).toEqual(['success', 'failed', 'not_executed'])
      expect(calls).toBe(2)
    }
  })

  it('真实读取复用权限包装，敏感路径逐项拦截且不保存快照', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'data.prefab'), 'one\ntwo\nthree\n')
    const approve = vi.fn(), snapshot = vi.fn()
    const tools = piProjectTools(root, snapshot, { mode: 'auto', project: root, protectedDirectories: [], approve })
    const output = await run(tools.find(tool => tool.name === 'read_many')!, [{ path: 'data.prefab', offset: 2, limit: 1 }, { path: path.join(os.homedir(), '.ssh', 'id_rsa') }])
    expect(output.details.results.map((item: any) => item.status)).toEqual(['success', 'failed'])
    expect(output.content.some((block: any) => block.type === 'text' && block.text.includes('two'))).toBe(true)
    expect(approve).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled()
  })

  it('模拟下载继承校验与快照，失败不影响后续项', async () => {
    const root = await temporary()
    const approve = vi.fn(), snapshot = vi.fn()
    const downloadFetch = vi.fn(async (url: string) => new Response(url.endsWith('/bad') ? '' : 'bytes', { status: url.endsWith('/bad') ? 404 : 200 })) as unknown as typeof fetch
    const tool = piProjectTools(root, snapshot, { mode: 'auto', project: root, protectedDirectories: [], approve, downloadFetch }).find(tool => tool.name === 'download_many')!
    const output = await run(tool, ['good', 'bad', 'last'].map(name => ({ path: `${name}.bin`, url: `https://example.test/${name}` })))
    expect(output.details.results.map((item: any) => item.status)).toEqual(['success', 'failed', 'success'])
    expect(await readFile(path.join(root, 'good.bin'), 'utf8')).toBe('bytes')
    expect(snapshot).toHaveBeenCalledTimes(3); expect(approve).not.toHaveBeenCalled()
  })

  it('项目外写入走审核，拒绝后不继续下载', async () => {
    const root = await temporary(), outside = await temporary()
    const approve = vi.fn(async () => { throw new Error('用户拒绝') }), downloadFetch = vi.fn()
    const tool = piProjectTools(root, vi.fn(), { mode: 'auto', project: root, protectedDirectories: [], approve, downloadFetch }).find(tool => tool.name === 'download_many')!
    // 系统临时目录本来可写，使用明确位于临时目录之外的目标。
    const output = await run(tool, [{ path: path.join(os.homedir(), 'pi-batch-review.bin'), url: 'https://example.test/a' }, { path: path.join(outside, 'b'), url: 'https://example.test/b' }])
    expect(approve).toHaveBeenCalledTimes(1); expect(downloadFetch).not.toHaveBeenCalled()
    expect(output.details.results.map((item: any) => item.status)).toEqual(['failed', 'not_executed'])
  })

  it('每次询问模式顺序读取，拒绝项目外读取后不再弹出后续审批', async () => {
    const root = await temporary(), outside = await temporary()
    await writeFile(path.join(outside, 'a.txt'), 'a')
    await writeFile(path.join(outside, 'b.txt'), 'b')
    const approve = vi.fn(async () => { throw new Error('用户拒绝') })
    const tool = piProjectTools(root, vi.fn(), { mode: 'default', project: root, protectedDirectories: [], approve }).find(tool => tool.name === 'read_many')!
    const output = await run(tool, ['a.txt', 'b.txt'].map(name => ({ path: path.join(outside, name) })))
    expect(approve).toHaveBeenCalledTimes(1)
    expect(output.details.results.map((item: any) => item.status)).toEqual(['failed', 'not_executed'])
  })

  it('保留图片附件，并在计划模式工具白名单中仅允许批量读取', async () => {
    const image = { type: 'image', data: 'attachment', mimeType: 'image/png' }
    const output = await run(batch('read_many', async () => ({ content: [image], details: {} })), [{ path: 'image.png' }])
    expect(output.content).toContainEqual(image)
    expect(PLAN_READ_TOOLS).toContain('read_many')
    expect(PLAN_READ_TOOLS).not.toContain('download_many')
  })

  it('系统提示推荐批量工具并禁止 require 数据资源', () => {
    const prompt = agentSystemPrompt({ instruction: '', mode: 'auto', planning: true })
    expect(prompt).toContain('read_many'); expect(prompt).toContain('download_many'); expect(prompt).toContain('不要用 require')
    expect(prompt).toContain('单文件用 read')
    expect(prompt).toContain('大文件先搜索定位')
    expect(prompt).toContain('不要因文件结构复杂或需要按字段筛选就改用 node -e')
    expect(prompt).not.toContain('确需程序化解析时使用 readFileSync + JSON.parse')
  })
})
