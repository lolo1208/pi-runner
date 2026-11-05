import type { AgentEvent } from '../../../shared/models'

const listeners = new Set<{ conversationId?: string; callback(event: AgentEvent): void }>()
let unsubscribe: (() => void) | undefined

/** 整个渲染进程只跨 contextBridge 接收一份事件，避免每个后台会话复制完整历史和附件。 */
export function subscribeAgentEvents(callback: (event: AgentEvent) => void, conversationId?: string): () => void {
  const listener = { callback, conversationId }
  listeners.add(listener)
  unsubscribe ??= window.piRunner.onAgentEvent?.(event => {
    for (const item of listeners) {
      if (item.conversationId !== undefined && item.conversationId !== event.conversationId) continue
      item.callback(event)
    }
  })
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { unsubscribe?.(); unsubscribe = undefined }
  }
}
