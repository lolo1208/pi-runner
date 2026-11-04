import { createHash } from 'node:crypto'

type Fields = { input: boolean; output: boolean; cacheRead: boolean; cacheWrite: boolean }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const present = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** 只记录原始响应中实际存在的用量字段，不将 SDK 补零误认为服务端报告。 */
export function observeUsage(event: unknown, fields: Fields): void {
  const root = record(event), message = record(root.message), response = record(root.response)
  const usage = record(root.usage ?? message.usage ?? response.usage ?? root.usageMetadata)
  const details = record(usage.prompt_tokens_details ?? usage.input_tokens_details)
  fields.input ||= present(usage.input_tokens) || present(usage.prompt_tokens) || present(usage.promptTokenCount)
  fields.output ||= present(usage.output_tokens) || present(usage.completion_tokens) || present(usage.candidatesTokenCount)
  fields.cacheRead ||= present(usage.cache_read_input_tokens) || present(usage.prompt_cache_hit_tokens) || present(usage.cached_tokens) || present(details.cached_tokens) || present(usage.cachedContentTokenCount)
  fields.cacheWrite ||= present(usage.cache_creation_input_tokens) || present(usage.prompt_cache_write_tokens) || present(usage.cache_write_tokens) || present(details.cache_write_tokens)
}
export const emptyUsageFields = (): Fields => ({ input: false, output: false, cacheRead: false, cacheWrite: false })
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
export function cacheFingerprint(body: Record<string, unknown>): { prompt: string; tools: string } {
  const messages = Array.isArray(body.messages) ? body.messages as Record<string, unknown>[] : Array.isArray(body.input) ? body.input as Record<string, unknown>[] : []
  return { prompt: hash(body.system ?? body.systemInstruction ?? record(body.config).systemInstruction ?? body.instructions ?? messages.filter(item => item.role === 'system' || item.role === 'developer')), tools: hash(body.tools ?? record(body.config).tools) }
}

/** 在未改变的历史消息上保留上次断点；不得覆盖 SDK 的现有断点。 */
export class AnthropicCacheBoundary {
  constructor(private previous?: { signature: string; index: number }) {}
  snapshot(): { signature: string; index: number } | undefined { return this.previous }
  apply(body: Record<string, unknown>): void {
    const messages = body.messages
    if (!Array.isArray(messages)) return
    const clean = (value: unknown): string => JSON.stringify(value, (key, item) => key === 'cache_control' ? undefined : item)
    const current = messages.map(item => record(item))
    const reverseIndex = [...current].reverse().findIndex(item => Array.isArray(item.content) && (item.content as unknown[]).some(block => record(block).cache_control))
    const latestIndex = reverseIndex < 0 ? -1 : current.length - 1 - reverseIndex
    if (latestIndex < 0) return
    const latest = current[latestIndex]
    const latestBlocks = latest.content as Record<string, unknown>[]
    const control = record([...latestBlocks].reverse().find(block => record(block).cache_control)).cache_control
    const previous = this.previous
    const countBreakpoints = (value: unknown): number => {
      if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countBreakpoints(item), 0)
      if (!value || typeof value !== 'object') return 0
      return Object.entries(value).reduce((sum, [key, item]) => sum + (key === 'cache_control' ? 1 : countBreakpoints(item)), 0)
    }
    if (countBreakpoints(body) < 4 && previous && previous.index < latestIndex && current[previous.index] && hash(clean(current[previous.index])) === previous.signature) {
      const blocks = current[previous.index].content
      if (Array.isArray(blocks) && blocks.length) {
        const last = record(blocks[blocks.length - 1])
        if (['text', 'image', 'tool_result', 'tool_addition', 'tool_removal'].includes(String(last.type))) {
          blocks[blocks.length - 1] = { ...last, cache_control: control }
        }
      }
    }
    this.previous = { index: latestIndex, signature: hash(clean(latest)) }
  }
}
