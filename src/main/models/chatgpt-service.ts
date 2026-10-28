import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { automaticOutputTokens } from '../../shared/output-tokens'
import type { Api, Model, AuthPrompt, CredentialStore, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai'
import { selectedModelThinking, type ChatgptAuthStatus, type ChatgptUsage, type ModelDescriptor, type ModelProfile, type ResetCredits, type SubscriptionWindow } from '../../shared/models'
import { chatgptReferencePricing } from '../../shared/model-pricing'
import type { ModelSettingsStore } from './model-settings-store'
import { ModelError, requiredString } from './model-validation'
import { requestPiStream } from './pi-stream'
import { requestThinkingSummary } from './pi-thinking'
import type { OllamaCallInfo } from './pi-ollama'
import { modelResponseError } from './model-request-error'
import type { PiAttachments } from './pi-attachments'
import { exchangeChatgptToken, loginChatgpt } from './chatgpt-oauth'

const providerId = 'openai-codex'
const root = 'https://chatgpt.com/backend-api'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const resetCount = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type ThinkingLevel = typeof thinkingLevels[number]
type SubscriptionModel = Model<Api> & { defaultThinkingLevel?: ThinkingLevel }
function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  const level = value === 'none' ? 'off' : value
  return thinkingLevels.includes(level as ThinkingLevel) ? level as ThinkingLevel : undefined
}
function actualThinkingLevels(model: Model<Api>): ThinkingLevel[] {
  if (!model.reasoning) return []
  return [...new Set(getSupportedThinkingLevels(model).flatMap(level => {
    const actual = parseThinkingLevel(model.thinkingLevelMap?.[level] ?? level)
    return actual ? [actual] : []
  }))]
}

export function parseResetCredits(value: unknown, now = Date.now()): ResetCredits | undefined {
  const body = record(value), availableCount = resetCount(body.available_count)
  if (availableCount === undefined) return undefined
  if (availableCount === 0) return { availableCount, earliestExpiresAt: null }
  if (!Array.isArray(body.credits)) return { availableCount }
  const available = body.credits.map(record).filter(credit => credit.status === 'available' && credit.reset_type === 'codex_rate_limits')
  const expiries = available.flatMap(credit => {
    const time = typeof credit.expires_at === 'string' ? Date.parse(credit.expires_at) : NaN
    return Number.isFinite(time) && time > now ? [time] : []
  })
  return { availableCount, ...(expiries.length ? { earliestExpiresAt: Math.min(...expiries) } : available.length >= availableCount && available.every(credit => credit.expires_at === null) ? { earliestExpiresAt: null } : {}) }
}

export function parseChatgptUsage(value: unknown, now = Date.now()): ChatgptUsage {
  const body = record(value), limits = record(body.rate_limit ?? body.rateLimits)
  const windows: SubscriptionWindow[] = []
  for (const key of ['primary_window', 'secondary_window', 'primary', 'secondary']) {
    const item = record(limits[key])
    const seconds = item.limit_window_seconds ?? (typeof item.windowDurationMins === 'number' ? item.windowDurationMins * 60 : undefined)
    const used = item.used_percent ?? item.usedPercent, resetsAt = item.reset_at ?? item.resetsAt
    if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0 || typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) continue
    if (!windows.some(window => window.seconds === seconds)) windows.push({ seconds, usedPercent: used, ...(typeof resetsAt === 'number' && Number.isSafeInteger(resetsAt) && resetsAt > 0 ? { resetsAt } : {}) })
  }
  const resetCredits = parseResetCredits(body.rate_limit_reset_credits, now)
  return { windows, fetchedAt: now, ...(typeof body.plan_type === 'string' ? { plan: body.plan_type } : {}), ...(resetCredits ? { resetCredits } : {}) }
}

export class ChatgptService {
  private runtimePromise?: Promise<ModelRuntime>
  private login?: { controller: AbortController; done: Promise<void>; url?: string; input?: (value: string) => void }
  private error?: string
  private models: readonly SubscriptionModel[] = []
  private catalogSource?: 'account' | 'sdk'
  private usageCache?: ChatgptUsage
  private usagePending?: Promise<ChatgptUsage>
  private accountGeneration = 0
  constructor(readonly credentials: CredentialStore, private readonly settings: ModelSettingsStore, private readonly fetchRequest: typeof fetch = fetch) {}
  private runtime(): Promise<ModelRuntime> {
    return this.runtimePromise ??= this.createRuntime().catch(error => { this.runtimePromise = undefined; throw error })
  }
  private async createRuntime(): Promise<ModelRuntime> {
    const runtime = await ModelRuntime.create({ credentials: this.credentials, modelsPath: null, refreshOnCreate: false })
    const original = runtime.getProvider(providerId)!
    runtime.registerNativeProvider({ ...original, auth: { ...original.auth, oauth: { ...original.auth.oauth!,
      refresh: (credential, signal) => exchangeChatgptToken(this.fetchRequest, { grant_type: 'refresh_token', refresh_token: credential.refresh }, signal)
    } } })
    return runtime
  }
  async status(): Promise<ChatgptAuthStatus> {
    return { state: this.login ? 'authorizing' : await this.credentials.read(providerId) ? 'signed-in' : 'signed-out', url: this.login?.url, manualInput: Boolean(this.login?.input), error: this.error, catalogSource: this.catalogSource }
  }
  async start(): Promise<ChatgptAuthStatus> {
    if (this.login) return this.status()
    this.error = undefined
    const controller = new AbortController()
    let ready!: () => void
    const prepared = new Promise<void>(resolve => { ready = resolve })
    const attempt = { controller, done: Promise.resolve(), url: undefined as string | undefined, input: undefined as ((value: string) => void) | undefined }
    this.login = attempt
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000)
    attempt.done = loginChatgpt({
      signal: controller.signal,
      notify: event => { if (event.type === 'auth_url') { attempt.url = event.url; ready() } },
      prompt: async (prompt: AuthPrompt) => {
        if (prompt.type === 'select' && prompt.options.some(option => option.id === 'browser')) return 'browser'
        if (prompt.type !== 'manual_code') throw new ModelError('ChatGPT 授权流程发生变化，请更新 pi SDK 后重试')
        return new Promise<string>((resolve, reject) => {
          const signal = prompt.signal ?? controller.signal
          const cancel = (): void => { attempt.input = undefined; reject(new Error('已取消授权')) }
          if (signal.aborted) { cancel(); return }
          signal.addEventListener('abort', cancel, { once: true })
          attempt.input = value => { signal.removeEventListener('abort', cancel); attempt.input = undefined; resolve(value) }
        })
      }
    }, this.credentials, this.fetchRequest).then(() => { this.runtimePromise = undefined; this.accountGeneration++; this.usageCache = undefined; this.models = []; this.catalogSource = undefined }).catch(error => {
      this.error = controller.signal.aborted ? undefined : error instanceof ModelError ? error.message : 'ChatGPT 授权失败，请重新生成链接并在浏览器中重试'
    }).finally(() => { clearTimeout(timeout); if (this.login === attempt) this.login = undefined; ready() })
    await prepared
    return this.status()
  }
  async cancel(): Promise<void> { const attempt = this.login; attempt?.controller.abort(); await attempt?.done }
  async logout(): Promise<void> {
    await this.cancel()
    // 退出不依赖凭证解密，损坏的授权也能清除并重新登录。
    await this.credentials.delete(providerId)
    this.runtimePromise = undefined; this.accountGeneration++; this.usageCache = undefined; this.models = []; this.catalogSource = undefined; this.error = undefined
  }
  async authorizationUrl(): Promise<string> {
    const url = this.login?.url
    if (!url) throw new ModelError('授权链接已失效，请重新开始登录')
    const target = new URL(url)
    if (target.origin !== 'https://auth.openai.com' || target.pathname !== '/oauth/authorize') throw new ModelError('授权地址无效，请重新开始登录')
    return url
  }
  async submit(value: unknown): Promise<void> {
    const expected = new URL(await this.authorizationUrl())
    if (typeof value !== 'string' || value.length > 8192) throw new ModelError('请粘贴完整的浏览器回调地址')
    let url: URL
    try { url = new URL(value) } catch { throw new ModelError('请粘贴完整的浏览器回调地址') }
    if (url.origin !== 'http://localhost:1455' || url.pathname !== '/auth/callback' || !url.searchParams.get('code') || url.searchParams.get('state') !== expected.searchParams.get('state')) throw new ModelError('回调地址与本次授权不匹配，请使用当前授权链接重新登录')
    if (!this.login?.input) throw new ModelError('当前授权不需要手动回调，请稍候或重新登录')
    this.login.input(value)
  }
  private async headers(): Promise<Headers> {
    if (!await this.credentials.read(providerId)) throw new ModelError('请先在模型供应商中授权 ChatGPT 订阅账号')
    let auth
    try { auth = await (await this.runtime()).getAuth(providerId) } catch { throw new ModelError('ChatGPT 授权续期失败，请重新登录') }
    if (!auth?.auth.apiKey) throw new ModelError('ChatGPT 授权已失效，请重新登录')
    const credential = await this.credentials.read(providerId)
    const account = credential?.type === 'oauth' ? credential.accountId : undefined
    if (typeof account !== 'string' || !account) throw new ModelError('ChatGPT 授权缺少账号信息，请重新登录')
    return new Headers({ Authorization: `Bearer ${auth.auth.apiKey}`, 'ChatGPT-Account-Id': account, originator: 'pi-runner', accept: 'application/json' })
  }
  private async get(endpoint: string): Promise<unknown> {
    const signal = AbortSignal.timeout(15000)
    const headers = await this.headers()
    signal.throwIfAborted()
    const response = await this.fetchRequest(`${root}${endpoint}`, { headers, signal, redirect: 'error' })
    if (!response.ok) throw new ModelError(response.status === 401 ? 'ChatGPT 授权已失效，请重新登录' : `ChatGPT 服务返回 ${response.status}，请稍后重试`)
    return response.json()
  }
  async refreshModels() {
    const generation = this.accountGeneration
    const runtime = await this.runtime()
    await this.headers()
    const fallback = runtime.getModels(providerId)
    let models: SubscriptionModel[]
    try {
      const body = record(await this.get('/codex/models?client_version=1.1.0'))
      if (!Array.isArray(body.models) || !body.models.length || body.models.length > 200) throw new Error()
      models = body.models.flatMap(value => {
        const item = record(value), id = item.slug ?? item.id
        if (typeof id !== 'string' || !id.trim() || id.length > 200 || item.visibility === 'hide' || item.visibility === 'hidden') return []
        const known = fallback.find(model => model.id === id)
        const base = known ?? fallback[0]
        if (!base) return []
        const window = typeof item.context_window === 'number' && Number.isSafeInteger(item.context_window) && item.context_window > 0 && item.context_window <= 2097152 ? item.context_window : base.contextWindow
        const maxTokens = automaticOutputTokens({ provider: 'chatgpt' }, { maxContextTokens: window,
          maxOutputTokens: typeof item.max_output_tokens === 'number' && Number.isSafeInteger(item.max_output_tokens) && item.max_output_tokens > 0 ? item.max_output_tokens : known?.maxTokens })
        const modalities = Array.isArray(item.input_modalities) ? item.input_modalities : base.input
        const declared = Array.isArray(item.supported_reasoning_levels)
          ? [...new Set(item.supported_reasoning_levels.flatMap(value => { const level = parseThinkingLevel(typeof value === 'string' ? value : record(value).effort); return level ? [level] : [] }))]
          : known ? actualThinkingLevels(known) : []
        const thinkingLevelMap = Object.fromEntries(thinkingLevels.map(level => [level, declared.includes(level) ? level === 'off' ? 'none' : level : null]))
        const preferred = parseThinkingLevel(item.default_reasoning_level)
        const defaultThinkingLevel = preferred && declared.includes(preferred) ? preferred : declared.includes('medium') ? 'medium' : declared[0]
        return [{ ...base, id, name: typeof item.display_name === 'string' ? item.display_name : id, contextWindow: window, maxTokens, input: modalities.includes('image') ? ['text', 'image'] as const : ['text'] as const,
          reasoning: declared.some(level => level !== 'off'), thinkingLevelMap, defaultThinkingLevel }]
      })
      if (!models.length) throw new Error()
      this.catalogSource = 'account'
    } catch (error) {
      if (error instanceof ModelError && error.message.includes('授权')) throw error
      // 目录接口暂不可用时仍可选择 SDK 已知模型；实际权限由订阅服务校验。
      models = [...fallback]
      this.catalogSource = 'sdk'
    }
    if (generation !== this.accountGeneration) throw new ModelError('ChatGPT 账号已切换，请重新刷新模型')
    this.models = [...new Map(models.map(model => [model.id, model])).values()].sort((a, b) => (a.id === 'gpt-6.1-sol' ? -1 : b.id === 'gpt-6.1-sol' ? 1 : a.id.localeCompare(b.id)))
    const descriptors: ModelDescriptor[] = this.models.map(model => {
      const values = actualThinkingLevels(model)
      return { id: model.id, maxContextTokens: model.contextWindow, maxOutputTokens: model.maxTokens, capabilities: ['completion', 'tools', ...(model.reasoning ? ['thinking'] : []), ...(model.input.includes('image') ? ['vision'] : [])],
        pricing: chatgptReferencePricing(model.id),
        thinking: { values, default: model.defaultThinkingLevel ?? (values.includes('medium') ? 'medium' : values[0]) } }
    })
    return this.settings.syncChatgpt(descriptors)
  }
  async modelInfo(value: unknown): Promise<ModelDescriptor> {
    const id = requiredString(value, '模型 ID', 200)
    const cached = (await this.settings.list()).providers?.find(item => item.provider === 'chatgpt')?.models.find(item => item.id === id)
    if (cached?.thinking != null) return cached
    // 为升级前的目录补齐档位；目录网络不可用时，refreshModels 会使用同名 SDK 模型。
    const settings = await this.refreshModels()
    const descriptor = settings.providers?.find(item => item.provider === 'chatgpt')?.models.find(item => item.id === id)
    if (!descriptor) throw new ModelError('订阅模型已不可用，请刷新模型列表后重新选择')
    return descriptor
  }
  async usage(): Promise<ChatgptUsage> {
    if (!await this.credentials.read(providerId)) throw new ModelError('请先授权 ChatGPT 订阅账号')
    if (this.usageCache && Date.now() - this.usageCache.fetchedAt < 30000) return this.usageCache
    const generation = this.accountGeneration
    return this.usagePending ??= this.get('/wham/usage').then(value => parseChatgptUsage(value)).then(async value => {
      if (value.resetCredits?.availableCount !== 0) {
        try {
          const details = parseResetCredits(await this.get('/wham/rate-limit-reset-credits'))
          if (details) value.resetCredits = details
        } catch {
          value.resetCreditsError = '重置详情读取失败，将自动重试'
        }
      }
      if (generation !== this.accountGeneration) throw new ModelError('ChatGPT 账号已切换，请重新读取额度')
      return this.usageCache = value
    }).finally(() => { this.usagePending = undefined })
  }
  invalidateUsage(): void { this.usageCache = undefined }
  async createProvider(profile: ModelProfile, attachments: PiAttachments, onModelRequestActive: (active: boolean) => void = () => {}) {
    if (!await this.credentials.read(providerId)) throw new ModelError('请先在模型供应商中授权 ChatGPT 订阅账号')
    const runtime = await this.createRuntime()
    const original = runtime.getProvider(providerId)!
    let model: SubscriptionModel | undefined = this.models.find(model => model.id === profile.model) ?? runtime.getModel(providerId, profile.model)
    if (!model) { await this.refreshModels(); model = this.models.find(model => model.id === profile.model) }
    if (!model) throw new ModelError('订阅模型已不可用，请刷新模型列表后重新选择')
    if (!this.models.some(item => item.id === profile.model)) {
      const cachedModel = (await this.settings.list()).providers?.find(item => item.provider === 'chatgpt')?.models.find(item => item.id === profile.model)
      model = { ...model, contextWindow: cachedModel?.maxContextTokens ?? model.contextWindow, maxTokens: cachedModel?.maxOutputTokens ?? model.maxTokens }
      const cached = cachedModel?.thinking
      if (cached) {
        const levels = cached.values.flatMap(value => { const level = parseThinkingLevel(value); return level ? [level] : [] })
        const preferred = parseThinkingLevel(cached.default)
        model = { ...model, reasoning: levels.some(level => level !== 'off'), thinkingLevelMap: Object.fromEntries(thinkingLevels.map(level => [level, levels.includes(level) ? level === 'off' ? 'none' : level : null])),
          defaultThinkingLevel: preferred && levels.includes(preferred) ? preferred : levels.includes('medium') ? 'medium' : levels[0] }
      }
    }
    const configured = { ...model, contextWindow: profile.contextTokens ?? model.contextWindow,
      maxTokens: automaticOutputTokens(profile, { maxOutputTokens: model.maxTokens > 0 ? model.maxTokens : undefined, maxContextTokens: model.contextWindow }) }
    runtime.registerNativeProvider({ ...original, getModels: () => [configured], getAllModels: () => [configured],
      streamSimple: (target: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
        const controller = new AbortController()
        let responseError: string | undefined
        this.invalidateUsage()
        return requestPiStream(() => original.streamSimple(target, context, { ...options, transport: 'sse', maxTokens: Math.min(options?.maxTokens ?? configured.maxTokens, configured.maxTokens), temperature: undefined, timeoutMs: profile.timeoutSeconds * 1000, maxRetries: 0,
          signal: options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
          fetch: async (url, init) => {
            const response = await this.fetchRequest(url, { ...init, redirect: 'error' })
            if (!response.ok) {
              const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/i, '') ?? options?.apiKey ?? ''
              responseError = await modelResponseError(response, token)
            }
            return response
          },
          onPayload: async (payload, target) => attachments.replacePayload(requestThinkingSummary(await options?.onPayload?.(payload, target) ?? payload), profile, true)
        }), options?.apiKey ?? '', () => controller.abort(), onModelRequestActive, () => responseError)
      }
    })
    const levels = actualThinkingLevels(configured)
    const thinkingLevel = parseThinkingLevel(selectedModelThinking(profile, { values: levels, default: model.defaultThinkingLevel })) ?? 'off'
    return { runtime, model: runtime.getModel(providerId, profile.model)!, thinkingLevel, ollamaCall: (): OllamaCallInfo | undefined => undefined }
  }
}
