import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConversationDraftUpdate, ConversationState } from '../shared/conversations'
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

function parseDrafts(value: unknown, state: ConversationState): ConversationDraftUpdate[] {
  if (!Array.isArray(value)) throw new Error('会话草稿格式无效')
  const ids = new Set(state.tasks.map(task => task.id))
  const seen = new Set<string>()
  return value.map(value => {
    const draft = record(value)
    if (typeof draft.id !== 'string' || !ids.has(draft.id) || seen.has(draft.id)
      || !(draft.draft === undefined || typeof draft.draft === 'string') || !validSkillIds(draft.draftSkillIds)) throw new Error('会话草稿格式无效')
    seen.add(draft.id)
    // 明确提取白名单字段，不允许草稿入口覆盖消息、附件或权限。
    return { id: draft.id, draft: draft.draft as string | undefined, draftSkillIds: draft.draftSkillIds }
  })
}

function applyDrafts(state: ConversationState, drafts: Map<string, ConversationDraftUpdate>): ConversationState {
  return { ...state, tasks: state.tasks.map(task => {
    const draft = drafts.get(task.id)
    return draft ? { ...task, draft: draft.draft, draftSkillIds: draft.draftSkillIds } : task
  }) }
}

function writeAtomic(file: string, json: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, json, { encoding: 'utf8', mode: 0o600, flush: true })
  renameSync(`${file}.tmp`, file)
}

/** 不设置保留期限；只有用户删除会话时才从保存状态中移除。 */
export class ConversationStore {
  private readable = false
  /** 最近一次成功读取或保存的状态；保存时不再重新读取并解析整个文件，避免阻塞主进程。 */
  private cached: ConversationState | null = null
  private cachedJson = ''
  private draftRevision: string = randomUUID()
  private drafts = new Map<string, ConversationDraftUpdate>()
  constructor(private readonly file: string) {}

  private loadDrafts(state: ConversationState): ConversationState {
    let overlay: Record<string, unknown>
    try { overlay = record(JSON.parse(readFileSync(`${this.file}.drafts.json`, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return state
      throw error
    }
    // 完整快照和草稿使用代号配对，原子替换快照后，旧草稿即失效。
    // 即使写完快照后立即断电，也不会让旧草稿覆盖发送后的空输入框。
    if (overlay.revision !== this.draftRevision) return state
    if (overlay.version !== 1) throw new Error('会话草稿版本无效')
    this.drafts = new Map(parseDrafts(overlay.drafts, state).map(draft => [draft.id, draft]))
    return applyDrafts(state, this.drafts)
  }

  load(): ConversationState {
    if (this.cached && this.readable) return this.cached
    try {
      const { draftRevision, ...value } = record(JSON.parse(readFileSync(this.file, 'utf8')))
      if (draftRevision !== undefined && typeof draftRevision !== 'string') throw new Error('会话草稿代号无效')
      const state = parseState(value)
      this.draftRevision = (draftRevision as string | undefined) ?? 'legacy'
      this.cachedJson = JSON.stringify({ ...state, draftRevision: this.draftRevision })
      this.cached = this.loadDrafts(state)
      this.readable = true
      return this.cached
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.readable = true
        this.cached = { version: 1, tasks: [], selectedId: null }
        this.cachedJson = JSON.stringify({ ...this.cached, draftRevision: this.draftRevision })
        return this.cached
      }
      this.readable = false
      this.cached = null
      throw new Error('无法读取本地会话，原文件已保留。请检查会话文件或访问权限后重启应用。')
    }
  }

  save(value: unknown): void {
    if (!this.readable) throw new Error('本地会话尚未成功读取，已停止保存以保护原文件。')
    const state = parseState(value)
    const revision = this.drafts.size ? randomUUID() : this.draftRevision
    const json = JSON.stringify({ ...state, draftRevision: revision })
    // 有草稿覆盖层时必须更换代号；否则相同完整快照可以跳过写盘。
    if (json === this.cachedJson) return
    writeAtomic(this.file, json)
    this.cached = state
    this.cachedJson = json
    this.draftRevision = revision
    this.drafts.clear()
    try { unlinkSync(`${this.file}.drafts.json`) }
    catch { /* 旧覆盖层已由代号失效，清理失败不能把成功保存误报为失败。 */ }
  }

  /** 高频输入只写文字和技能；不校验、序列化或重写历史附件。 */
  saveDrafts(value: unknown): void {
    if (!this.readable || !this.cached) throw new Error('本地会话尚未成功读取，已停止保存以保护原文件。')
    const changes = parseDrafts(value, this.cached)
    if (!changes.length) return
    const drafts = new Map(this.drafts)
    for (const draft of changes) drafts.set(draft.id, draft)
    const next = applyDrafts(this.cached, new Map(changes.map(draft => [draft.id, draft])))
    writeAtomic(`${this.file}.drafts.json`, JSON.stringify({ version: 1, revision: this.draftRevision, drafts: [...drafts.values()] }))
    this.cached = next
    this.drafts = drafts
  }
}
