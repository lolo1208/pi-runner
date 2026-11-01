import type { ChatMessage } from '../../../shared/models'

// IPC 每次都会复制整份历史；复用未变化的消息，避免所有已显示的轮次重新渲染。
function equalValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const left = Object.keys(a)
  const right = Object.keys(b)
  return left.length === right.length && left.every(key => Object.prototype.hasOwnProperty.call(b, key)
    && equalValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

export function reconcileTranscript(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(previous.filter(message => message.historyId).map(message => [message.historyId, message]))
  const next = incoming.map((message, index) => {
    const old = message.historyId ? byId.get(message.historyId) : previous[index]
    return old && equalValue(old, message) ? old : message
  })
  return next.length === previous.length && next.every((message, index) => message === previous[index]) ? previous : next
}
