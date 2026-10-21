import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ConversationState } from '../shared/conversations'
import { ATTACHMENT_DATA_URL } from '../shared/attachments'
import { MAX_CUSTOM_PROMPT_LENGTH, PERMISSION_MODES, type PermissionMode } from '../shared/models'
import { validSkillIds } from '../shared/skills'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('会话文件格式无效')
  return value as Record<string, unknown>
}

function images(value: unknown): boolean {
  return value === undefined || Array.isArray(value) && value.every(image => {
    const item = record(image)
    return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.dataUrl === 'string' && ATTACHMENT_DATA_URL.test(item.dataUrl)
  })
}

function parseState(value: unknown): ConversationState {
  const state = record(value)
  if (state.version !== 1 || !Array.isArray(state.tasks) || !(state.selectedId === null || typeof state.selectedId === 'string')) throw new Error('会话文件格式无效')
  const ids = new Set<string>()
  for (const value of state.tasks) {
    const task = record(value)
    if (!validSkillIds(task.draftSkillIds)) throw new Error('会话草稿技能格式无效')
    if (task.titleEdited !== undefined && typeof task.titleEdited !== 'boolean') throw new Error('会话名称状态无效')
    if (task.prompt !== undefined && (typeof task.prompt !== 'string' || task.prompt.length > MAX_CUSTOM_PROMPT_LENGTH)) throw new Error('会话提示词无效')
    if (task.unreadCompletion !== undefined && typeof task.unreadCompletion !== 'boolean') throw new Error('会话未读状态无效')
    if (task.queuePaused !== undefined && typeof task.queuePaused !== 'boolean') throw new Error('会话队列状态无效')
    if (task.queuedMessages !== undefined) {
      const queueIds = new Set<string>()
      if (!Array.isArray(task.queuedMessages) || !task.queuedMessages.every(value => {
        const item = record(value)
        if (!validSkillIds(item.skillIds)) return false
        if (typeof item.id !== 'string' || !item.id || queueIds.has(item.id) || item.role !== 'user' || typeof item.content !== 'string' || !images(item.images)) return false
        queueIds.add(item.id)
        return true
      })) throw new Error('会话队列消息格式无效')
    }
    if (task.queueEdit !== undefined) {
      const edit = record(task.queueEdit), draft = record(edit.draft)
      if (typeof edit.id !== 'string' || !Array.isArray(task.queuedMessages) || !task.queuedMessages.some(item => record(item).id === edit.id)
        || typeof edit.paused !== 'boolean' || typeof draft.prompt !== 'string' || !Array.isArray(draft.images) || !images(draft.images) || !Array.isArray(draft.skillIds) || !validSkillIds(draft.skillIds)) throw new Error('会话队列编辑状态无效')
    }
    if (task.permissionMode !== undefined && !PERMISSION_MODES.includes(task.permissionMode as PermissionMode)) throw new Error('会话权限模式无效')
    if (task.intentMode !== undefined && !['plan', 'execute'].includes(String(task.intentMode))) throw new Error('会话目的模式无效')
    if (typeof task.id !== 'string' || !task.id || ids.has(task.id) || typeof task.title !== 'string' || typeof task.preview !== 'string' || !(task.project === null || typeof task.project === 'string') || !(task.updatedAt === undefined || typeof task.updatedAt === 'number' && Number.isFinite(task.updatedAt)) || !(task.lastSentAt === undefined || typeof task.lastSentAt === 'number' && Number.isFinite(task.lastSentAt)) || !(task.draft === undefined || typeof task.draft === 'string') || !(task.modelId === undefined || typeof task.modelId === 'string') || !images(task.draftImages)) throw new Error('会话文件格式无效')
    ids.add(task.id)
    if (task.compaction !== undefined) {
      const compaction = record(task.compaction)
      if (typeof compaction.summary !== 'string' || !compaction.summary.trim() || compaction.summary.length > 32000 || !Number.isSafeInteger(compaction.coveredMessages) || (compaction.coveredMessages as number) < 1 || !Array.isArray(task.messages) || (compaction.coveredMessages as number) > task.messages.length) throw new Error('会话摘要格式无效')
    }
    if (task.messages !== undefined && (!Array.isArray(task.messages) || !task.messages.every(value => {
      const message = record(value)
      if (!validSkillIds(message.skillIds)) return false
      if (message.historyId !== undefined && (typeof message.historyId !== 'string' || !/^[\w-]{1,128}$/.test(message.historyId))) return false
      return (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && images(message.images)
    }))) throw new Error('会话消息格式无效')
  }
  return state as unknown as ConversationState
}

/** 不设置保留期限；只有用户删除会话时才从保存状态中移除。 */
export class ConversationStore {
  private readable = false
  constructor(private readonly file: string) {}

  load(): ConversationState {
    try {
      const state = parseState(JSON.parse(readFileSync(this.file, 'utf8')))
      this.readable = true
      return state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.readable = true
        return { version: 1, tasks: [], selectedId: null }
      }
      this.readable = false
      throw new Error('无法读取本地会话，原文件已保留。请检查会话文件或访问权限后重启应用。')
    }
  }

  save(value: unknown): void {
    if (!this.readable) throw new Error('本地会话尚未成功读取，已停止保存以保护原文件。')
    const state = parseState(value)
    mkdirSync(path.dirname(this.file), { recursive: true })
    // 同步写入临时文件并原子替换，关闭窗口时无需等待后台写入。
    writeFileSync(`${this.file}.tmp`, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flush: true })
    renameSync(`${this.file}.tmp`, this.file)
  }
}
