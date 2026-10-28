import type { ChatMessage, ModelUsage } from './models'
import { attachmentKind, attachmentText } from './attachments'

export const DEFAULT_COMPRESSION_THRESHOLD = 90
export function normalizeCompressionThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_COMPRESSION_THRESHOLD
  // 对齐到 5 的步长，避免历史数据落在拖动条步进之外。
  const snapped = Math.round(value / 5) * 5
  return Math.max(60, Math.min(95, snapped))
}
export interface ContextCompaction { summary: string; coveredMessages: number }
export interface ContextOptions { threshold: number; usage?: ModelUsage }
export function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const character of text) tokens += /[^\x00-\x7F]/.test(character) ? 1 : .25
  return Math.ceil(tokens)
}
export function estimateContextTokens(messages: ChatMessage[], instruction = ''): number {
  return estimateTextTokens(instruction) + messages.reduce((total, message) => total + estimateTextTokens(message.content) + 4
    + (message.call?.work ?? []).reduce((sum, item) => sum + estimateTextTokens(item.content) + (item.args ? estimateTextTokens(JSON.stringify(item.args)) : 0) + 4, 0)
    + (message.images ?? []).reduce((sum, file) => sum + (attachmentKind(file) === 'text' ? estimateTextTokens(`附件：${file.name}\n${attachmentText(file)}`) : 1024), 0), 0)
}
export function contextMessages(messages: ChatMessage[], compaction?: ContextCompaction): ChatMessage[] {
  return compaction ? [{ role: 'user', content: compaction.summary }, ...messages.slice(compaction.coveredMessages)] : messages
}
