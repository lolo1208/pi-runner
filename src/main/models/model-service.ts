import { type AgentRequestOptions, type ModelDescriptor, type ModelReply, type ModelResult, type ModelSettings } from '../../shared/models'
import { PiAgentService } from './pi-agent-service'
import { OllamaClient } from './ollama-client'
import { ModelClient } from './model-client'
import { ModelSettingsStore } from './model-settings-store'
import { ModelError, parseMessages, profileId } from './model-validation'
import { compactContext } from './context-compaction'
import type { ContextOptions } from '../../shared/context'
import { PERMISSION_MODES, type PermissionMode } from '../../shared/models'
import { MAX_COMBINED_PROMPT_LENGTH } from '../../shared/prompts'
import { OpenrouterClient } from './openrouter-client'
import { requiredString } from './model-validation'
import path from 'node:path'

export async function modelResult<T>(action: () => Promise<T>): Promise<ModelResult<T>> {
  try { return { ok: true, value: await action() } }
  catch (error) { return { ok: false, error: error instanceof ModelError ? error.message : '模型操作失败，请检查配置后重试' } }
}

export class ModelService {
  private pending = new Map<string, { conversationId?: string; project?: string; controller: AbortController }>()
  private permissionPrompts = new Map<string, AbortController>()
  constructor(private readonly store: ModelSettingsStore, private readonly client: PiAgentService | ModelClient, private readonly ollama = new OllamaClient(), private readonly openrouter = new OpenrouterClient()) {}
  async connectOpenrouter(value?: unknown): Promise<ModelSettings> {
    const key = value === undefined ? await this.store.openrouterKey() : requiredString(value, 'API Key', 8192)
    if (/[^\x21-\x7e]/.test(key)) throw new ModelError('API Key 不能包含空白或非 ASCII 字符')
    if (!(await this.store.list()).encryptionAvailable) throw new ModelError('系统安全存储不可用，无法保存或读取 API Key')
    const models = await this.openrouter.list(key)
    return this.store.syncOpenrouter(models, value === undefined ? undefined : key)
  }
  async openrouterUsage() {
    return this.openrouter.usage(await this.store.openrouterKey())
  }
  history(id: unknown) { return this.client instanceof PiAgentService ? this.client.history(profileId(id)) : Promise.resolve(null) }
  async deleteRound(id: unknown, index: unknown, expectedHistoryId?: unknown) {
    const conversationId = profileId(id)
    if (!Number.isSafeInteger(index) || (index as number) < 0) throw new ModelError('对话轮次无效')
    if (expectedHistoryId !== undefined && (typeof expectedHistoryId !== 'string' || !/^[\w-]{1,128}$/.test(expectedHistoryId))) throw new ModelError('对话消息标识无效')
    if (this.isBusy(conversationId)) throw new ModelError('请先停止当前会话，再删除记录')
    this.permissionPrompts.set(conversationId, new AbortController())
    try { return this.client instanceof PiAgentService ? await this.client.deleteRound(conversationId, index as number, expectedHistoryId as string | undefined) : null }
    finally { this.permissionPrompts.delete(conversationId) }
  }
  removeHistory(id: string) {
    if (this.isBusy(id)) throw new ModelError('请先停止当前会话，再删除记录')
    return this.client instanceof PiAgentService ? this.client.remove(id) : Promise.resolve()
  }
  isBusy(conversationId?: string): boolean {
    return conversationId === undefined
      ? this.pending.size > 0 || this.permissionPrompts.size > 0
      : [...this.pending.values()].some(request => request.conversationId === conversationId) || this.permissionPrompts.has(conversationId)
  }

  /** 判断指定项目是否有会话正在执行；其他项目的执行不影响该项目。 */
  isProjectBusy(project: string): boolean {
    const target = path.resolve(project)
    return [...this.pending.values()].some(request => request.project && path.resolve(request.project) === target)
  }
  async confirmFullPermission(id: unknown): Promise<boolean> {
    const conversationId = profileId(id)
    if (this.isBusy(conversationId)) throw new ModelError('请先停止任务再切换权限')
    if (!(this.client instanceof PiAgentService)) throw new ModelError('当前执行引擎不支持工具权限')
    const controller = new AbortController()
    this.permissionPrompts.set(conversationId, controller)
    try { return await this.client.confirmFullPermission(conversationId, controller.signal) }
    finally { this.permissionPrompts.delete(conversationId) }
  }
  permission(id: string): PermissionMode { return this.client instanceof PiAgentService ? this.client.permission(id) : 'default' }
  /** 初始化新会话时不影响其他会话中正在执行的任务。 */
  initializePermission(id: string, mode: 'default' | 'auto'): void {
    if (!(this.client instanceof PiAgentService)) throw new ModelError('当前执行引擎不支持工具权限')
    this.client.setPermission(profileId(id), mode)
  }
  setPermission(id: unknown, mode: unknown): PermissionMode {
    if (this.isBusy(profileId(id))) throw new ModelError('请先停止任务再切换权限')
    if (!PERMISSION_MODES.includes(mode as PermissionMode)) throw new ModelError('权限模式无效')
    if (!(this.client instanceof PiAgentService)) throw new ModelError('当前执行引擎不支持工具权限')
    this.client.setPermission(profileId(id), mode as PermissionMode)
    return mode as PermissionMode
  }
  respondApproval(requestId: unknown, conversationId: unknown, approvalId: unknown, allow: unknown): void {
    if (typeof allow !== 'boolean' || !(this.client instanceof PiAgentService)) throw new ModelError('审批参数无效')
    this.client.respondApproval(profileId(requestId), profileId(conversationId), profileId(approvalId), allow)
  }
  respondPlanInteraction(requestId: unknown, conversationId: unknown, interactionId: unknown, response: unknown): void {
    if (!(this.client instanceof PiAgentService)) throw new ModelError('当前执行引擎不支持计划交互')
    this.client.respondPlanInteraction(profileId(requestId), profileId(conversationId), profileId(interactionId), response)
  }
  approvalPreview(requestId: unknown, conversationId: unknown, approvalId: unknown) {
    if (!(this.client instanceof PiAgentService)) throw new ModelError('当前执行引擎不支持工具预览')
    return this.client.approvalPreview(profileId(requestId), profileId(conversationId), profileId(approvalId))
  }
  async connectOllama(baseUrl: unknown): Promise<ModelSettings> {
    const models = await this.ollama.list(baseUrl)
    return this.store.syncOllama(baseUrl, models)
  }
  async getOllamaModelInfo(baseUrl: unknown, model: unknown): Promise<ModelDescriptor> {
    const descriptor = await this.ollama.info(baseUrl, model)
    await this.store.rememberOllamaInfo(baseUrl, descriptor)
    return descriptor
  }

  async request(id: unknown, requestId: unknown, messages: unknown, isTest: boolean, customPrompt?: unknown, context?: unknown, agent?: unknown): Promise<ModelReply> {
    const operationId = profileId(requestId)
    let agentOptions: AgentRequestOptions | undefined
    if (agent !== undefined) {
      const value = agent as AgentRequestOptions
      if (!value || typeof value !== 'object' || (value.project != null && (typeof value.project !== 'string' || value.project.length > 4096))) throw new ModelError('代理会话参数无效')
      if (value.intentMode !== undefined && !['plan', 'execute'].includes(value.intentMode)) throw new ModelError('目的模式无效')
      agentOptions = { conversationId: profileId(value.conversationId), project: value.project, intentMode: value.intentMode }
    }
    const conversationId = agentOptions?.conversationId
    // 没有会话标识的连接测试和旧调用共用一个执行槽；具名会话各自顺序执行。
    if (this.pending.has(operationId) || (conversationId === undefined
      ? [...this.pending.values()].some(request => request.conversationId === undefined)
      : this.isBusy(conversationId))) throw new ModelError('已有模型请求运行，请等待完成或取消')
    const controller = new AbortController()
    this.pending.set(operationId, { conversationId, project: agentOptions?.project ?? undefined, controller })
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    try {
      const config = await this.store.getForRequest(id, isTest)
      const conversation = isTest ? [{ role: 'user' as const, content: 'Reply with OK.' }] : parseMessages(messages)
      if (!isTest && customPrompt !== undefined && (typeof customPrompt !== 'string' || customPrompt.length > MAX_COMBINED_PROMPT_LENGTH)) throw new ModelError(`自定义提示词必须为文本且合并后不能超过 ${MAX_COMBINED_PROMPT_LENGTH} 个字符`)
      const instruction = !isTest && typeof customPrompt === 'string' ? customPrompt.trim() : ''
      if (context !== undefined) {
        const value = context as ContextOptions
        if (!value || typeof value !== 'object' || !Number.isInteger(value.threshold) || value.threshold < 60 || value.threshold > 95 || (value.usage !== undefined && (!value.usage || ![value.usage.inputTokens, value.usage.outputTokens].every(count => Number.isSafeInteger(count) && count >= 0)))) throw new ModelError('上下文压缩参数无效，阈值须为 60%–95%')
      }
      controller.signal.throwIfAborted()
      // 超时只约束一次模型调用；工具执行、用户交互和快照收尾不占模型时间。
      const modelRequestActive = (active: boolean): void => {
        if (timer) clearTimeout(timer)
        timer = undefined
        if (active && !controller.signal.aborted) timer = setTimeout(() => { timedOut = true; controller.abort() }, config.profile.timeoutSeconds * 1000)
      }
      if (this.client instanceof PiAgentService) return await this.client.run(config.profile, config.apiKey, conversation, controller.signal, instruction, context as ContextOptions | undefined, agentOptions, operationId, isTest, modelRequestActive)
      const client = this.client
      const timedClient = { complete: async (...args: Parameters<ModelClient['complete']>): Promise<ModelReply> => {
        modelRequestActive(true)
        try { return await client.complete(...args) }
        finally { modelRequestActive(false) }
      } }
      const prepared = isTest ? { messages: conversation } : await compactContext(timedClient, config.profile, config.apiKey, conversation, controller.signal, instruction, context as ContextOptions | undefined)
      const result = await timedClient.complete(config.profile, config.apiKey, prepared.messages, controller.signal, instruction)
      controller.signal.throwIfAborted()
      return { ...result, ...('compaction' in prepared && prepared.compaction ? { compaction: prepared.compaction } : {}) }
    } catch (error) {
      if (controller.signal.aborted) throw new ModelError(timedOut ? '模型请求超时，请检查服务或增加超时秒数' : '模型请求已取消')
      throw error
    } finally { if (timer) clearTimeout(timer); this.pending.delete(operationId) }
  }

  cancel(requestId: unknown): Promise<void> {
    const operationId = profileId(requestId)
    this.pending.get(operationId)?.controller.abort()
    return Promise.resolve()
  }
  cancelAll(): void {
    for (const request of this.pending.values()) request.controller.abort()
    for (const controller of this.permissionPrompts.values()) controller.abort()
  }
}
