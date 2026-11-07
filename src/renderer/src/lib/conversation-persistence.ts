import type { Conversation, ConversationDraftUpdate, ConversationState } from '../../../shared/conversations'
import type { ConversationPatch } from '../../../shared/conversation-patches'
import type { ChatMessage } from '../../../shared/models'

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

/** 已从原生历史恢复的闲置会话，不再在渲染进程长期保留完整消息；仅保留标题、预览等轻量元数据。
 *  未恢复（如旧版会话）与仍需展示/执行的会话不在淘汰范围内，切换会话时由其重新从原生历史恢复。 */
export function evictRestoredMessages(tasks: ConversationState['tasks'], retainIds: ReadonlySet<string>, restoredIds: ReadonlySet<string>): ConversationState['tasks'] {
  let changed = false
  const next = tasks.map(task => {
    if (retainIds.has(task.id) || !restoredIds.has(task.id) || !task.messages?.length) return task
    changed = true
    const { messages: _messages, ...rest } = task
    return rest
  })
  return changed ? next : tasks
}

/** 已保存消息是否来自原生历史：原生恢复的每条消息都带 historyId，旧版消息没有。 */
function isNativeHistory(messages: ChatMessage[] | undefined): boolean {
  return messages !== undefined && messages.length > 0 && messages.every(message => Boolean(message.historyId))
}

/** 淘汰闲置会话时，仅允许清除来自原生历史的会话消息副本；旧版会话消息没有原生历史可恢复，必须保留。 */
export function withoutLegacyMessageUnset(previous: ConversationState, patch: ConversationPatch): ConversationPatch {
  const before = new Map(previous.tasks.map(task => [task.id, task]))
  let changed = false
  const updates = patch.updates.map(update => {
    if (!update.unset.includes('messages')) return update
    if (isNativeHistory(before.get(update.id)?.messages)) return update
    changed = true
    return { ...update, unset: update.unset.filter(key => key !== 'messages') }
  })
  return changed ? { ...patch, updates } : patch
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
