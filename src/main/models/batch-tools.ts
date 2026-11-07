import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'
import { validateTextMutationInput } from './text-mutation-tools'
import { FileMutationUncertain, FileSnapshotStopped } from './tool-execution-errors'
import { canonicalToolPath } from './security-paths'
import { validateReadArgs } from './read-tool-input'
import { DownloadFailure } from './download-tool'
import { pick, type PromptLang } from '../../shared/prompt-lang'

export class ToolApprovalStopped extends ModelError {}
const MAX_ITEMS = 100
const TEXT_BUDGET = 200000
const IMAGE_BUDGET = 8
const BATCH_INPUT_BUDGET = 8 * 1024 * 1024
const batchDescriptions: Record<string, Record<PromptLang, string>> = {
  write: {
    zh: '批量创建或完整覆盖文本文件，多文件优先使用。局部修改使用 edit_many；单文件使用 write。自动创建父目录，已有文件会覆盖，不用于图片或二进制文件。',
    en: 'Batch create or fully overwrite text files; prefer for multiple files. Use edit_many for partial changes; write for a single file. Creates parent directories automatically, overwrites existing files, not for images or binaries.'
  },
  edit: {
    zh: '批量精确编辑文本文件，多文件优先使用。同一文件的全部替换放在同一条 items 项内，oldText 必须在原文件中唯一且互不重叠，附近修改合并。单文件使用 edit。每个文件先校验全部替换再保存，匹配失败不修改该文件。',
    en: 'Batch precise editing of text files; prefer for multiple files. Put all replacements for one file in a single items entry; oldText must be unique and non-overlapping in the original file, and nearby changes merge. Use edit for a single file. Each file validates all replacements before saving; on match failure the file is left unchanged.'
  }
}
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false })

/** 仅组合已完成权限包装的单项工具，不提供第二条文件访问通道。 */
export function batchToolDefinitions(root: string, tools: ToolDefinition<any, any>[], readConcurrency = 4, lang: PromptLang = 'zh'): ToolDefinition<any, any>[] {
  return tools.filter(tool => ['read', 'download', 'write', 'edit'].includes(tool.name)).map(single => {
    const name = single.name
    const reading = name === 'read'
    const textMutation = name === 'write' || name === 'edit'
    return {
      name: `${name}_many`, label: pick(lang, { read: '批量读取文件', download: '批量下载文件', write: '批量写入文件', edit: '批量编辑文件' }[name] ?? single.label, { read: 'Batch read files', download: 'Batch download files', write: 'Batch write files', edit: 'Batch edit files' }[name] ?? single.label), executionMode: 'sequential' as const,
      description: textMutation
        ? pick(lang, `${batchDescriptions[name].zh} 输入 JSON 最多 8 MiB，目标路径不可重复。顺序执行，继承单项权限与快照；普通错误继续，取消、拒绝授权或快照失败则停止。逐项检查 results：success 不重做，failed 修正后补做，unknown 先核对，not_executed 未开始。stopped=true 不自动重试；批次不回滚。`, `${batchDescriptions[name].en} Input JSON up to 8 MiB, target paths must be unique. Executes sequentially, inheriting single-item permissions and snapshots; continue on ordinary errors, stop on cancel, denied approval, or snapshot failure. Check results item by item: success — do not redo; failed — redo after fixing the cause; unknown — verify first; not_executed — not started. Do not auto-retry when stopped=true; the batch does not roll back.`)
        : reading
        ? pick(lang, '批量读取文件，多个独立文件优先使用；继承 read 的权限和分段规则。输入最多 8 MiB，并发最多 4，输出累计 200000 字符和 8 张图片。按输入顺序返回状态；output_limited 按 nextOffset 续读，无 nextOffset 则从原 offset（省略时为 1）缩小 limit 或分批读图，不能跳过遗漏内容。LINE_TOO_LONG 缩小 limit 无效，改用 grep 定位或说明限制。普通错误继续；取消或拒绝后停止启动新项，已启动项可能完成，不自动重试。', 'Batch read files; prefer for multiple independent files; inherits read\'s permissions and segment rules. Input up to 8 MiB, concurrency up to 4, cumulative output 200000 characters and 8 images. Returns status in input order; output_limited — continue with nextOffset, or without nextOffset re-read from the original offset (1 if omitted) with a smaller limit or read images in batches, never skipping missed content. LINE_TOO_LONG — shrinking limit does not help; use grep to locate or state the limit. Continue on ordinary errors; after cancel or denial stop starting new items (already-started ones may complete); do not auto-retry.')
        : pick(lang, '批量下载文件，多文件下载优先使用本工具。顺序执行，继承 download 的权限、快照及完整性校验；批内重复目标路径会被拒绝。输入 JSON 最多 8 MiB；普通错误逐项返回；取消、拒绝授权或快照失败后停止。不自动重试，不保证批次原子性，已完成文件不会自动回滚。success 不重复下载，unknown 先核对目标；warnings 仅表示清理问题，不代表下载失败。', 'Batch download files; prefer for multiple-file downloads. Executes sequentially, inheriting download\'s permissions, snapshots, and integrity checks; duplicate target paths within the batch are rejected. Input JSON up to 8 MiB; ordinary errors are returned per item; stops after cancel, denied approval, or snapshot failure. No auto-retry, no batch atomicity, completed files are not rolled back. Do not re-download success items; for unknown verify the target first; warnings only indicate cleanup issues, not download failure.'),
      parameters: schema({ items: { type: 'array', minItems: 1, maxItems: MAX_ITEMS, items: reading ? schema({ path: { type: 'string', minLength: 1 }, offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1 } }, ['path']) : single.parameters } }, ['items']) as ToolDefinition['parameters'],
      execute: async (id, args, signal, update, context) => {
        const input = (args as { items?: unknown })?.items
        if (!Array.isArray(input) || !input.length || input.length > MAX_ITEMS || input.some(item => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.path !== 'string' || !item.path.trim())) throw new ModelError('批量工具需要 1–100 个包含确切 path 的项目；尚未执行任何文件')
        // 在深拷贝前限制输入，避免超大内容先被复制；预算包含外层 JSON。
        {
          let serialized: string
          try { serialized = JSON.stringify({ items: input }) }
          catch { throw new ModelError('批量输入必须可序列化为 JSON；尚未执行任何文件') }
          if (Buffer.byteLength(serialized, 'utf8') > BATCH_INPUT_BUDGET) throw new ModelError('批量工具输入 JSON 不能超过 8 MiB；请拆分批次，尚未执行任何文件')
        }
        const items = structuredClone(input) as Record<string, unknown>[]
        if (!reading) {
          const targets = await Promise.all(items.map(async item => {
            const requested = path.resolve(root, String(item.path))
            // 解析已有父目录及文件的真实大小写/别名；失败保留给单项权限工具处理。
            const target = await canonicalToolPath(requested).catch(() => requested)
            return process.platform === 'win32' ? target.toLowerCase() : target
          }))
          if (new Set(targets).size !== targets.length) throw new ModelError('批内目标路径不能重复；尚未执行任何文件')
        }
        const results: Record<string, unknown>[] = []
        const content: any[] = []
        let stopped = false, textLeft = TEXT_BUDGET, imagesLeft = IMAGE_BUDGET
        let stopReason: string | undefined
        const snapshot = () => {
          const halted = stopped || Boolean(signal?.aborted)
          const status = halted ? 'stopped' : results.length < items.length ? 'running' : results.every(item => item.status === 'success') ? 'success' : results.some(item => item.status === 'success' || item.status === 'output_limited') ? 'partial' : 'failed'
          return { status, results: structuredClone(results), stopped: halted, ...(halted ? { stopReason: stopReason ?? 'CANCELLED' } : {}), processed: results.length, total: items.length }
        }
        // 分组并发，按输入顺序汇总，避免并发完成顺序影响输出预算。
        const concurrency = reading ? Number.isFinite(readConcurrency) ? Math.max(1, Math.min(4, Math.trunc(readConcurrency))) : 4 : 1
        for (let start = 0; start < items.length; start += concurrency) {
          const group = items.slice(start, start + concurrency)
          const outcomes = await Promise.all(group.map(async (item, offset) => {
            if (stopped || signal?.aborted) return { status: 'not_executed', code: 'BATCH_STOPPED', reason: stopReason ?? '批次已取消，未开始该文件' }
            if (reading && textLeft <= 0) return { status: 'not_executed', code: 'OUTPUT_BUDGET', reason: '批次文本预算已用尽，请分批读取；该文件尚未开始' }
            try {
              if (reading) validateReadArgs(item)
              if (textMutation) validateTextMutationInput(name, item)
              const value = await single.execute(`${id}-${start + offset + 1}`, item, signal, undefined, context)
              return { status: 'success', value }
            } catch (error) {
              const denied = error instanceof ToolApprovalStopped
              const snapshotFailed = error instanceof FileSnapshotStopped
              if (signal?.aborted || denied || snapshotFailed) {
                stopped = true
                stopReason ??= snapshotFailed ? 'SNAPSHOT_FAILED' : denied ? 'APPROVAL_STOPPED' : 'CANCELLED'
              }
              // 写入后生成 diff 等环节也可能抛出无 errno 的错误，不能据此认定未修改。
              const uncertain = error instanceof FileMutationUncertain || textMutation && !denied && !snapshotFailed && !(error instanceof ModelError)
              return { status: uncertain ? 'unknown' : 'failed', code: snapshotFailed ? 'SNAPSHOT_FAILED' : denied ? 'APPROVAL_STOPPED' : uncertain ? 'VERIFY_FILE' : signal?.aborted ? 'CANCELLED' : error instanceof DownloadFailure ? error.code : 'ITEM_FAILED', reason: (error instanceof Error ? error.message : String(error)).slice(0, 4000) }
            }
          }))
          for (let offset = 0; offset < outcomes.length; offset++) {
            const outcome = outcomes[offset]
            const entry: Record<string, unknown> = { index: start + offset, path: group[offset].path, status: outcome.status }
            if (reading) {
              for (const key of ['offset', 'limit']) if (group[offset][key] !== undefined) entry[key] = group[offset][key]
            }
            if ('reason' in outcome) entry.reason = outcome.reason
            if ('code' in outcome) entry.code = outcome.code
            if ('value' in outcome && outcome.value) {
              let omitted = false
              if (reading) {
                const truncation = outcome.value.details?.truncation
                if (truncation?.truncated || truncation?.firstLineExceedsLimit) {
                  entry.status = 'output_limited'
                  entry.code = truncation.firstLineExceedsLimit ? 'LINE_TOO_LONG' : 'SOURCE_TRUNCATED'
                  entry.reason = truncation.firstLineExceedsLimit ? '单行超过读取字节上限，缩小 limit 无效；请使用 grep 定位或说明读取限制，不要原样重试' : '单文件读取达到行数或字节上限，所请求内容未完整返回'
                  if (!truncation.firstLineExceedsLimit && Number.isSafeInteger(truncation.outputLines) && truncation.outputLines > 0) {
                    entry.nextOffset = Number(group[offset].offset ?? 1) + truncation.outputLines
                  }
                }
              }
              if (name === 'download') {
                // 仅复制下载确认信息，不复制任意 details 或二进制数据。
                for (const key of ['bytes', 'sha256', 'contentType']) {
                  const value = outcome.value.details?.[key]
                  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) entry[key] = value
                  else if (typeof value === 'string') entry[key] = value.slice(0, 500)
                }
                if (Array.isArray(outcome.value.details?.warnings)) entry.warnings = outcome.value.details.warnings.filter((value: unknown) => typeof value === 'string').slice(0, 4).map((value: string) => value.slice(0, 1000))
              }
              content.push({ type: 'text', text: `文件 ${start + offset + 1}：${String(group[offset].path)}` })
              for (const block of outcome.value.content) {
                if (block.type === 'text') {
                  let text = block.text.slice(0, textLeft)
                  // 不在 UTF-16 代理对中间截断，避免返回损坏的字符。
                  if (text.length < block.text.length && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1)
                  if (text) content.push({ type: 'text', text })
                  textLeft -= text.length
                  if (text.length !== block.text.length) omitted = true
                } else if (block.type === 'image') {
                  if (imagesLeft > 0) { content.push(block); imagesLeft-- } else omitted = true
                }
              }
              if (omitted) {
                if (reading) {
                  entry.status = 'output_limited'
                  if (entry.code !== 'LINE_TOO_LONG') entry.code = 'OUTPUT_BUDGET'
                  // 单项的 nextOffset 已不对应实际返回内容，不能继续暴露它。
                  delete entry.nextOffset
                }
                if (entry.code !== 'LINE_TOO_LONG') entry.reason = reading ? '部分内容未返回：超出文本或图片预算，请缩小范围或分批读取' : '操作已成功，仅结果文本超出预算；不要重复执行'
              }
              // 不复制原始 details，避免绕过输出预算重复附带全文或图片。
            }
            results.push(entry)
          }
          // 即使随后取消，已完成文件也有阶段性结果，避免整批进度丢失。
          if (update) {
            const progress = snapshot()
            try { update({ content: [{ type: 'text', text: JSON.stringify(progress) }], details: progress }) }
            catch { /* 展示回调失败不能覆盖实际文件执行结果。 */ }
          }
        }
        const details = snapshot()
        content.unshift({ type: 'text', text: JSON.stringify({ ...details, note: '逐项检查 results，不重复成功项；unknown 先核对。output_limited 按 nextOffset 续读，无 nextOffset 则原位缩小范围重读；LINE_TOO_LONG 缩小 limit 无效。not_executed 未开始；stopped=true 停止自动重试。已完成操作不回滚。' }) })
        return { content, details }
      }
    } satisfies ToolDefinition<any, any>
  })
}
