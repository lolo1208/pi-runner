import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'

export class ToolApprovalStopped extends ModelError {}
const MAX_ITEMS = 100
const TEXT_BUDGET = 200000
const IMAGE_BUDGET = 8
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false })

/** 仅组合已完成权限包装的单项工具，不提供第二条文件访问通道。 */
export function batchToolDefinitions(root: string, tools: ToolDefinition<any, any>[], readConcurrency = 4): ToolDefinition<any, any>[] {
  return ['read', 'download'].map(name => {
    const single = tools.find(tool => tool.name === name)!
    const reading = name === 'read'
    return {
      name: `${name}_many`, label: reading ? '批量读取文件' : '批量下载文件', executionMode: 'sequential' as const,
      description: reading
        ? '批量读取最多 100 个文件；每项支持 path、offset、limit。多个独立文件优先使用本工具。读取并发最多 4，累计文本上限 200000 字符、图片附件最多 8 张；超出预算明确标记，需缩小范围或分批读取。保留单项 read 的权限、分段与截断规则。按输入顺序返回逐项状态；普通错误继续，取消或拒绝授权后不再启动后续项目，已启动读取可能完成。不自动重试。不要用 require 加载 .prefab/.scene 等数据资源。'
        : '批量下载最多 100 个文件，每项支持 url、path、可选 sha256；多文件下载优先使用本工具。顺序执行，继承 download 的权限、快照及完整性校验；批内重复目标路径会被拒绝。普通错误逐项返回；取消或拒绝授权后停止。不自动重试，不保证批次原子性，已完成文件不会自动回滚。',
      parameters: schema({ items: { type: 'array', minItems: 1, maxItems: MAX_ITEMS, items: single.parameters } }, ['items']) as ToolDefinition['parameters'],
      execute: async (id, args, signal, _update, context) => {
        const items = structuredClone((args as { items?: unknown })?.items) as Record<string, unknown>[]
        if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS || items.some(item => !item || typeof item !== 'object' || typeof item.path !== 'string' || !item.path.trim())) throw new ModelError('批量工具需要 1–100 个包含确切 path 的项目')
        if (!reading) {
          const targets = items.map(item => {
            const target = path.resolve(root, String(item.path))
            return process.platform === 'win32' ? target.toLowerCase() : target
          })
          if (new Set(targets).size !== targets.length) throw new ModelError('批内下载目标路径不能重复；未开始下载')
        }
        const results: Record<string, unknown>[] = []
        const content: any[] = []
        let stopped = false, textLeft = TEXT_BUDGET, imagesLeft = IMAGE_BUDGET
        // 分组并发，按输入顺序汇总，避免并发完成顺序影响输出预算。
        const concurrency = reading ? Math.max(1, Math.min(4, readConcurrency)) : 1
        for (let start = 0; start < items.length; start += concurrency) {
          const group = items.slice(start, start + concurrency)
          const outcomes = await Promise.all(group.map(async (item, offset) => {
            if (stopped || signal?.aborted) return { status: 'not_executed', reason: '已取消或授权被拒绝' }
            if (reading && textLeft <= 0) return { status: 'not_executed', reason: '批次文本预算已用尽，请分批读取' }
            try {
              const value = await single.execute(`${id}-${start + offset + 1}`, item, signal, undefined, context)
              return { status: 'success', value }
            } catch (error) {
              if (signal?.aborted || error instanceof ToolApprovalStopped) stopped = true
              return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
            }
          }))
          for (let offset = 0; offset < outcomes.length; offset++) {
            const outcome = outcomes[offset]
            const entry: Record<string, unknown> = { index: start + offset, path: group[offset].path, status: outcome.status }
            if ('reason' in outcome) entry.reason = outcome.reason
            if ('value' in outcome && outcome.value) {
              let omitted = false
              content.push({ type: 'text', text: `文件 ${start + offset + 1}：${String(group[offset].path)}` })
              for (const block of outcome.value.content) {
                if (block.type === 'text') {
                  const text = block.text.slice(0, textLeft)
                  if (text) content.push({ type: 'text', text })
                  textLeft -= text.length
                  if (text.length !== block.text.length) omitted = true
                } else if (block.type === 'image') {
                  if (imagesLeft > 0) { content.push(block); imagesLeft-- } else omitted = true
                }
              }
              if (omitted) { entry.status = 'output_limited'; entry.reason = '部分内容未返回：超出文本或图片预算，请缩小范围或分批读取' }
              // 不复制原始 details，避免绕过输出预算重复附带全文或图片。
            }
            results.push(entry)
          }
        }
        content.unshift({ type: 'text', text: JSON.stringify({ results, stopped: stopped || Boolean(signal?.aborted), note: '仅重试失败或未返回内容的项目；批次不是事务，已完成操作不自动回滚。' }) })
        return { content, details: { results, stopped: stopped || Boolean(signal?.aborted) } }
      }
    } satisfies ToolDefinition<any, any>
  })
}
