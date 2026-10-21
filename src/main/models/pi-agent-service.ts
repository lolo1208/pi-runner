import { mkdir, readdir, rm, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createAgentSession, createExtensionRuntime, estimateTokens as estimatePiTokens, SessionManager, SettingsManager, type AgentSession, type ResourceLoader, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
import type { ChatExecution, ChatMessage, ChatWorkItem, ModelProfile, ModelReply, ModelRateLimit, AgentRequestOptions, AgentEvent, OutputSpeed } from '../../shared/models'
import { systemOutputTokens } from '../../shared/output-tokens'
import { estimateContextTokens, estimateTextTokens, normalizeCompressionThreshold, type ContextOptions } from '../../shared/context'
import { ShadowGitManager, type PendingCheckpoint } from '../snapshot/shadow-git-manager'
import { PiAttachments } from './pi-attachments'
import { createPiProvider } from './pi-provider'
import { piProjectTools } from './pi-tools'
import { emptyReplyMessage } from './model-empty-reply'
import { ModelError, profileId } from './model-validation'
import { safeModelErrorDetail } from './model-request-error'
import { useFileResponses } from './model-attachments'
import type { ChatgptService } from './chatgpt-service'
import os from 'node:os'
import { ToolApprovalManager } from './tool-permissions'
import { PERMISSION_MODES, type PermissionMode } from '../../shared/models'
import { PlanInteractionManager } from './plan-interactions'
import { PLAN_INSTRUCTION, planTools } from './plan-tools'
import { NativeTerminalSandbox } from './terminal-sandbox'
import type { TerminalSandbox } from './terminal-sandbox'
import { SkillStore } from '../skill-store'
import { saveCodePreviewSnapshot } from '../code-preview-snapshots'
import { collectCodeReferences } from '../../shared/code-preview'

const toolActions: Record<string, string> = {
  bash: '运行命令',
  powershell: '运行命令',
  read: '读取',
  write: '写入',
  edit: '编辑',
  delete: '删除文件',
  mkdir: '创建目录',
  rmdir: '删除目录',
  move: '移动或重命名',
  copy: '复制',
  stat: '查看文件或目录信息',
  ls: '查看目录',
  find: '查找',
  grep: '搜索',
  read_skill_file: '读取技能文件',
  report_skill_usage: '说明技能用途',
  ask_user_question: '确认需求',
  submit_plan: '提交计划'
}

const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
export interface PiAgentDependencies {
  dataDirectory: string
  getProject(): string | undefined
  emit(event: AgentEvent): void
  fetchRequest?: typeof fetch
  chatgpt?: ChatgptService
  protectedDirectories?: string[]
  sandboxRuntimeDirectory?: string
  sandbox?: TerminalSandbox
}

export class PiAgentService {
  private modes = new Map<string, PermissionMode>()
  private approvals: ToolApprovalManager
  private interactions: PlanInteractionManager
  private sandbox?: TerminalSandbox
  constructor(private readonly dependencies: PiAgentDependencies) {
    this.approvals = new ToolApprovalManager(dependencies.emit)
    this.interactions = new PlanInteractionManager(dependencies.emit)
    if (dependencies.sandboxRuntimeDirectory) this.sandbox = new NativeTerminalSandbox({
      runtimeDirectory: dependencies.sandboxRuntimeDirectory,
      dataDirectory: path.join(dependencies.dataDirectory, 'command-sandbox'),
      protectedDirectories: [dependencies.dataDirectory, dependencies.sandboxRuntimeDirectory, ...(dependencies.protectedDirectories ?? [])]
    })
    if (dependencies.sandbox) this.sandbox = dependencies.sandbox
  }
  respondPlanInteraction(requestId: string, conversationId: string, id: string, response: unknown): void { this.interactions.respond(requestId, conversationId, id, response) }
  permission(id: string): PermissionMode { return this.modes.get(id) ?? 'default' }
  setPermission(id: string, mode: PermissionMode): void {
    if (!PERMISSION_MODES.includes(mode)) throw new ModelError('权限模式无效')
    this.modes.set(id, mode)
  }
  respondApproval(requestId: string, conversationId: string, id: string, allow: boolean): void { this.approvals.respond(requestId, conversationId, id, allow) }
  approvalPreview(requestId: string, conversationId: string, id: string) { return this.approvals.preview(requestId, conversationId, id) }
  confirmFullPermission(conversationId: string, signal: AbortSignal): Promise<boolean> {
    return this.approvals.ask(randomUUID(), conversationId, { toolCallId: randomUUID(), tool: 'full-access', args: {}, cwd: '', reason: '开启完全访问？' }, signal, () => {}, false)
  }
  private directory(id: string): string { return path.join(this.dependencies.dataDirectory, 'agent-sessions', createHash('sha256').update(profileId(id)).digest('hex')) }
  private async manager(id: string, cwd: string): Promise<SessionManager> {
    const directory = this.directory(id)
    await mkdir(directory, { recursive: true })
    const files = (await readdir(directory)).filter(file => file.endsWith('.jsonl'))
    if (files.length > 1) throw new ModelError('代理会话存在多个记录文件，请检查本地会话数据')
    return files.length ? SessionManager.open(path.join(directory, files[0]), directory, cwd) : SessionManager.create(cwd, directory)
  }
  async history(id: string): Promise<ChatMessage[] | null> {
    const directory = this.directory(id)
    try {
      const files = (await readdir(directory)).filter(file => file.endsWith('.jsonl'))
      if (!files.length) return null
      const skills = await new SkillStore(path.join(this.dependencies.dataDirectory, 'skills')).list()
      return this.transcript(SessionManager.open(path.join(directory, files[0]), directory), new Map(skills.map(skill => [skill.id, skill])))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new ModelError('无法恢复代理会话，请检查本地会话文件')
    }
  }
  async remove(id: string): Promise<void> { await rm(this.directory(id), { recursive: true, force: true }); this.modes.delete(id) }
  async deleteRound(id: string, index: number, expectedHistoryId?: string): Promise<ChatMessage[] | null> {
    const directory = this.directory(id)
    let files: string[]
    try { files = (await readdir(directory)).filter(file => file.endsWith('.jsonl')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (!files.length) return null
    if (files.length !== 1) throw new ModelError('代理会话存在多个记录文件，请检查本地会话数据')
    const file = path.join(directory, files[0])
    const manager = SessionManager.open(file, directory)
    const skills = await new SkillStore(path.join(this.dependencies.dataDirectory, 'skills')).list()
    const displaySkills = new Map(skills.map(skill => [skill.id, skill]))
    const visibleIds: string[] = []
    const messages = this.transcript(manager, displaySkills, visibleIds)
    if (messages[index]?.role !== 'user') throw new ModelError('这轮对话已变化，请重新打开会话后重试')
    if (expectedHistoryId !== undefined && visibleIds[index] !== expectedHistoryId) throw new ModelError('这轮对话已变化，请重新打开会话后重试')
    const next = messages.findIndex((message, position) => position > index && message.role === 'user')
    const branch = manager.getBranch()
    const branchIds = new Set(branch.map(entry => entry.id))
    const start = branch.findIndex(entry => entry.id === visibleIds[index])
    const end = next < 0 ? branch.length : branch.findIndex(entry => entry.id === visibleIds[next])
    const round = branch.slice(start, end)
    const fileIds = new Set(round.flatMap(entry => entry.type === 'message' && entry.message.role === 'user'
      ? [...JSON.stringify(entry.message).matchAll(/\[pi-runner-files:([\w-]+)\]/g)].map(match => match[1]) : []))
    const removed = new Set(round.filter(entry => !(entry.type === 'custom' && entry.customType === 'pi-runner-files') && entry.type !== 'compaction' && entry.type !== 'branch_summary').map(entry => entry.id))
    const entries = manager.getEntries()
    for (const entry of entries) {
      if (entry.type === 'custom') {
        const data = entry.data as { id?: string; entryId?: string }
        if ((entry.customType === 'pi-runner-files' && fileIds.has(data?.id ?? '')) || (data?.entryId && removed.has(data.entryId))) removed.add(entry.id)
      }
      if ((entry.type === 'context_edit' || entry.type === 'label') && removed.has(entry.targetId)) removed.add(entry.id)
      if (entry.type === 'custom' && entry.customType === 'pi-runner-execution'
        && (entry.data as { entryIds: string[] }).entryIds.every(id => removed.has(id))) removed.add(entry.id)
    }
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const retained = entries.flatMap(entry => {
      if (removed.has(entry.id)) return []
      // 摘要累积旧内容，使用保留的原始消息重建；其他轮次的信息保持完整。
      if (entry.type === 'compaction' || entry.type === 'branch_summary') {
        const ancestors = [...new Map([
          ...(entry.type === 'branch_summary' ? manager.getBranch(entry.fromId) : []),
          ...manager.getBranch(entry.id)
        ].map(ancestor => [ancestor.id, ancestor])).values()]
        if (ancestors.some(ancestor => removed.has(ancestor.id))) {
          const source = ancestors.filter(ancestor => !removed.has(ancestor.id) && (ancestor.type === 'message' || ancestor.type === 'custom_message' || ancestor.type === 'custom' && ancestor.customType === 'pi-runner-files'))
          entry = { ...entry, summary: source.map(ancestor => JSON.stringify(ancestor)).join('\n') || '此前没有保留的对话内容。', details: undefined }
          if (entry.type === 'compaction') entry = { ...entry, firstKeptEntryId: entry.id, systemMessage: undefined }
          if (entry.type === 'branch_summary') {
            let fromId: string | null = entry.fromId
            while (fromId && removed.has(fromId)) fromId = byId.get(fromId)?.parentId ?? null
            entry = { ...entry, fromId: fromId ?? entry.id }
          }
        }
      }
      if (entry.type === 'custom' && entry.customType === 'pi-runner-execution') {
        const data = entry.data as { entryIds: string[] }
        const entryIds = data.entryIds.filter(id => !removed.has(id))
        entry = { ...entry, data: { ...data, entryIds } }
      }
      if (entry.type === 'custom' && entry.customType === 'pi-runner-snapshot' && branchIds.has(entry.id)) {
        const data = entry.data as import('../../shared/models').AgentSnapshot
        const endIndex = next < 0 ? messages.length : next
        if (data.messageIndex !== undefined && data.messageIndex >= endIndex) entry = { ...entry, data: { ...data, messageIndex: data.messageIndex - (endIndex - index) } }
      }
      let parentId = entry.parentId
      while (parentId && removed.has(parentId)) parentId = byId.get(parentId)?.parentId ?? null
      return [{ ...entry, parentId }]
    })
    const temporary = `${file}.delete-${randomUUID()}.tmp`
    try {
      await writeFile(temporary, [manager.getHeader(), ...retained].map(entry => JSON.stringify(entry)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600, flush: true })
      await rename(temporary, file)
    } finally { await rm(temporary, { force: true }) }
    return this.transcript(SessionManager.open(file, directory), displaySkills)
  }
  private transcript(manager: SessionManager, skills: ReadonlyMap<string, { name: string }> = new Map(), visibleIds?: string[]): ChatMessage[] {
    const attachments = new Map<string, ChatMessage>()
    const executions = new Map<string, ChatExecution>()
    const skillNotices = new Map<string, string>()
    const durations = new Map<string, number>()
    const skillCallNames = new Map<string, string>()
    const results = new Map<string, { content: string; isError: boolean }>()
    for (const entry of manager.getBranch()) {
      if (entry.type === 'custom' && entry.customType === 'pi-runner-skill-call') {
        const data = entry.data as { toolCallId: string; name: string }
        skillCallNames.set(data.toolCallId, data.name)
      }
      if (entry.type === 'custom' && entry.customType === 'pi-runner-skill-usage') {
        const data = entry.data as { entryId: string; notice: string }
        skillNotices.set(data.entryId, data.notice)
      }
      if (entry.type === 'message' && entry.message.role === 'toolResult') results.set(entry.message.toolCallId, {
        content: entry.message.content.map(block => block.type === 'text' ? block.text : '[图片结果]').join('\n'), isError: entry.message.isError
      })
      if (entry.type === 'custom' && entry.customType === 'pi-runner-call-duration') {
        const data = entry.data as { messageTimestamp: number; elapsedMs: number }; durations.set(String(data.messageTimestamp), data.elapsedMs)
      }
    }
    const snapshotHashes = new Map<string, string>()
    const codeSnapshots = new Map<string, string>()
    let lastMessageId: string | undefined
    // 使用原生历史中的快照记录定位轮次，旧会话无需猜测消息序号。
    for (const entry of manager.getBranch()) {
      if (entry.type === 'custom' && entry.customType === 'pi-runner-code-preview') {
        const data = entry.data as { entryId: string; snapshotId: string }
        codeSnapshots.set(data.entryId, data.snapshotId)
      }
      if (entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant')) {
        const content = entry.message.content
        if (typeof content === 'string' ? content.trim() : content.some(block => block.type === 'text' && block.text.trim())) lastMessageId = entry.id
      }
      if (entry.type === 'custom' && entry.customType === 'pi-runner-snapshot' && lastMessageId) {
        const data = entry.data as import('../../shared/models').AgentSnapshot
        snapshotHashes.set(lastMessageId, data.after.hash)
      }
    }
    for (const entry of manager.getEntries()) if (entry.type === 'custom' && entry.customType === 'pi-runner-execution') {
      const data = entry.data as { entryIds: string[]; execution: ChatExecution }
      for (const id of data.entryIds) executions.set(id, data.execution)
    }
    for (const entry of manager.getEntries()) if (entry.type === 'custom' && entry.customType === 'pi-runner-files') {
      const data = entry.data as { id: string; message: ChatMessage }; attachments.set(data.id, data.message)
    }
    return manager.getBranch().flatMap(entry => {
      // 问答与审阅由工具记录生成卡片，旧版辅助文字仍保留在会话文件中，避免重复展示。
      if (entry.type !== 'message' || (entry.message.role !== 'user' && entry.message.role !== 'assistant')) return []
      const message = entry.message
      const content = typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const original = attachments.get(/\[pi-runner-files:([\w-]+)\]/.exec(content)?.[1] ?? '')
      const execution = executions.get(entry.id)
      const call = message.role === 'assistant' ? {
        elapsedMs: durations.get(String(message.timestamp)),
        ...(message.stopReason !== 'error' && message.stopReason !== 'aborted' && message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite > 0 ? {
          usage: { inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite, outputTokens: message.usage.output }
        } : {}),
        work: message.content.flatMap((block, index): import('../../shared/models').ChatWorkItem[] => {
          if (block.type === 'thinking') return [{ id: `${entry.id}-${index}`, kind: 'thinking', content: block.thinking }]
          if (block.type !== 'toolCall') return []
          const result = results.get(block.id)
          const skillName = skills.get(String(block.arguments.skillId ?? ''))?.name ?? skillCallNames.get(block.id)
          return [{ id: block.id, kind: 'tool', name: block.name, ...(skillName ? { skillName } : {}), args: block.arguments, content: result?.content ?? '', completed: Boolean(result), isError: result?.isError }]
        })
      } : undefined
      if (original || content.trim() || call?.work.length) visibleIds?.push(entry.id)
      return original ? [{ ...original, historyId: entry.id, ...(snapshotHashes.has(entry.id) ? { snapshotHash: snapshotHashes.get(entry.id) } : {}) }] : content.trim() || call?.work.length ? [{ role: message.role as 'user' | 'assistant', content: content + (skillNotices.get(entry.id) ?? ''), historyId: entry.id,
        ...(call ? { call } : {}),
        ...(codeSnapshots.has(entry.id) ? { codeSnapshotId: codeSnapshots.get(entry.id) } : {}),
        ...(snapshotHashes.has(entry.id) ? { snapshotHash: snapshotHashes.get(entry.id) } : {}),
        ...(execution ? { execution } : message.role === 'assistant' ? { execution: { model: message.model } } : {}) }] : []
    })
  }
  async run(profile: ModelProfile, apiKey: string, messages: ChatMessage[], signal: AbortSignal, instruction: string, context: ContextOptions | undefined, options: AgentRequestOptions | undefined, requestId: string, isTest: boolean, onModelRequestActive: (active: boolean) => void = () => {}): Promise<ModelReply> {
    const publish = (event: Omit<AgentEvent, 'requestId' | 'conversationId'>): void => {
      try { this.dependencies.emit({ ...event, requestId, conversationId: options?.conversationId ?? requestId }) }
      catch { console.warn('会话事件发送失败，任务继续执行') }
    }
    publish({ type: 'status', text: '正在准备会话…' })
    const skillStore = new SkillStore(path.join(this.dependencies.dataDirectory, 'skills'))
    const displaySkills = new Map((isTest ? [] : await skillStore.list()).map(skill => [skill.id, skill]))
    const skillIds = isTest ? [] : messages.at(-1)?.skillIds ?? []
    const discoveredSkills = isTest ? [] : await skillStore.discoverable()
    const selectedSkills = skillIds.length ? await skillStore.selected(skillIds) : []
    const usedSkills = new Map(selectedSkills.map(skill => [skill.id, skill]))
    const skillPurposes = new Map<string, string>()
    const recordPurpose = (skillId: string, purpose: unknown): void => {
      if (!usedSkills.has(skillId)) throw new ModelError('只能说明本轮已加载技能的用途')
      if (typeof purpose !== 'string' || !/[\u4e00-\u9fff]/.test(purpose) || !purpose.trim() || purpose.length > 200 || /[\r\n]/.test(purpose)) throw new ModelError('请用不超过 200 字的单句中文说明技能在本次任务中的具体用途')
      skillPurposes.set(skillId, purpose.trim().replace(/[。.!！]+$/, ''))
    }
    const availableSkills = new Map([...discoveredSkills, ...selectedSkills].map(skill => [skill.id, skill]))
    const availableSkillIds = [...new Set([...skillIds, ...discoveredSkills.map(skill => skill.id)])]
    if (discoveredSkills.length) instruction = [instruction,
      '以下是已启用、可自动触发的本地技能。根据本轮用户输入中的关键词、任务意图及技能描述的触发条件判断适用技能；即使用户没有手动选择，匹配时也必须先调用 read_skill_file 读取该技能的 SKILL.md，再按照其中的指令和设定完成任务。可以按需使用多个适用技能；不相关时不要调用。需要参考文件时继续使用 read_skill_file。技能不改变现有工具权限。标有 disable-model-invocation 的技能不参与自动触发。',
      JSON.stringify(discoveredSkills.map(({ id, name, description }) => ({ skillId: id, name, description })))
    ].filter(Boolean).join('\n\n')
    if (skillIds.length) instruction = [instruction, await skillStore.instruction(skillIds)].filter(Boolean).join('\n\n')
    if (availableSkillIds.length) instruction = [instruction,
      '技能使用说明：应用会在最终回复正文中自动补充用户手动选择和自动触发的技能说明，格式为“本次使用了 技能名称 技能来具体用途。”完成任务后、最终回复前，必须调用 report_skill_usage，为每个本轮已加载的技能提供结合实际任务的简短中文用途，例如“确定网站视觉方向并完成页面实现”或“整理本次代码改动并生成 Git 提交信息”。purpose 只写“来”后面的动作，不抄技能原始描述、触发条件或英文介绍，不夸大实际完成的工作。也可以在 read_skill_file 中提供 purpose。正文无需重复添加技能说明。不要把仅出现在可用列表中、读取失败或历史轮次使用过的技能说成本轮已使用。'
    ].filter(Boolean).join('\n\n')
    const skillTools: ToolDefinition[] = availableSkillIds.length ? [{
      name: 'read_skill_file', label: '读取技能文件', description: '读取手动选择或描述匹配的已启用技能。自动触发时必须先读取 SKILL.md，再遵循技能指令；参考文档或脚本使用相对技能目录的路径。',
      parameters: { type: 'object', properties: { skillId: { type: 'string' }, file: { type: 'string' }, purpose: { type: 'string', description: '技能在本轮任务中的具体用途，简短中文动作，例如“整理代码改动并生成 Git 提交信息”。' } }, required: ['skillId', 'file'], additionalProperties: false } as ToolDefinition['parameters'],
      execute: async (_id, args) => {
        const { skillId, file, purpose } = args as { skillId: string; file: string; purpose?: string }
        const text = await skillStore.readResource(availableSkillIds, skillId, file)
        if (file.replaceAll('\\', '/').replace(/^\.\//, '') === 'SKILL.md') {
          const skill = availableSkills.get(skillId)
          if (skill) usedSkills.set(skillId, skill)
        }
        if (purpose !== undefined) recordPurpose(skillId, purpose)
        return { content: [{ type: 'text', text }], details: {} }
      }
    }, {
      name: 'report_skill_usage', label: '说明技能用途', description: '最终回复前，记录本轮已加载技能在实际任务中的具体用途。用简短中文动作说明，不复制技能描述。',
      parameters: { type: 'object', properties: { skillId: { type: 'string' }, purpose: { type: 'string' } }, required: ['skillId', 'purpose'], additionalProperties: false } as ToolDefinition['parameters'],
      execute: async (_id, args) => {
        const { skillId, purpose } = args as { skillId: string; purpose: string }
        recordPurpose(skillId, purpose)
        return { content: [{ type: 'text', text: '已记录，应用将在回复末尾补充技能使用说明。' }], details: {} }
      }
    }] : []
    const started = performance.now()
    const project = options?.project ?? undefined
    if (project && !path.isAbsolute(project)) throw new ModelError('项目路径必须是绝对路径')
    const snapshot = project ? await ShadowGitManager.open(project, this.dependencies.dataDirectory) : undefined
    const cwd = snapshot?.getRoot() ?? os.homedir()
    const mode = options ? this.permission(options.conversationId) : 'default'
    let planning = !isTest && options?.intentMode === 'plan'
    let planningMutationAttempted = false
    let approvedPlan: { title: string; content: string } | undefined
    let executionTransitionPending = false, executionToolCalls = 0
    let clarified = false, interactionVersion = 0
    const manager = options ? await this.manager(options.conversationId, cwd) : SessionManager.inMemory(cwd)
    const pendingCodeSnapshots: Promise<void>[] = []
    const attachments = new PiAttachments(manager)
    const responses = useFileResponses(profile, [...this.transcript(manager, displaySkills), ...messages])
    let rateLimits: ModelRateLimit[] = [], before: PendingCheckpoint | undefined
    let beforePromise: Promise<void> | undefined
    // 流式输出速度统计：按秒级窗口采样，节流后随事件下发，供输入框角落的速度指示器使用。
    const speed = { outputTokens: 0, windowTokens: 0, windowStarted: 0, firstDelta: 0, peak: 0, recent: 0, samples: [] as OutputSpeed['samples'], lastPublish: 0 }
    const publishSpeed = (force = false): void => {
      const now = performance.now()
      if (!force && now - speed.lastPublish < 250) return
      speed.lastPublish = now
      const elapsedMs = speed.firstDelta ? now - speed.firstDelta : 0
      publish({ type: 'speed', speed: {
        outputTokens: speed.outputTokens,
        recentTokensPerSecond: Math.round(speed.recent),
        // 平均速度需满 1 秒样本，否则首包阶段分母过小会得到畸形的高值。
        averageTokensPerSecond: elapsedMs >= 1000 ? Math.round(speed.outputTokens / (elapsedMs / 1000)) : 0,
        peakTokensPerSecond: Math.round(speed.peak),
        firstResponseMs: speed.firstDelta ? Math.round(speed.firstDelta - started) : null,
        elapsedMs: Math.round(elapsedMs),
        samples: [...speed.samples]
      } })
    }
    const trackOutputDelta = (text: string): void => {
      if (!text) return
      const tokens = estimateTextTokens(text)
      if (!tokens) return
      const now = performance.now()
      if (!speed.firstDelta) speed.firstDelta = now
      if (!speed.windowStarted) { speed.windowStarted = now; speed.windowTokens = 0 }
      speed.outputTokens += tokens; speed.windowTokens += tokens
      const elapsed = now - speed.windowStarted
      if (elapsed >= 1000) {
        const rate = speed.windowTokens / (elapsed / 1000)
        speed.recent = rate; speed.peak = Math.max(speed.peak, rate)
        speed.samples.push({ at: Date.now(), tokensPerSecond: Math.round(rate) })
        if (speed.samples.length > 60) speed.samples.shift()
        speed.windowStarted = now; speed.windowTokens = 0
        publishSpeed(true)
      } else publishSpeed()
    }
    const activeTools = new Map<string, string>()
    const waitingTools = new Map<string, string>()
    const liveWork = new Map<string, Partial<ChatWorkItem>>()
    let outputTimer: ReturnType<typeof setTimeout> | undefined
    const currentTranscript = (): ChatMessage[] => {
      const messages = this.transcript(manager, displaySkills).map<ChatMessage>(message => !message.call || previousEntries.has(message.historyId ?? '') ? message : {
      ...message, call: { ...message.call, work: message.call.work.map(item => {
        if (item.kind !== 'tool' || item.completed) return item
        const live = liveWork.get(item.id)
        const waiting = waitingTools.get(item.id) ?? (['ask_user_question', 'submit_plan'].includes(item.name ?? '') ? waitingTools.get('plan-interaction') : undefined)
        return { ...item, state: 'queued', ...live, ...(waiting ? { state: 'waiting', stateText: waiting } : {}) }
      }) }
      })
      // 工具开始事件已经给出了参数；即使原生历史尚未保存，也立即提供可展开的记录。
      const recorded = new Set(messages.flatMap(message => message.call?.work.map(item => item.id) ?? []))
      const pending = [...activeTools].filter(([id]) => !recorded.has(id)).map(([id, name]): ChatWorkItem => ({
        id, kind: 'tool', name, args: liveWork.get(id)?.args, content: '', completed: false,
        ...liveWork.get(id), ...(waitingTools.has(id) ? { state: 'waiting', stateText: waitingTools.get(id) } : {})
      }))
      if (pending.length) messages.push({ role: 'assistant', historyId: `live:${requestId}`, content: '', execution: { model: profile.model, provider: profile.provider }, call: { work: pending } })
      return messages
    }
    const publishTranscript = (): void => publish({ type: 'transcript', messages: currentTranscript() })
    const outputText = (result: { content?: { type: string; text?: string }[] } | undefined): string =>
      (result?.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
    let modelStatus = '正在连接模型…', lastStatus = ''
    const status = (text: string, resetText = false): void => {
      if (text === lastStatus && !resetText) return
      lastStatus = text
      publish({ type: 'status', text, ...(resetText ? { resetText: true } : {}) })
    }
    const refreshStatus = (): void => {
      if (signal.aborted) { status('正在停止任务…'); return }
      const actions = [...new Set([...activeTools].filter(([id, name]) => !waitingTools.has(id) && !(waitingTools.has('plan-interaction') && ['ask_user_question', 'submit_plan'].includes(name))).map(([, name]) => toolActions[name] ?? '执行任务'))]
      const waiting = [...new Set(waitingTools.values())]
      status([...actions.map(action => `正在${action}...`), ...waiting].join('；') || modelStatus)
    }
    const waitingFor = (id: string, text: string) => (waiting: boolean): void => {
      if (waiting) waitingTools.set(id, text)
      else waitingTools.delete(id)
      refreshStatus()
      publishTranscript()
    }
    status(modelStatus)
    const provider = await createPiProvider(profile, apiKey, attachments, responses, limits => { rateLimits = limits }, this.dependencies.fetchRequest, this.dependencies.chatgpt, onModelRequestActive)
    signal.throwIfAborted()
    // 仅首次迁移导入旧聊天；之后以 pi 的完整会话（含工具结果）为准。
    if (!manager.getEntries().some(entry => entry.type === 'message')) for (const message of messages.slice(0, -1)) {
      if (message.role === 'user') {
        const prepared = attachments.prepare(message)
        manager.appendMessage({ role: 'user', content: [{ type: 'text', text: prepared.text }, ...prepared.images], timestamp: Date.now() })
      } else manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: message.content }], timestamp: Date.now(), api: provider.model.api, provider: provider.model.provider, model: profile.model, usage: emptyUsage(), stopReason: 'stop' })
    }
    const threshold = normalizeCompressionThreshold(context?.threshold)
    const window = provider.model.contextWindow
    // 模型输出能力可能等于整个上下文；压缩预留不能因此挤掉全部输入空间。
    const reserveTokens = Math.max(Math.min(provider.model.maxTokens, Math.floor(window / 2)), Math.ceil(window * (1 - threshold / 100)))
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: !isTest, reserveTokens, keepRecentTokens: Math.max(128, Math.min(20000, Math.floor(window * .25))) }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: 'off', images: { autoResize: false }, enableAnalytics: false, enableInstallTelemetry: false })
    const resourceLoader: ResourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }), getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => isTest ? '' : ["辅助脚本、截图、日志、下载中间文件及工具缓存优先写入系统临时目录的专用子目录，完成后清理。必须在项目内暂存时，仅使用 tmp/、temp/ 或 .tmp/ 下的专用子目录，避免在项目根目录散落临时文件或缓存。构建产物和用户明确要求保留的文件遵循项目约定。", '你是 Pi Runner · 行动派的助手。对话、注释与日志以中文为主。', `当前权限模式：${mode === 'auto' ? '项目沙箱' : mode === 'full' ? '完全访问' : '每次询问'}。“每次询问”模式下，文件和目录修改及命令执行前均需询问用户并获得批准；项目沙箱模式由系统沙箱隔离执行，自动允许项目内操作，允许普通文件和目录的创建、修改、删除、查询、移动、重命名和复制；完全访问使用当前用户的本机权限，文件修改、删除、命令与脚本执行、项目外访问及联网均不再逐项请求批准；此模式不要自行询问执行许可。文件和目录操作必须优先使用专用工具，不要用终端命令代替：mkdir 创建目录，write 写入文件，edit 修改文件，delete 删除文件，rmdir 删除目录（删除非空目录时设置 recursive=true），move 移动或重命名，copy 复制，stat 查看信息，ls 查看目录内容，find 查找文件或目录，grep 搜索文件内容，read 读取文件。批量操作先用 find 查找，再逐项调用对应工具。执行模式下，用户已经明确要求的项目内文件和目录操作直接调用工具，是否需要审批由应用执行，不要额外询问执行许可。项目沙箱模式下的复合脚本和其他终端命令在系统沙箱内直接运行，项目外普通文件读写会被系统拦截；调用全局工具、测试子进程和联网无需审批；不要仅因命令复杂就询问许可。不要因工具位于项目外、命令组合、测试或联网设置 outsideSandbox=true。只有需要读取或写入项目外普通文件时才同时设置 externalFileAccess=true 和 outsideSandbox=true，应用将请求批准。应用会自动处理可安全恢复的文件操作、隔离配置和运行时访问问题；按工具返回的 recovery 状态继续任务。调用全局工具、测试子进程和联网不申请完整本机权限；工具不可用时保留兼容性错误。其他错误先根据原始结果调整实现；partial-or-unknown 表示可能已完成部分操作，先核对结果，只完成剩余步骤，不重放整段脚本。不得绕过 denied 或 awaiting-approval 状态重复申请相同授权。Windows PowerShell 5 的 Remove-Item 等路径命令可能访问项目祖先而被拒绝，优先使用专用文件工具或项目内 System.IO API。用户拒绝后请调整方案，不要变换语法重试相同动作。${project ? `当前项目：${project}` : '未绑定项目，不存在自动授权的工作区。'}`, instruction, planning ? PLAN_INSTRUCTION : '当前为执行模式。若本轮计划已批准，请按批准内容执行。'].filter(Boolean).join('\n\n'),
      getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {}
    }
    const projectTools = isTest || !options ? [] : piProjectTools(snapshot?.getRoot() ?? cwd, () => snapshot ? beforePromise ??= (async () => {
      status('正在保存修改前快照…')
      try { before = await snapshot.prepareCheckpoint() }
      finally { refreshStatus() }
    })() : Promise.resolve(), {
      mode, project: snapshot?.getRoot(), protectedDirectories: [this.dependencies.dataDirectory, path.join(os.homedir(), '.pi-runner-execution'), ...(this.dependencies.sandboxRuntimeDirectory ? [this.dependencies.sandboxRuntimeDirectory] : []), ...(this.dependencies.protectedDirectories ?? [])],
      sandbox: this.sandbox,
      onRecovery: message => status(message),
      approve: (id, tool, args, reason, toolSignal) => this.approvals.ask(requestId, options.conversationId, { toolCallId: id, tool, args: structuredClone(args), cwd, reason }, toolSignal ?? signal, waitingFor(id, `等待你批准${toolActions[tool] ?? '操作'}…`)).then(() => {})
    })
    let session: AgentSession | undefined
    const planningTools = (): string[] => ['read', 'ls', 'find', 'grep', 'stat', ...skillTools.map(tool => tool.name), 'ask_user_question', ...(clarified ? ['submit_plan'] : [])]
    const guardedTools = projectTools.map(tool => ({ ...tool, execute: async (...args: Parameters<typeof tool.execute>) => {
      await Promise.all(pendingCodeSnapshots)
      if (planning && !['read', 'ls', 'find', 'grep', 'stat'].includes(tool.name)) {
        planningMutationAttempted = true
        throw new ModelError('计划尚未批准，不能修改文件或执行终端命令。请先澄清需求并提交计划。')
      }
      if (!planning) executionToolCalls++
      return tool.execute(...args)
    } }))
    const interactions = planning && options ? planTools(
      async (details, toolSignal) => {
        manager.appendCustomEntry('pi-runner-plan-message', { role: 'assistant', content: details.kind === 'review' ? `${details.title}\n\n${details.content}` : (details.questions ?? []).map(question => `${question.question}\n${question.options.map(option => `- ${option.label}${option.description ? `：${option.description}` : ''}`).join('\n')}`).join('\n\n') } satisfies ChatMessage)
        publishTranscript()
        const response = await this.interactions.ask(requestId, options.conversationId, details, toolSignal ?? signal, waitingFor('plan-interaction', details.kind === 'questions' ? '等待你回答问题…' : '等待你审阅计划…'))
        signal.throwIfAborted()
        interactionVersion++
        if (details.kind === 'questions') { clarified = true; session?.setActiveToolsByName(planningTools()) }
        manager.appendCustomEntry('pi-runner-plan-message', { role: 'user', content: response.answers ? (details.questions ?? []).map(question => `${question.header || question.question}：${response.answers![question.id]}`).join('\n') : response.decision === 'approve' ? '批准计划并开始执行' : `修改计划：${response.feedback}` } satisfies ChatMessage)
        publishTranscript()
        return response
      },
      (title, content) => {
        signal.throwIfAborted()
        manager.appendCustomEntry('pi-runner-approved-plan', { title, content, approvedAt: new Date().toISOString(), requestId })
        approvedPlan = { title, content }
        executionTransitionPending = true
        planning = false
        session?.setActiveToolsByName([...projectTools, ...skillTools].map(tool => tool.name))
        publish({ type: 'intent-mode', intentMode: 'execute' })
        status('计划已批准，正在执行…')
      }, () => planning, () => clarified) : []
    const tools = [...guardedTools, ...skillTools, ...interactions]
    const previousEntries = new Set(manager.getEntries().map(entry => entry.id))
    let executionSaved = false
    let completedReply: ModelReply | undefined
    const warnings: string[] = []
    const warn = (warning: string): void => { if (!warnings.includes(warning)) { warnings.push(warning); console.warn(warning) } }
    const finishSafely = async (action: () => unknown, warning: string): Promise<void> => {
      try { await action() }
      catch { warn(warning) }
    }
    const saveExecution = (): number => {
      const elapsedMs = Math.round(performance.now() - started)
      const entryIds = manager.getEntries().filter(entry => !previousEntries.has(entry.id) && entry.type === 'message' && entry.message.role === 'assistant').map(entry => entry.id)
      if (entryIds.length) manager.appendCustomEntry('pi-runner-execution', { entryIds, execution: { model: profile.model, provider: profile.provider, elapsedMs, roundId: requestId } })
      executionSaved = true
      return elapsedMs
    }
    const roundUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    let unsubscribe: (() => void) | undefined
    let completedResponse = false
    let callStarted = performance.now()
    const abort = (): void => { status('正在停止任务…'); if (session) void session.abort() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      session = (await createAgentSession({ cwd, agentDir: path.join(this.dependencies.dataDirectory, 'agent-config'), modelRuntime: provider.runtime, model: provider.model, thinkingLevel: provider.thinkingLevel, sessionManager: manager, settingsManager, resourceLoader,
        tools: tools.map(tool => tool.name), customTools: tools })).session
      if (planning) session.setActiveToolsByName(planningTools())
      // SDK 同一轮会保留开始时的系统提示词。批准后结束计划轮次，
      // 再通过新轮次重新加载执行提示词，避免仅切换工具仍受计划指令限制。
      const finishTurn = session.agent.finishTurn
      session.agent.finishTurn = async (turn, turnSignal) => {
        const decision = await finishTurn?.(turn, turnSignal)
        // SDK 会在成功回复后再压缩。推迟到下一次 prompt，避免后台摘要失败覆盖已完成的回复。
        if (turn.message.stopReason === 'stop' || executionTransitionPending) session?.setAutoCompactionEnabled(false)
        return executionTransitionPending ? { action: 'end' } : decision || undefined
      }
      signal.throwIfAborted()
      unsubscribe = session.subscribe(event => {
        if (event.type === 'turn_start') { modelStatus = '正在连接模型…'; refreshStatus() }
        if (event.type === 'message_end' && event.message.role === 'assistant') {
          if (project && options) {
            const message = event.message
            const source = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
            if (collectCodeReferences(source).length) {
              pendingCodeSnapshots.push(finishSafely(async () => {
                // SDK 在通知监听器后同步追加消息；让出当前调用栈后再关联准确的原生条目。
                await Promise.resolve()
                const entry = manager.getEntries().find(entry => entry.type === 'message' && entry.message === message)
                if (!entry) throw new Error('无法关联报告的会话消息')
                manager.appendCustomEntry('pi-runner-code-preview', { entryId: entry.id, snapshotId: 'pending' })
                try {
                  const snapshotId = await saveCodePreviewSnapshot(this.directory(options.conversationId), project, source)
                  manager.appendCustomEntry('pi-runner-code-preview', { entryId: entry.id, snapshotId: snapshotId ?? 'unavailable' })
                } catch (error) {
                  manager.appendCustomEntry('pi-runner-code-preview', { entryId: entry.id, snapshotId: 'unavailable' })
                  throw error
                } finally {
                  publishTranscript()
                }
              }, '审查时代码快照保存失败，请重新生成报告'))
            }
          }
          completedResponse = event.message.stopReason === 'stop' && !signal.aborted
          try { manager.appendCustomEntry('pi-runner-call-duration', { messageTimestamp: event.message.timestamp, elapsedMs: Math.round(performance.now() - callStarted) }) }
          catch { warn('模型调用耗时记录保存失败') }
          const usage = event.message.usage
          roundUsage.inputTokens += usage.input + usage.cacheRead + usage.cacheWrite
          roundUsage.outputTokens += usage.output
          roundUsage.cacheReadTokens += usage.cacheRead
          roundUsage.cacheWriteTokens += usage.cacheWrite
        }
        if (event.type === 'message_update') {
          const update = event.assistantMessageEvent
          if (update.type === 'text_start' || update.type === 'text_delta') modelStatus = '正在生成回复…'
          if (update.type === 'thinking_start' || update.type === 'thinking_delta') modelStatus = '正在思考…'
          if (update.type === 'toolcall_start' || update.type === 'toolcall_delta' || update.type === 'toolcall_end') {
            const call = update.partial.content[update.contentIndex]
            modelStatus = call?.type === 'toolCall' && toolActions[call.name] ? `正在准备${toolActions[call.name]}...` : '正在准备工具调用…'
          }
          refreshStatus()
          if (update.type === 'text_delta') { publish({ type: 'text', text: update.delta }); trackOutputDelta(update.delta) }
          if (update.type === 'thinking_delta') trackOutputDelta(update.delta)
        }
        if (event.type === 'message_start' && event.message.role === 'assistant') { completedResponse = false; callStarted = performance.now(); modelStatus = '正在等待模型回复…'; status(modelStatus, true) }
        // SDK 先通知订阅者，再同步保存消息；等当前调用栈结束后读取，
        // 同时包含工具结果，避免执行列表落后一条甚至一整次模型调用。
        if (event.type === 'message_end' && ['user', 'assistant', 'toolResult'].includes(event.message.role)) {
          queueMicrotask(publishTranscript)
        }
        if (event.type === 'tool_execution_start') {
          const skill = displaySkills.get(String(event.args?.skillId ?? ''))
          // 名称优先从技能列表映射；调用时保存快照，供技能删除后的历史记录使用。
          if (skill) manager.appendCustomEntry('pi-runner-skill-call', { toolCallId: event.toolCallId, name: skill.name })
          activeTools.set(event.toolCallId, event.toolName)
          liveWork.set(event.toolCallId, { state: 'running', args: event.args, ...(skill ? { skillName: skill.name } : {}) })
          refreshStatus()
          publishTranscript()
        }
        if (event.type === 'tool_execution_update') {
          liveWork.set(event.toolCallId, { ...liveWork.get(event.toolCallId), content: outputText(event.partialResult).slice(-12000) })
          // 工具更新是累计输出；合并密集通知，只发送最近内容。
          outputTimer ??= setTimeout(() => { outputTimer = undefined; publishTranscript() }, 150)
        }
        if (event.type === 'tool_execution_end') {
          if (outputTimer) { clearTimeout(outputTimer); outputTimer = undefined }
          activeTools.delete(event.toolCallId)
          waitingTools.delete(event.toolCallId)
          liveWork.set(event.toolCallId, { completed: true, isError: event.isError, content: outputText(event.result) })
          modelStatus = event.isError ? `${toolActions[event.toolName] ?? '任务'}失败，正在处理...` : '正在等待模型继续处理…'
          refreshStatus()
          publishTranscript()
        }
        if (event.type === 'compaction_start') { modelStatus = '正在压缩上下文，完整记录仍保留…'; refreshStatus() }
        if (event.type === 'compaction_end') { modelStatus = event.errorMessage ? '上下文压缩失败，请检查模型服务' : '正在连接模型…'; refreshStatus() }
        if (event.type === 'auto_retry_start') { modelStatus = `模型请求失败，正在等待第 ${event.attempt} 次重试…`; refreshStatus() }
        if (event.type === 'auto_retry_end') { modelStatus = event.success ? '正在整理回复…' : '模型重试失败，正在处理…'; refreshStatus() }
        if (event.type === 'agent_end') { modelStatus = '正在整理回复…'; refreshStatus() }
      })
      const prepared = attachments.prepare(messages.at(-1)!)
      if (!isTest) {
        // SDK 的 prompt 检查发生在新消息入队之前；补算新消息及中文历史，
        // 避免上一轮尚未到阈值、本轮长输入却直接溢出。
        const pendingTokens = estimateContextTokens([messages.at(-1)!])
        const budget = window - reserveTokens
        if (estimateTextTokens(session.systemPrompt) + pendingTokens >= budget) throw new ModelError('当前消息或附件超过可用上下文，请缩短消息、减少附件或提高模型上下文上限')
        const estimatedHistory = session.messages.reduce((total, message) => {
          if (!('content' in message)) return total + 4 + estimateTextTokens(JSON.stringify(message))
          const tokens = typeof message.content === 'string' ? estimateTextTokens(message.content)
            : message.content.reduce((sum, block) => sum + (block.type === 'image' ? 1024 : estimateTextTokens(JSON.stringify(block))), 0)
          return total + 4 + tokens
        }, estimateTextTokens(session.systemPrompt))
        const measuredHistory = session.getContextUsage()?.tokens ?? 0
        if (session.messages.length && Math.max(estimatedHistory, measuredHistory) + pendingTokens >= budget) {
          // SDK 按文本长度选取保留边界；固定保留窗口的 25% 可能吞下全部
          // 可见历史，尤其是真实用量包含大量系统提示词或中文时。
          const visibleTokens = session.messages.reduce((total, message) => total + estimatePiTokens(message), 0)
          settingsManager.applyOverrides({ compaction: { keepRecentTokens: Math.max(1, Math.min(20000, Math.floor(window * .25), Math.floor(visibleTokens * .25))) } })
          await session.compact('请使用中文，保留用户目标、约束、关键事实、已完成事项和待办事项。')
          signal.throwIfAborted()
        }
      }
      session.setAutoCompactionEnabled(!isTest)
      await session.prompt(prepared.text, { images: prepared.images, expandPromptTemplates: false })
      // 模型只输出正文会让 SDK 自然结束；由应用检查阶段，补充隐藏指令继续流程。
      // 每个有用户交互的阶段最多纠正两次，避免工具不兼容的模型无休止重试。
      let corrections = 0, lastInteractionVersion = interactionVersion
      while (planning) {
        signal.throwIfAborted()
        const last = session.messages.filter((message): message is AssistantMessage => message.role === 'assistant').at(-1)
        if (!last || last.stopReason === 'error' || last.stopReason === 'aborted') throw new ModelError(`计划生成失败：${safeModelErrorDetail(last?.errorMessage ?? '模型未返回有效响应或具体错误原因，请重试', apiKey)}`)
        if (last.stopReason === 'length') throw new ModelError(systemOutputTokens(profile.provider) ? '计划生成达到系统输出额度，尚未完成确认与审批。请降低推理强度、缩小任务范围或切换模型后重试' : '计划生成达到输出上限，尚未完成确认与审批，请提高输出 Token 上限后重试')
        // 技能已交付只读文字结果并报告用途时，本轮自然结束。
        // 已发起的计划交互或被拦截的修改仍需完成原有审批流程。
        if (!clarified && interactionVersion === 0 && !planningMutationAttempted && usedSkills.size > 0
          && [...usedSkills.keys()].every(id => skillPurposes.has(id)) && last.stopReason === 'stop'
          && (session.getLastAssistantText() ?? '').trim()) break
        if (interactionVersion !== lastInteractionVersion) { corrections = 0; lastInteractionVersion = interactionVersion }
        if (corrections++ >= 2) throw new ModelError(clarified ? '模型未提交可审批的计划，请使用支持工具调用的模型后重试' : '模型未发起需求确认，请使用支持工具调用的模型后重试')
        status(clarified ? '正在完善计划并准备审阅…' : '正在准备需求确认选项…')
        session.setAutoCompactionEnabled(!isTest)
        await session.sendCustomMessage({ customType: 'pi-runner-plan-control', display: false, content: clarified
          ? '本轮仍处于计划模式，尚未获得用户批准。不要以普通文字结束；若还需要澄清请调用 ask_user_question，否则必须调用 submit_plan 将完整计划提交到审阅窗口。'
          : '本轮尚未进行需求确认。现在必须调用 ask_user_question，针对用户任务提出具体方案、范围或验收选项，等待本轮用户回答。不得直接提交计划，也不要仅用文字提问。' }, { triggerTurn: true })
      }
      if (approvedPlan) {
        signal.throwIfAborted()
        executionTransitionPending = false
        status('计划已批准，正在执行…')
        // 隐藏消息直接 triggerTurn 不会刷新系统提示词。先排入下一轮，
        // 再用空输入启动 prompt 的完整刷新流程；空输入不会显示在对话中。
        await session.sendCustomMessage({ customType: 'pi-runner-execution-control', display: false,
          content: `用户已批准以下完整计划，并要求现在实施。需求确认与计划审阅已经结束。请使用项目工具完成计划中的实际工作和验证，再报告结果；不要只复述计划或确认收到。现有工具权限仍然适用。\n\n${approvedPlan.title}\n\n${approvedPlan.content}` }, { deliverAs: 'nextTurn' })
        session.setAutoCompactionEnabled(!isTest)
        await session.prompt('', { expandPromptTemplates: false })
        // 有项目的执行若只回复文字，有限纠正，不能把确认或复述当作实施完成。
        for (let retry = 0; project && executionToolCalls === 0; retry++) {
          signal.throwIfAborted()
          const last = session.messages.filter((message): message is AssistantMessage => message.role === 'assistant').at(-1)
          if (!last || ['error', 'aborted', 'length'].includes(last.stopReason)) break
          if (retry >= 2) throw new ModelError('计划已批准，但模型未调用项目工具开始执行，请使用支持工具调用的模型后重试')
          status('正在按批准计划开始实际工作…')
          session.setAutoCompactionEnabled(!isTest)
          await session.sendCustomMessage({ customType: 'pi-runner-execution-control', display: false,
            content: '批准后的执行尚未开始：你还没有调用任何项目工具。请现在按已批准的计划调用工具完成实际工作和验证，不能仅确认、复述方案或声称完成。若无法执行，请明确说明具体阻碍。' }, { triggerTurn: true })
        }
      }
      if (!completedResponse) signal.throwIfAborted()
      const final = session.messages.filter((message): message is AssistantMessage => message.role === 'assistant').at(-1)
      if (!final || final.stopReason === 'error' || final.stopReason === 'aborted') throw new ModelError(safeModelErrorDetail(final?.errorMessage ?? (final?.stopReason === 'aborted' ? '模型响应已中断，请重试' : '模型请求失败：未返回有效响应或具体错误原因，请重试'), apiKey))
      let text = session.getLastAssistantText() ?? ''
      if (!text.trim()) {
        // 本地模型带上 Ollama 的真实结束原因与 num_ctx/num_predict，便于区分截断、额度用尽与空响应。
        const ollamaCall = provider.ollamaCall?.()
        if (final.stopReason === 'length') throw new ModelError(systemOutputTokens(profile.provider)
          ? '模型在生成正文前已达到本次输出额度（包含思考与正文，受模型能力及剩余上下文限制）。额度由系统自动管理，请降低推理强度、拆分任务或切换模型后重试'
          : `模型在生成正文前已达到本次输出上限（${ollamaCall?.numPredict ?? profile.maxTokens} Token，包含思考与正文）。请在模型设置中提高输出 Token 上限，或降低推理强度后重试`)
        throw new ModelError(emptyReplyMessage(final, ollamaCall))
      }
      if (usedSkills.size) {
        const plain = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, 200).replace(/[\\`*_{}\[\]<>#|]/g, '\\$&')
        const task = plain(messages.at(-1)?.content ?? '')
        const notice = '\n\n' + [...usedSkills.values()].map(skill => `本次使用了 ${plain(skill.name)} 技能来${plain(skillPurposes.get(skill.id) ?? (task ? `处理本轮任务“${task.slice(0, 80)}”` : '处理本轮任务'))}。`).join('\n\n')
        const entry = manager.getEntries().filter(entry => !previousEntries.has(entry.id) && entry.type === 'message' && entry.message.role === 'assistant').at(-1)
        if (entry) await finishSafely(() => manager.appendCustomEntry('pi-runner-skill-usage', { entryId: entry.id, notice }), '回复已完成，但技能使用记录保存失败')
        text += notice
        publish({ type: 'text', text: notice })
      }
      let elapsedMs = Math.round(performance.now() - started)
      await finishSafely(() => { elapsedMs = saveExecution() }, '回复已完成，但执行统计保存失败')
      completedReply = { text: apiKey ? text.split(apiKey).join('[已隐藏密钥]') : text, model: profile.model, elapsedMs, truncated: final.stopReason === 'length',
        usage: { inputTokens: final.usage.input + final.usage.cacheRead + final.usage.cacheWrite, outputTokens: final.usage.output }, roundUsage, rateLimits, messages: this.transcript(manager, displaySkills), warnings }
      return completedReply
    } finally {
      if (outputTimer) clearTimeout(outputTimer)
      if (profile.provider === 'chatgpt') this.dependencies.chatgpt?.invalidateUsage()
      signal.removeEventListener('abort', abort)
      if (session) {
        const completedSession = session
        await finishSafely(() => completedSession.abort(), '会话资源停止失败，请重新打开应用')
        await finishSafely(() => unsubscribe?.(), '会话事件取消订阅失败，请重新打开应用')
        await finishSafely(() => completedSession.dispose(), '会话资源释放失败，请重新打开应用')
      }
      for (const [id, work] of liveWork) if (!work.completed) liveWork.set(id, { ...work, state: 'interrupted' })
      waitingTools.clear()
      if (!executionSaved) await finishSafely(saveExecution, '执行统计保存失败')
      if (before && snapshot) {
        try {
          status('正在保存本轮改动…')
          const checkpoints = await snapshot.completeCheckpoint(before)
          if (checkpoints) {
            const round = { project: snapshot.getRoot(), ...checkpoints, messageIndex: this.transcript(manager, displaySkills).length - 1 }
            manager.appendCustomEntry('pi-runner-snapshot', round)
            publish({ type: 'snapshot', snapshot: round })
          }
        } catch { const warning = '修改后快照保存失败，请手动捕获当前改动'; warn(warning); status(warning) }
      }
      await Promise.all(pendingCodeSnapshots)
      await finishSafely(() => {
        const messages = currentTranscript()
        if (completedReply) completedReply.messages = messages
        publish({ type: 'transcript', messages })
      }, '最终会话记录刷新失败，请重新打开会话')
    }
  }
}
