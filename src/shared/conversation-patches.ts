import type { Conversation, ConversationState } from './conversations'

export const CONVERSATION_FIELDS = ['id', 'title', 'titleEdited', 'prompt', 'preview', 'project', 'updatedAt', 'lastSentAt',
  'unreadCompletion', 'messages', 'compaction', 'draft', 'draftImages', 'draftSkillIds', 'queuedMessages', 'queuePaused',
  'queueEdit', 'modelId', 'permissionMode', 'intentMode', 'agentSnapshots'] as const satisfies readonly (keyof Conversation)[]

export interface ConversationPatch {
  updates: { id: string; fields: Partial<Conversation>; unset: (keyof Conversation)[] }[]
  /** 顺序同时表达新增和删除；不携带未变化会话的内容。 */
  order?: string[]
  selectedId: string | null
}

export function conversationPatch(previous: ConversationState, next: ConversationState): ConversationPatch {
  const byId = new Map(previous.tasks.map(task => [task.id, task]))
  const updates: ConversationPatch['updates'] = []
  for (const task of next.tasks) {
    const before = byId.get(task.id)
    if (before === task) continue
    const fields: Partial<Conversation> = {}, unset: (keyof Conversation)[] = []
    for (const key of CONVERSATION_FIELDS) {
      if (key === 'id' || before && before[key] === task[key]) continue
      if (task[key] === undefined) { if (before?.[key] !== undefined) unset.push(key) }
      else Object.assign(fields, { [key]: task[key] })
    }
    if (!before || Object.keys(fields).length || unset.length) updates.push({ id: task.id, fields, unset })
  }
  const reordered = previous.tasks.length !== next.tasks.length || previous.tasks.some((task, index) => task.id !== next.tasks[index].id)
  return { updates, selectedId: next.selectedId, ...(reordered ? { order: next.tasks.map(task => task.id) } : {}) }
}

/** 仅做协议结构校验；合并后的变更会话须由主进程按完整会话规则校验。 */
export function parseConversationPatch(input: unknown): ConversationPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('会话增量格式无效')
  const patch = input as ConversationPatch
  if (!Array.isArray(patch.updates) || !(patch.selectedId === null || typeof patch.selectedId === 'string')
    || patch.order !== undefined && (!Array.isArray(patch.order) || patch.order.some(id => typeof id !== 'string' || !id) || new Set(patch.order).size !== patch.order.length)) throw new Error('会话增量格式无效')
  const seen = new Set<string>()
  for (const update of patch.updates) {
    if (!update || typeof update.id !== 'string' || !update.id || seen.has(update.id) || !update.fields || typeof update.fields !== 'object'
      || Array.isArray(update.fields) || !Array.isArray(update.unset)) throw new Error('会话增量字段无效')
    seen.add(update.id)
    for (const key of [...Object.keys(update.fields), ...update.unset]) {
      if (key === 'id' || !(CONVERSATION_FIELDS as readonly string[]).includes(key)) throw new Error('会话增量包含禁止字段')
    }
    if (update.unset.some(key => Object.prototype.hasOwnProperty.call(update.fields, key))) throw new Error('会话增量字段冲突')
  }
  return patch
}

export function applyConversationPatch(state: ConversationState, patch: ConversationPatch,
  validate: (task: Conversation) => void = () => {}): ConversationState {
  const tasks = new Map(state.tasks.map(task => [task.id, task]))
  for (const update of patch.updates) {
    const task = { ...tasks.get(update.id), ...update.fields, id: update.id } as Conversation
    for (const key of update.unset) delete task[key]
    validate(task)
    tasks.set(task.id, task)
  }
  const order = patch.order ?? state.tasks.map(task => task.id)
  const retained = new Set(order)
  if (patch.updates.some(update => !retained.has(update.id)) || order.some(id => !tasks.has(id))
    || patch.selectedId !== null && !retained.has(patch.selectedId)) throw new Error('会话增量引用不存在的会话')
  return { version: 1, tasks: order.map(id => tasks.get(id)!), selectedId: patch.selectedId }
}
