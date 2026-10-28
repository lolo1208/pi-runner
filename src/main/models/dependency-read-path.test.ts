import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { piProjectTools } from './pi-tools'

// 模拟 pnpm 链接，不依赖真实 Electron 安装或网络。
describe('项目内依赖链接读取', () => {
  let root: string
  let outside: string
  const approve = vi.fn(async () => { throw new Error('approval requested') })
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pi-dependency-read-'))
    outside = await mkdtemp(path.join(os.tmpdir(), 'pi-dependency-outside-'))
    const actual = path.join(root, 'node_modules/.pnpm/electron@1/node_modules/electron')
    await mkdir(actual, { recursive: true })
    await writeFile(path.join(actual, 'install.js'), '// 安装入口示例')
    await symlink(actual, path.join(root, 'node_modules/electron'), process.platform === 'win32' ? 'junction' : 'dir')
    approve.mockClear()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  const execute = (name: string, args: Record<string, unknown>) => {
    const tool = piProjectTools(root, async () => {}, { mode: 'auto', project: root, protectedDirectories: [], approve }).find(item => item.name === name)!
    return tool.execute('test', args, undefined, undefined, undefined as never)
  }
  it('读取 pnpm 的项目内依赖文件，无需审批', async () => {
    const result = await execute('read', { path: 'node_modules/electron/install.js' })
    expect(JSON.stringify(result)).toContain('安装入口示例')
    expect(approve).not.toHaveBeenCalled()
  })
  it('不允许通过依赖链接写入', async () => {
    await expect(execute('write', { path: 'node_modules/electron/install.js', content: 'changed' })).rejects.toThrow('符号链接或目录联接')
  })
  it('不允许链接到项目外', async () => {
    await writeFile(path.join(outside, 'secret.js'), 'outside')
    await symlink(outside, path.join(root, 'node_modules/external'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(execute('read', { path: 'node_modules/external/secret.js' })).rejects.toThrow('node_modules 之外')
  })
  it('不放开普通项目链接', async () => {
    await symlink(path.join(root, 'node_modules/.pnpm'), path.join(root, 'shortcut'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(execute('read', { path: 'shortcut/electron@1/node_modules/electron/install.js' })).rejects.toThrow('符号链接或目录联接')
  })
})
