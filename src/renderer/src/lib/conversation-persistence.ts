import type { ConversationState } from '../../../shared/conversations'

/** 流式占位记录尚未进入原生历史，只用于展示；完成后的正式记录会由下一份快照保存。 */
export function persistentConversationState(state: ConversationState): ConversationState {
  return {
    ...state,
    tasks: state.tasks.map(task => task.messages ? {
      ...task,
      messages: task.messages.filter(message => !message.historyId?.startsWith('live-thinking:') && !message.historyId?.startsWith('live:'))
    } : task)
  }
}

export function conversationSaveError(error: unknown, exiting = false): string {
  const detail = error instanceof Error ? error.message.trim() : ''
  const prefix = exiting ? '会话未能保存到本地，暂时无法退出。' : '会话未能保存到本地。'
  return detail ? `${prefix}原因：${detail}` : `${prefix}请检查磁盘空间和访问权限。`
}
