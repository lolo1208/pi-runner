import type { ChatImage, ChatMessage } from './models'

/** 根据同项目已有会话选择项目自审模式；内部仍使用 auto，不继承完全访问。 */
export function defaultConversationPermission(project: string | null, tasks: readonly Conversation[]): import('./models').PermissionMode {
  return project && tasks.some(task => task.project === project && (task.permissionMode === 'auto' || task.permissionMode === 'full')) ? 'auto' : 'default'
}

export interface QueuedMessage extends ChatMessage {
  id: string
  role: 'user'
}

/** 输入框保存编辑中的内容；另存原草稿，取消编辑或刷新后均能恢复。 */
export interface QueueEditState {
  id: string
  draft: { prompt: string; images: ChatImage[]; skillIds: string[] }
  paused: boolean
}

export interface Conversation {
  id: string
  title: string
  /** 用户手动命名后，不再用首条消息覆盖名称。 */
  titleEdited?: boolean
  /** 仅用于本会话，冲突时优先于项目和全局提示词。 */
  prompt?: string
  preview: string
  project: string | null
  updatedAt?: number
  /** 最后一次用户发送消息的时间，会话列表按它从新到旧排序。 */
  lastSentAt?: number
  /** 已成功完成、但用户尚未查看的回复。 */
  unreadCompletion?: boolean
  messages?: ChatMessage[]
  compaction?: import('./context').ContextCompaction
  draft?: string
  draftImages?: ChatImage[]
  draftSkillIds?: string[]
  /** 待发送消息按数组顺序执行，文字和附件随会话保存。 */
  queuedMessages?: QueuedMessage[]
  queuePaused?: boolean
  queueEdit?: QueueEditState
  /** 会话内用户指定的模型；为空时新会话回退到默认模型 */
  modelId?: string
  permissionMode?: import('./models').PermissionMode
  intentMode?: import('./models').IntentMode
  agentSnapshots?: import('./models').AgentSnapshot[]
}

export interface ConversationState {
  version: 1
  tasks: Conversation[]
  selectedId: string | null
}
