import type { Conversation, ConversationDraftUpdate, ConversationState } from '../../../shared/conversations'

/** 只比较字段引用；纯文字输入不扫描消息正文，也不复制附件的 Base64。 */
export function conversationDraftChanges(previous: ConversationState, next: ConversationState, includeSelection = false): ConversationDraftUpdate[] | null {
  if (!includeSelection && previous.selectedId !== next.selectedId || previous.tasks.length !== next.tasks.length) return null
  const changes: ConversationDraftUpdate[] = []
  for (let index = 0; index < next.tasks.length; index++) {
    const before = previous.tasks[index], after = next.tasks[index]
    if (before === after) continue
    if (before.id !== after.id) return null
    const keys = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof Conversation)[])
    for (const key of keys) {
      if (key !== 'draft' && key !== 'draftSkillIds' && before[key] !== after[key]) return null
    }
    if (before.draft !== after.draft || before.draftSkillIds !== after.draftSkillIds) {
      changes.push({ id: after.id, draft: after.draft, draftSkillIds: after.draftSkillIds })
    }
  }
  return changes
}

/** 原生代理历史逐条落盘；运行中仅延后展示镜像，草稿、队列和配置仍照常保存。 */
export function deferRunningTranscripts(previous: ConversationState | null, next: ConversationState, busyIds: readonly string[]): ConversationState {
  if (!previous || !busyIds.length) return next
  const before = new Map(previous.tasks.map(task => [task.id, task]))
  const busy = new Set(busyIds)
  return { ...next, tasks: next.tasks.map(task => {
    const saved = before.get(task.id)
    if (!saved || !busy.has(task.id)) return task
    return { ...task, messages: saved.messages, preview: saved.preview, updatedAt: saved.updatedAt,
      title: task.titleEdited ? task.title : saved.title }
  }) }
}

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
