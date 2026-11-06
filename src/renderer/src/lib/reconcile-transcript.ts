import type { ChatMessage } from '../../../shared/models'

import { equalTranscriptValue as equalValue } from '../../../shared/transcript-updates'

// 增量更新复用旧引用，完整恢复时也复用未变化消息，避免历史轮次重新渲染。

export function reconcileTranscript(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(previous.filter(message => message.historyId).map(message => [message.historyId, message]))
  const next = incoming.map((message, index) => {
    const old = message.historyId ? byId.get(message.historyId) : previous[index]
    return old && equalValue(old, message) ? old : message
  })
  return next.length === previous.length && next.every((message, index) => message === previous[index]) ? previous : next
}
