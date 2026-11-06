import type { ChatMessage } from './models'

/** 不序列化正文或附件，仅比较结构；引用相同的历史直接跳过。 */
export function equalTranscriptValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key)
    && equalTranscriptValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

export interface TranscriptPatch { indices: number[]; length: number }

/** 每次请求先发送完整基线，之后仅发送变化的消息；只保留最近一份快照。 */
export class TranscriptUpdates {
  private previous?: ChatMessage[]
  next(messages: ChatMessage[]): { messages: ChatMessage[]; transcriptPatch?: TranscriptPatch } | undefined {
    const previous = this.previous
    this.previous = messages
    if (!previous) return { messages }
    const indices: number[] = []
    const changed: ChatMessage[] = []
    messages.forEach((message, index) => {
      if (!equalTranscriptValue(previous[index], message)) { indices.push(index); changed.push(message) }
      else messages[index] = previous[index]
    })
    if (!indices.length && previous.length === messages.length) return
    return { messages: changed, transcriptPatch: { indices, length: messages.length } }
  }
}

export function applyTranscriptPatch(previous: ChatMessage[], messages: ChatMessage[], patch?: TranscriptPatch): ChatMessage[] {
  if (!patch) return messages
  if (!Number.isSafeInteger(patch.length) || patch.length < 0 || patch.indices.length !== messages.length) throw new Error('会话增量格式无效')
  const next = previous.slice(0, patch.length)
  patch.indices.forEach((index, offset) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= patch.length) throw new Error('会话增量位置无效')
    next[index] = messages[offset]
  })
  for (let index = 0; index < patch.length; index++) if (!next[index]) throw new Error('会话增量缺少基线')
  return next
}
