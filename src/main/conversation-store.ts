import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, openSync, closeSync, fstatSync, writeSync, fsyncSync, ftruncateSync, readSync } from 'node:fs'
import path from 'node:path'
import { open, unlink } from 'node:fs/promises'
import { conversationJsonChunks } from './conversation-json'
import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'
import { applyConversationPatch, parseConversationPatch, type ConversationPatch } from '../shared/conversation-patches'
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
  private sequence = 0
  private basePersisted = false
  private draftRevision: string = randomUUID()
  private drafts = new Map<string, ConversationDraftUpdate>()
  private selectedId: string | null | undefined
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
    if (overlay.revision !== this.draftRevision || (overlay.sequence ?? 0) !== this.sequence) return state
    if (overlay.version !== 1) throw new Error('会话草稿版本无效')
    this.drafts = new Map(parseDrafts(overlay.drafts, state).map(draft => [draft.id, draft]))
    this.selectedId = this.parseSelection(overlay.selectedId, state)
    const next = applyDrafts(state, this.drafts)
    return this.selectedId === undefined ? next : { ...next, selectedId: this.selectedId }
  }

  load(): ConversationState {
    if (this.cached && this.readable) return this.cached
    try {
      const { draftRevision, ...value } = record(JSON.parse(readFileSync(this.file, 'utf8')))
      if (draftRevision !== undefined && typeof draftRevision !== 'string') throw new Error('会话草稿代号无效')
      const state = parseState(value)
      this.draftRevision = (draftRevision as string | undefined) ?? 'legacy'
      this.basePersisted = true
      this.cached = this.loadDrafts(this.loadPatches(state))
      this.readable = true
      // 仅冷启动时压实上一次运行的增量，不在模型选择/新建会话的交互路径重写全库。
      if (this.sequence) {
        void this.compact().catch(() => { /* 原日志仍可恢复；后台压实失败不阻止读取。 */ })
      }
      return this.cached
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.readable = true
        this.cached = { version: 1, tasks: [], selectedId: null }
        this.basePersisted = false
        return this.cached
      }
      this.readable = false
      this.cached = null
      throw new Error('无法读取本地会话，原文件已保留。请检查会话文件或访问权限后重启应用。')
    }
  }

  /** 仅首次建库同步写入空基线；已有库由 compact 异步分段压实。 */
  private checkpoint(): void {
    if (!this.readable || !this.cached) throw new Error('本地会话尚未成功读取，已停止保存以保护原文件。')
    const revision = randomUUID()
    mkdirSync(path.dirname(this.file), { recursive: true })
    const fd = openSync(`${this.file}.tmp`, 'w', 0o600)
    try {
      const write = (text: string): void => {
        const bytes = Buffer.from(text)
        let offset = 0
        while (offset < bytes.length) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset)
          if (!written) throw new Error('会话快照写入未完成')
          offset += written
        }
      }
      for (const chunk of conversationJsonChunks({ ...this.cached, draftRevision: revision })) write(chunk)
      fsyncSync(fd)
    } finally { closeSync(fd) }
    // 只有新快照原子替换成功，才允许清空恢复日志和覆盖层。
    renameSync(`${this.file}.tmp`, this.file)
    this.basePersisted = true
    this.sequence = 0
    try { unlinkSync(`${this.file}.updates.jsonl`) } catch { /* 旧日志由版本代号失效。 */ }
    this.draftRevision = revision
    this.drafts.clear()
    this.selectedId = undefined
    try { unlinkSync(`${this.file}.drafts.json`) }
    catch { /* 旧覆盖层已由代号失效，清理失败不能把成功保存误报为失败。 */ }
  }

  /** 启动压实让出事件循环；任何保存改变基线后立即放弃，绝不覆盖较新的数据。 */
  private async compact(): Promise<void> {
    const snapshot = this.cached, sequence = this.sequence, revision = this.draftRevision
    const stale = (): boolean => this.cached !== snapshot || this.sequence !== sequence || this.draftRevision !== revision || !this.readable
    const nextRevision = randomUUID(), temporary = `${this.file}.checkpoint-${nextRevision}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    let committed = false
    try {
      try {
        for (const chunk of conversationJsonChunks({ ...snapshot!, draftRevision: nextRevision })) {
          if (stale()) return
          await handle.writeFile(chunk, 'utf8')
        }
        await handle.sync()
      } finally { await handle.close() }
      if (stale()) return
      // 此处到发布新版本之间没有 await，保存事务不能插入。
      renameSync(temporary, this.file)
      committed = true
      this.draftRevision = nextRevision
      this.sequence = 0
      this.drafts.clear()
      this.selectedId = undefined
      try { unlinkSync(`${this.file}.updates.jsonl`) } catch { /* 旧日志由版本代号失效。 */ }
      try { unlinkSync(`${this.file}.drafts.json`) } catch { /* 旧覆盖层由版本代号失效。 */ }
    } finally {
      if (!committed) await unlink(temporary).catch(() => {})
    }
  }

  private validateChangedTask(task: ConversationState['tasks'][number], before?: ConversationState['tasks'][number]): void {
    const candidate = { ...task }
    // 未变化的载荷已校验过；选择模型不重新扫描本会话的 Base64、消息和队列。
    if (before && task.messages === before.messages && task.compaction === before.compaction) {
      delete candidate.messages; delete candidate.compaction
    }
    if (before && task.draftImages === before.draftImages) delete candidate.draftImages
    if (before && task.queuedMessages === before.queuedMessages && task.queueEdit === before.queueEdit) {
      delete candidate.queuedMessages; delete candidate.queueEdit
    }
    parseState({ version: 1, tasks: [candidate], selectedId: task.id })
  }

  private loadPatches(state: ConversationState): ConversationState {
    let fd: number
    try { fd = openSync(`${this.file}.updates.jsonl`, 'r+') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return state; throw error }
    this.sequence = 0
    // 分块恢复，避免长期运行的日志被整体读取并 split 成另一份字符串数组。
    const buffer = Buffer.alloc(64 * 1024), decoder = new StringDecoder('utf8')
    let pending = '', committedBytes = 0
    try {
      let count: number
      while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        pending += decoder.write(buffer.subarray(0, count))
        let end: number
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end)
          committedBytes += Buffer.byteLength(line) + 1
          pending = pending.slice(end + 1)
          if (!line) continue
          const entry = record(JSON.parse(line))
          if (entry.revision !== this.draftRevision) continue
          if (entry.sequence !== this.sequence + 1) throw new Error('会话增量顺序无效')
          const before = new Map(state.tasks.map(task => [task.id, task]))
          state = applyConversationPatch(state, parseConversationPatch(entry.patch), task => this.validateChangedTask(task, before.get(task.id)))
          this.sequence++
        }
      }
      // 断电留下的未完成末行不是已提交事务；只回收尾部，不跳过损坏的完整事务。
      if (fstatSync(fd).size !== committedBytes) { ftruncateSync(fd, committedBytes); fsyncSync(fd) }
    } finally { closeSync(fd) }
    return state
  }

  /** 仅校验变化会话、序列化变化字段，模型切换不扫描其他会话的历史。 */
  savePatch(input: ConversationPatch): void {
    if (!this.readable || !this.cached) throw new Error('本地会话尚未成功读取，已停止保存以保护原文件。')
    const incoming = parseConversationPatch(input)
    const updates = new Map(incoming.updates.map(update => [update.id, update]))
    for (const draft of this.drafts.values()) {
      if (incoming.order && !incoming.order.includes(draft.id)) continue
      const update = updates.get(draft.id) ?? { id: draft.id, fields: {}, unset: [] }
      const fields = { ...update.fields }, unset = [...update.unset]
      for (const key of ['draft', 'draftSkillIds'] as const) {
        if (Object.prototype.hasOwnProperty.call(fields, key) || unset.includes(key)) continue
        if (draft[key] === undefined) unset.push(key)
        else Object.assign(fields, { [key]: draft[key] })
      }
      updates.set(draft.id, { id: draft.id, fields, unset })
    }
    const patch = { ...incoming, updates: [...updates.values()] }
    const before = new Map(this.cached.tasks.map(task => [task.id, task]))
    const next = applyConversationPatch(this.cached, patch, task => this.validateChangedTask(task, before.get(task.id)))
    if (!patch.updates.length && !patch.order && patch.selectedId === this.cached.selectedId) return
    if (!this.basePersisted) this.checkpoint()
    const json = JSON.stringify({ revision: this.draftRevision, sequence: this.sequence + 1, patch }) + '\n'
    const fd = openSync(`${this.file}.updates.jsonl`, 'a', 0o600)
    let size: number | undefined
    try {
      size = fstatSync(fd).size
      const bytes = Buffer.from(json)
      let offset = 0
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset)
        if (!written) throw new Error('会话增量写入未完成')
        offset += written
      }
      fsyncSync(fd)
    } catch (error) {
      if (size !== undefined) {
        try { ftruncateSync(fd, size); fsyncSync(fd) } catch { this.readable = false }
      }
      throw error
    } finally { closeSync(fd) }
    this.cached = next
    this.sequence++
    // 已将草稿合入日志；迟到的旧覆盖层因 sequence 不匹配而失效。
    this.drafts.clear()
    this.selectedId = undefined
  }

  private parseSelection(value: unknown, state: ConversationState): string | null | undefined {
    if (value === undefined || value === null) return value
    if (typeof value !== 'string' || !state.tasks.some(task => task.id === value)) throw new Error('选中的会话无效')
    return value
  }

  /** 输入和会话切换只写轻量覆盖层，不复制、序列化或重写历史附件。 */
  saveDrafts(value: unknown, selection?: unknown): void {
    if (!this.readable || !this.cached) throw new Error('本地会话尚未成功读取，已停止保存以保护原文件。')
    const changes = parseDrafts(value, this.cached)
    const selectedId = this.parseSelection(selection, this.cached)
    if (!changes.length && (selectedId === undefined || selectedId === this.cached.selectedId)) return
    const drafts = new Map(this.drafts)
    for (const draft of changes) drafts.set(draft.id, draft)
    const next = applyDrafts(this.cached, new Map(changes.map(draft => [draft.id, draft])))
    const retainedSelection = selectedId === undefined ? this.selectedId : selectedId
    if (retainedSelection !== undefined) next.selectedId = retainedSelection
    writeAtomic(`${this.file}.drafts.json`, JSON.stringify({ version: 1, revision: this.draftRevision, sequence: this.sequence, drafts: [...drafts.values()], selectedId: retainedSelection }))
    this.cached = next
    this.drafts = drafts
    this.selectedId = retainedSelection
  }
}
