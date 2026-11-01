import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { parseThinkingControls, REVIEW_MODEL_OFF, selectedModelThinking, type ModelDescriptor, type ModelProfile, type ModelProviderConnection, type ModelSettings } from '../../shared/models'
import { deepseekPricing, googleEstimatedPricing, googlePricing, parseModelPricing } from '../../shared/model-pricing'
import { asRecord, ModelError, normalizeOllamaUrl, parseProfile, parseSaveProfile, profileId, requiredString } from './model-validation'
import { GOOGLE_BASE_URL, GOOGLE_CATALOG_LIMIT, googleDocumentedModel, googleThinking } from '../../shared/google'
import { OPENROUTER_BASE_URL } from '../../shared/openrouter'
import { automaticOutputTokens, systemOutputTokens } from '../../shared/output-tokens'
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_OUTPUT_TOKENS, deepseekModelInfo, deepseekThinking } from '../../shared/deepseek'

export interface CredentialCipher {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}
interface StoredProfile { profile: ModelProfile; encryptedApiKey?: string }
interface SettingsFile { version: 1; activeProfileId: string | null; reviewProfileId: string | null; reviewDisabled?: boolean; profiles: StoredProfile[]; providers?: ModelProviderConnection[]; encryptedOpenrouterApiKey?: string; encryptedGoogleApiKey?: string; encryptedDeepseekApiKey?: string }

export class ModelSettingsStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly filePath: string, private readonly cipher: CredentialCipher) {}

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async read(): Promise<SettingsFile> {
    let text: string
    try { text = await readFile(this.filePath, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, activeProfileId: null, reviewProfileId: null, profiles: [] }
      throw new ModelError('无法读取模型配置，请检查应用数据目录权限')
    }
    try {
      const raw = asRecord(JSON.parse(text))
      if (raw.version !== 1 || !Array.isArray(raw.profiles) || raw.profiles.length > 200) throw new Error()
      if (raw.encryptedOpenrouterApiKey !== undefined && (typeof raw.encryptedOpenrouterApiKey !== 'string' || raw.encryptedOpenrouterApiKey.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.encryptedOpenrouterApiKey))) throw new Error()
      if (raw.encryptedGoogleApiKey !== undefined && (typeof raw.encryptedGoogleApiKey !== 'string' || raw.encryptedGoogleApiKey.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.encryptedGoogleApiKey))) throw new Error()
      if (raw.encryptedDeepseekApiKey !== undefined && (typeof raw.encryptedDeepseekApiKey !== 'string' || raw.encryptedDeepseekApiKey.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.encryptedDeepseekApiKey))) throw new Error()
      const profiles = raw.profiles.map(value => {
        const entry = asRecord(value)
        if (entry.encryptedApiKey !== undefined && (typeof entry.encryptedApiKey !== 'string' || entry.encryptedApiKey.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.encryptedApiKey))) throw new Error()
        return { profile: parseProfile(entry.profile), encryptedApiKey: entry.encryptedApiKey as string | undefined }
      })
      if (new Set(profiles.map(item => item.profile.id)).size !== profiles.length) throw new Error()
      const activeProfileId = raw.activeProfileId === null ? null : profileId(raw.activeProfileId)
      if (activeProfileId && !profiles.some(item => item.profile.id === activeProfileId)) throw new Error()
      let reviewProfileId: string | null = null
      if (raw.reviewProfileId !== undefined && raw.reviewProfileId !== null) {
        try { reviewProfileId = profileId(raw.reviewProfileId) } catch { reviewProfileId = null }
        if (reviewProfileId && !profiles.some(item => item.profile.id === reviewProfileId)) reviewProfileId = null
      }
      const reviewDisabled = raw.reviewDisabled === true && !reviewProfileId
      const providers: ModelProviderConnection[] = []
      if (raw.providers !== undefined) {
        if (!Array.isArray(raw.providers) || raw.providers.length > 20) throw new Error()
        for (const value of raw.providers) {
          const entry = asRecord(value)
          if (!['ollama', 'chatgpt', 'openrouter', 'google', 'deepseek'].includes(String(entry.provider)) || !Array.isArray(entry.models) || entry.models.length > (entry.provider === 'openrouter' ? 5000 : entry.provider === 'google' ? GOOGLE_CATALOG_LIMIT : 200)) throw new Error()
          const models: ModelDescriptor[] = entry.models.map(value => {
            const model = asRecord(value)
            if (!Array.isArray(model.capabilities) || model.capabilities.some(item => typeof item !== 'string')) throw new Error()
            if (model.maxContextTokens !== null && (typeof model.maxContextTokens !== 'number' || !Number.isSafeInteger(model.maxContextTokens) || model.maxContextTokens <= 0)) throw new Error()
            return { id: requiredString(model.id, '模型名称', 200), capabilities: model.capabilities as string[], maxContextTokens: model.maxContextTokens as number | null,
              name: typeof model.name === 'string' ? model.name.slice(0, 200) : undefined,
              created: typeof model.created === 'number' && Number.isSafeInteger(model.created) ? model.created : undefined,
              maxOutputTokens: typeof model.maxOutputTokens === 'number' && Number.isSafeInteger(model.maxOutputTokens) && model.maxOutputTokens > 0 ? model.maxOutputTokens : undefined,
              supportedParameters: Array.isArray(model.supportedParameters) ? model.supportedParameters.filter((x): x is string => typeof x === 'string').slice(0, 100) : undefined,
              sizeBytes: typeof model.sizeBytes === 'number' ? model.sizeBytes : undefined, parameterSize: typeof model.parameterSize === 'string' ? model.parameterSize : undefined,
              quantization: typeof model.quantization === 'string' ? model.quantization : undefined,
              pricing: parseModelPricing(model.pricing),
              ...(model.cachePricingChecked === true ? { cachePricingChecked: true } : {}),
              ...(parseThinkingControls(model.thinking) ? { thinking: parseThinkingControls(model.thinking) } : {}) }
          })
          if (entry.provider === 'google' && entry.baseUrl !== GOOGLE_BASE_URL) throw new Error()
          if (entry.provider === 'deepseek') {
            if (entry.baseUrl !== DEEPSEEK_BASE_URL) throw new Error()
            for (const model of models) Object.assign(model, deepseekModelInfo(model.id))
          }
          if (entry.provider === 'chatgpt' && entry.baseUrl !== 'https://chatgpt.com/backend-api') throw new Error()
          if (entry.provider === 'openrouter' && entry.baseUrl !== OPENROUTER_BASE_URL) throw new Error()
          providers.push({ provider: entry.provider as ModelProviderConnection['provider'], baseUrl: entry.provider === 'google' ? GOOGLE_BASE_URL : entry.provider === 'ollama' ? normalizeOllamaUrl(entry.baseUrl) : entry.provider === 'openrouter' ? OPENROUTER_BASE_URL : entry.provider === 'deepseek' ? DEEPSEEK_BASE_URL : 'https://chatgpt.com/backend-api', models })
        }
      }
      const settings: SettingsFile = { version: 1, profiles, activeProfileId, reviewProfileId, reviewDisabled, providers, encryptedGoogleApiKey: raw.encryptedGoogleApiKey as string | undefined, encryptedDeepseekApiKey: raw.encryptedDeepseekApiKey as string | undefined, encryptedOpenrouterApiKey: raw.encryptedOpenrouterApiKey as string | undefined }
      this.migrateGoogleDefaults(settings)
      for (const entry of settings.profiles) if (entry.profile.provider === 'deepseek' && entry.profile.maxTokens === 2048 && deepseekModelInfo(entry.profile.model).maxOutputTokens) entry.profile.maxTokens = DEEPSEEK_DEFAULT_OUTPUT_TOKENS
      this.reconcileActive(settings)
      return settings
    } catch { throw new ModelError('模型配置损坏或版本不支持，已停止读取；请备份应用数据后检查 model-settings.json') }
  }

  /**
   * 旧版本给 Google 模型写入了非推理模型的兜底值（2048 输出、60 秒超时）。
   * Gemini 的输出额度与思考共用，2048 常被思考吃光，导致只能返回空正文。
   * 仅修正恰好等于旧默认值的配置，不覆盖用户自选的其它取值。
   */
  private migrateGoogleDefaults(settings: SettingsFile): void {
    for (const entry of settings.profiles) {
      if (entry.profile.provider !== 'google') continue
      const descriptor = settings.providers?.find(item => item.provider === 'google' && item.baseUrl === entry.profile.baseUrl)?.models.find(item => item.id === entry.profile.model)
      if (entry.profile.maxTokens === 2048) entry.profile.maxTokens = Math.min(65536, descriptor?.maxOutputTokens ?? 65536)
      if (entry.profile.timeoutSeconds === 60) entry.profile.timeoutSeconds = 120
    }
  }

  private async write(settings: SettingsFile): Promise<void> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await writeFile(temporaryPath, JSON.stringify(settings, null, 2), { mode: 0o600, flag: 'wx' })
      await rename(temporaryPath, this.filePath)
    } catch { throw new ModelError('模型配置保存失败，请检查应用数据目录权限') }
    finally { await rm(temporaryPath, { force: true }).catch(() => undefined) }
  }

  private view(settings: SettingsFile): ModelSettings {
    return { activeProfileId: settings.activeProfileId, reviewProfileId: settings.reviewProfileId, reviewDisabled: Boolean(settings.reviewDisabled), encryptionAvailable: this.cipher.isAvailable(),
      providers: (settings.providers ?? []).map(connection => ({ ...connection,
        // 升级前保存的 Google 目录没有单价，读取时补齐，无需用户重新刷新。
        ...(connection.provider === 'google' ? { models: connection.models.map(model => ({ ...model, pricing: googlePricing(model.id) ?? googleEstimatedPricing(model.id) ?? model.pricing })) } : {}),
        ...(connection.provider === 'deepseek' ? { models: connection.models.map(model => ({ ...model, ...deepseekModelInfo(model.id), pricing: deepseekPricing(model.id) })) } : {}),
        ...(['openrouter', 'google', 'deepseek'].includes(connection.provider) ? { hasApiKey: Boolean(connection.provider === 'google' ? settings.encryptedGoogleApiKey : connection.provider === 'deepseek' ? settings.encryptedDeepseekApiKey : settings.encryptedOpenrouterApiKey) } : {}) })),
      profiles: settings.profiles.map(item => ({ ...this.resolvedOutput(settings, item.profile), hasApiKey: Boolean(item.profile.provider === 'google' ? settings.encryptedGoogleApiKey : item.profile.provider === 'openrouter' ? settings.encryptedOpenrouterApiKey : item.profile.provider === 'deepseek' && item.profile.baseUrl === DEEPSEEK_BASE_URL ? settings.encryptedDeepseekApiKey ?? item.encryptedApiKey : item.encryptedApiKey), available: this.available(settings, item.profile) })) }
  }
  private resolvedOutput(settings: SettingsFile, profile: ModelProfile): ModelProfile {
    if (!systemOutputTokens(profile.provider)) return { ...profile }
    const descriptor = settings.providers?.find(item => item.provider === profile.provider && item.baseUrl === profile.baseUrl)?.models.find(item => item.id === profile.model)
    return { ...profile, autoMaxTokens: true, maxTokens: automaticOutputTokens(profile, descriptor) }
  }
  private available(settings: SettingsFile, profile: ModelProfile): boolean {
    if (profile.provider === 'google' && !googleDocumentedModel(profile.model)) return false
    const connection = settings.providers?.find(item => item.provider === profile.provider && item.baseUrl === profile.baseUrl)
    return !connection || connection.models.some(item => item.id === profile.model)
  }
  private reconcileActive(settings: SettingsFile): void {
    const usable = settings.profiles.filter(item => item.profile.enabled !== false && this.available(settings, item.profile))
    if (!usable.some(item => item.profile.id === settings.activeProfileId)) settings.activeProfileId = usable[0]?.profile.id ?? null
    if (settings.reviewProfileId && !usable.some(item => item.profile.id === settings.reviewProfileId)) settings.reviewProfileId = null
  }

  syncOllama(baseUrl: unknown, models: ModelDescriptor[]): Promise<ModelSettings> {
    return this.serialized(async () => {
      const root = normalizeOllamaUrl(baseUrl)
      const settings = await this.read()
      for (const model of models) {
        if (settings.profiles.some(item => item.profile.provider === 'ollama' && item.profile.baseUrl === root && item.profile.model === model.id)) continue
        settings.profiles.push({ profile: { id: randomUUID(), name: model.id, provider: 'ollama', protocol: 'openai-compatible', baseUrl: root,
          model: model.id, temperature: null, contextTokens: null, enabled: true, maxTokens: 2048, tokenParameter: 'max_tokens', timeoutSeconds: 120 } })
      }
      if (settings.profiles.length > 200) throw new ModelError('最多保存 200 个模型配置')
      const connection: ModelProviderConnection = { provider: 'ollama', baseUrl: root, models }
      settings.providers = [...(settings.providers ?? []).filter(item => item.provider !== 'ollama'), connection]
      this.reconcileActive(settings)
      await this.write(settings)
      return this.view(settings)
    })
  }

  list(): Promise<ModelSettings> { return this.serialized(async () => this.view(await this.read())) }

  openrouterKey(): Promise<string> {
    return this.serialized(async () => {
      const settings = await this.read()
      if (!settings.encryptedOpenrouterApiKey) throw new ModelError('请先配置 OpenRouter API Key')
      if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法读取 API Key')
      try { return this.cipher.decrypt(Buffer.from(settings.encryptedOpenrouterApiKey, 'base64')) }
      catch { throw new ModelError('OpenRouter API Key 解密失败，请重新输入密钥') }
    })
  }

  syncOpenrouter(models: ModelDescriptor[], apiKey?: string): Promise<ModelSettings> {
    return this.serialized(async () => {
      const settings = await this.read()
      if (apiKey !== undefined) {
        if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法保存 API Key；不会以明文保存')
        try { settings.encryptedOpenrouterApiKey = this.cipher.encrypt(apiKey).toString('base64') }
        catch { throw new ModelError('API Key 加密失败，原配置未更改') }
      }
      settings.providers = [...(settings.providers ?? []).filter(item => item.provider !== 'openrouter'), { provider: 'openrouter', baseUrl: OPENROUTER_BASE_URL, models }]
      this.reconcileActive(settings)
      await this.write(settings)
      return this.view(settings)
    })
  }

  googleKey(): Promise<string> {
    return this.serialized(async () => {
      const settings = await this.read()
      if (!settings.encryptedGoogleApiKey) throw new ModelError('请先配置 Google AI Studio API Key')
      if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法读取 API Key')
      try { return this.cipher.decrypt(Buffer.from(settings.encryptedGoogleApiKey, 'base64')) }
      catch { throw new ModelError('Google API Key 解密失败，请重新配置连接') }
    })
  }

  syncGoogle(models: ModelDescriptor[], apiKey?: string): Promise<ModelSettings> {
    return this.serialized(async () => {
      const settings = await this.read()
      if (apiKey !== undefined) {
        if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法保存 API Key')
        try { settings.encryptedGoogleApiKey = this.cipher.encrypt(apiKey).toString('base64') }
        catch { throw new ModelError('API Key 加密失败，原配置未更改') }
      }
      // 目录与用户配置分离，只在启用或编辑时保存模型，避免大目录耗尽配置额度。
      settings.providers = [...(settings.providers ?? []).filter(item => item.provider !== 'google'), { provider: 'google', baseUrl: GOOGLE_BASE_URL, models }]
      this.reconcileActive(settings)
      await this.write(settings)
      return this.view(settings)
    })
  }

  deepseekKey(): Promise<string> {
    return this.serialized(async () => {
      const settings = await this.read()
      if (!settings.encryptedDeepseekApiKey) throw new ModelError('请先配置 DeepSeek API Key')
      if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法读取 API Key')
      try { return this.cipher.decrypt(Buffer.from(settings.encryptedDeepseekApiKey, 'base64')) }
      catch { throw new ModelError('DeepSeek API Key 解密失败，请重新配置连接') }
    })
  }

  syncDeepseek(models: ModelDescriptor[], apiKey?: string): Promise<ModelSettings> {
    return this.serialized(async () => {
      const settings = await this.read()
      if (apiKey !== undefined) {
        if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法保存 API Key')
        try { settings.encryptedDeepseekApiKey = this.cipher.encrypt(apiKey).toString('base64') }
        catch { throw new ModelError('API Key 加密失败，原配置未更改') }
      }
      settings.providers = [...(settings.providers ?? []).filter(item => item.provider !== 'deepseek'), { provider: 'deepseek', baseUrl: DEEPSEEK_BASE_URL, models }]
      this.reconcileActive(settings)
      await this.write(settings)
      return this.view(settings)
    })
  }

  rememberOllamaInfo(baseUrl: unknown, descriptor: ModelDescriptor): Promise<void> {
    return this.serialized(async () => {
      const settings = await this.read()
      const connection = settings.providers?.find(item => item.provider === 'ollama' && item.baseUrl === normalizeOllamaUrl(baseUrl))
      if (!connection?.models.some(item => item.id === descriptor.id)) return
      connection.models = connection.models.map(item => item.id === descriptor.id ? { ...item, ...descriptor } : item)
      await this.write(settings)
    })
  }

  syncChatgpt(models: ModelDescriptor[]): Promise<ModelSettings> {
    return this.serialized(async () => {
      const settings = await this.read()
      for (const model of models) {
        if (settings.profiles.some(item => item.profile.provider === 'chatgpt' && item.profile.model === model.id)) continue
        settings.profiles.push({ profile: { id: randomUUID(), name: model.id, provider: 'chatgpt', protocol: 'openai-compatible', baseUrl: 'https://chatgpt.com/backend-api', model: model.id,
          temperature: null, contextTokens: null, enabled: true, thinking: null, maxTokens: 2048, tokenParameter: 'max_completion_tokens', timeoutSeconds: 120 } })
      }
      if (settings.profiles.length > 200) throw new ModelError('最多保存 200 个模型配置')
      settings.providers = [...(settings.providers ?? []).filter(item => item.provider !== 'chatgpt'), { provider: 'chatgpt', baseUrl: 'https://chatgpt.com/backend-api', models }]
      this.reconcileActive(settings)
      await this.write(settings)
      return this.view(settings)
    })
  }

  save(input: unknown): Promise<ModelSettings> {
    return this.serialized(async () => {
      const { profile, credential } = parseSaveProfile(input)
      if (profile.provider === 'openrouter' && credential.action !== 'keep') throw new ModelError('OpenRouter 密钥由供应商统一管理，请在配置连接中更新')
      if (profile.provider === 'google' && credential.action !== 'keep') throw new ModelError('Google 密钥由供应商统一管理，请在配置连接中更新')
      if (profile.provider === 'deepseek' && credential.action !== 'keep') throw new ModelError('DeepSeek 密钥由供应商统一管理，请在配置连接中更新')
      if (profile.provider === 'chatgpt' && credential.action === 'replace') throw new ModelError('ChatGPT 订阅请通过浏览器授权，无需 API Key')
      const settings = await this.read()
      const existing = settings.profiles.find(item => item.profile.id === profile.id)
      if (!existing && settings.profiles.length >= 200) throw new ModelError('最多保存 200 个模型配置')
      const descriptor = settings.providers?.find(item => item.provider === profile.provider && item.baseUrl === profile.baseUrl)?.models.find(item => item.id === profile.model)
      if (profile.provider === 'google') {
        const selected = selectedModelThinking(profile, googleThinking(profile.model))
        profile.thinkingLevel = typeof selected === 'string' ? selected as ModelProfile['thinkingLevel'] : null
        profile.thinking = null
        profile.ollamaThinkingLevel = null
      }
      if (profile.provider === 'deepseek') {
        profile.thinkingLevel = deepseekThinking(profile)
        profile.thinking = null
        profile.ollamaThinkingLevel = null
      }
      profile.maxTokens = this.resolvedOutput(settings, profile).maxTokens
      if (profile.provider === 'openrouter' && (!settings.encryptedOpenrouterApiKey || !descriptor?.capabilities.includes('tools'))) throw new ModelError('请先连接 OpenRouter，并选择支持工具调用的模型')
      if (profile.provider === 'google' && (!settings.encryptedGoogleApiKey || !descriptor?.capabilities.includes('tools'))) throw new ModelError('请先连接 Google AI Studio，并选择目录中的模型')
      if (descriptor?.maxOutputTokens && profile.maxTokens > descriptor.maxOutputTokens) throw new ModelError('输出 Token 上限不能超过模型支持的最大输出')
      if (descriptor?.maxContextTokens && profile.contextTokens && profile.contextTokens > descriptor.maxContextTokens) throw new ModelError('上下文上限不能超过模型支持的最大上下文')
      const selectedThinking = profile.provider === 'ollama' ? profile.ollamaThinkingLevel ?? profile.thinking : profile.thinkingLevel
      if (descriptor?.thinking && selectedThinking != null && !descriptor.thinking.values.includes(selectedThinking)) throw new ModelError('当前模型不支持所选推理档位，请重新选择')
      if (profile.provider === 'google' && descriptor?.thinking && selectedModelThinking(profile, descriptor.thinking) !== 'off' && profile.maxTokens < 1024) throw new ModelError('Google 推理模型的输出额度包含思考，请至少设置 1024 Token')
      let encryptedApiKey = existing?.encryptedApiKey
      if (credential.action === 'keep' && encryptedApiKey && (existing?.profile.baseUrl !== profile.baseUrl || existing.profile.protocol !== profile.protocol)) throw new ModelError('服务地址或协议已改变，请重新输入对应 API Key，或选择删除密钥后保存')
      if (credential.action === 'remove') encryptedApiKey = undefined
      if (credential.action === 'replace') {
        if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法保存 API Key；不会以明文保存')
        try { encryptedApiKey = this.cipher.encrypt(credential.value!).toString('base64') }
        catch { throw new ModelError('API Key 加密失败，原配置未更改') }
      }
      const entry = { profile, encryptedApiKey }
      settings.profiles = existing ? settings.profiles.map(item => item.profile.id === profile.id ? entry : item) : [...settings.profiles, entry]
      settings.activeProfileId ??= profile.id
      this.reconcileActive(settings)
      await this.write(settings)
      return this.view(settings)
    })
  }

  setActive(id: unknown): Promise<ModelSettings> {
    return this.serialized(async () => {
      const selectedId = profileId(id)
      const settings = await this.read()
      const entry = settings.profiles.find(item => item.profile.id === selectedId)
      if (!entry) throw new ModelError('模型配置不存在')
      if (entry.profile.enabled === false || !this.available(settings, entry.profile)) throw new ModelError('该模型已停用或不在本地服务中，请先启用或刷新模型列表')
      settings.activeProfileId = selectedId
      await this.write(settings)
      return this.view(settings)
    })
  }

  setReviewModel(id: unknown): Promise<ModelSettings> {
    return this.serialized(async () => {
      const settings = await this.read()
      if (id === REVIEW_MODEL_OFF) {
        settings.reviewProfileId = null
        settings.reviewDisabled = true
      } else if (id === null || id === undefined || id === '') {
        settings.reviewProfileId = null
        settings.reviewDisabled = false
      } else {
        const selectedId = profileId(id)
        const entry = settings.profiles.find(item => item.profile.id === selectedId)
        if (!entry) throw new ModelError('模型配置不存在')
        if (entry.profile.enabled === false || !this.available(settings, entry.profile)) throw new ModelError('该模型已停用或不在本地服务中，请先启用或刷新模型列表')
        settings.reviewProfileId = selectedId
        settings.reviewDisabled = false
      }
      await this.write(settings)
      return this.view(settings)
    })
  }

  /** 审核模型解析：未单独指定时使用默认模型；关闭或不可用时返回 null，调用方回退到逐次询问。 */
  reviewProfile(): Promise<{ profile: ModelProfile; apiKey: string } | null> {
    return this.serialized(async () => {
      const settings = await this.read()
      if (settings.reviewDisabled) return null
      const id = settings.reviewProfileId ?? settings.activeProfileId
      if (!id) return null
      const entry = settings.profiles.find(item => item.profile.id === id)
      if (!entry || entry.profile.enabled === false || !this.available(settings, entry.profile)) return null
      let apiKey = ''
      const encryptedKey = entry.profile.provider === 'google' ? settings.encryptedGoogleApiKey : entry.profile.provider === 'openrouter' ? settings.encryptedOpenrouterApiKey : entry.profile.provider === 'deepseek' && entry.profile.baseUrl === DEEPSEEK_BASE_URL ? settings.encryptedDeepseekApiKey ?? entry.encryptedApiKey : entry.encryptedApiKey
      if (encryptedKey) {
        if (!this.cipher.isAvailable()) return null
        try { apiKey = this.cipher.decrypt(Buffer.from(encryptedKey, 'base64')) }
        catch { return null }
      }
      if (!apiKey && ['google', 'openai', 'anthropic', 'deepseek', 'openrouter'].includes(entry.profile.provider)) return null
      const descriptor = settings.providers?.find(item => item.provider === entry.profile.provider && item.baseUrl === entry.profile.baseUrl)?.models.find(item => item.id === entry.profile.model)
      const profile = this.requestProfile(settings, entry.profile, descriptor)
      return { profile, apiKey }
    })
  }

  /** 普通对话与权限审核共用目录限制和推理归一，刷新后不使用失效的旧参数。 */
  private requestProfile(settings: SettingsFile, source: ModelProfile, descriptor?: ModelDescriptor): ModelProfile {
    const profile = { ...this.resolvedOutput(settings, source), contextTokens: source.contextTokens ?? descriptor?.maxContextTokens }
    if (source.provider === 'deepseek') {
      const info = deepseekModelInfo(source.model)
      profile.contextTokens = source.contextTokens ?? descriptor?.maxContextTokens ?? info.maxContextTokens
      profile.thinkingLevel = deepseekThinking(source)
      profile.thinking = null
    }
    if (source.provider === 'google') {
      const controls = googleThinking(source.model)
      const selected = selectedModelThinking(source, controls)
      profile.thinkingLevel = typeof selected === 'string' ? selected as ModelProfile['thinkingLevel'] : null
      profile.thinking = null
      profile.ollamaThinkingLevel = null
      profile.maxTokens = Math.min(profile.maxTokens, descriptor?.maxOutputTokens ?? profile.maxTokens)
      if (descriptor?.maxContextTokens && profile.contextTokens) profile.contextTokens = Math.min(profile.contextTokens, descriptor.maxContextTokens)
    }
    return profile
  }

  getForRequest(id: unknown, forTest = false): Promise<{ profile: ModelProfile; apiKey: string }> {
    return this.serialized(async () => {
      const selectedId = profileId(id)
      const settings = await this.read()
      const entry = settings.profiles.find(item => item.profile.id === selectedId)
      if (!entry) throw new ModelError('请先保存模型配置')
      if ((!forTest && entry.profile.enabled === false) || !this.available(settings, entry.profile)) throw new ModelError('该模型已停用或不可用，请在模型设置中启用或刷新模型列表')
      let apiKey = ''
      const encryptedKey = entry.profile.provider === 'google' ? settings.encryptedGoogleApiKey : entry.profile.provider === 'openrouter' ? settings.encryptedOpenrouterApiKey : entry.profile.provider === 'deepseek' && entry.profile.baseUrl === DEEPSEEK_BASE_URL ? settings.encryptedDeepseekApiKey ?? entry.encryptedApiKey : entry.encryptedApiKey
      if (encryptedKey) {
        if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法读取 API Key')
        try { apiKey = this.cipher.decrypt(Buffer.from(encryptedKey, 'base64')) }
        catch { throw new ModelError('API Key 解密失败，请在设置中重新输入密钥') }
      }
      if (!apiKey && ['google', 'openai', 'anthropic', 'deepseek', 'openrouter'].includes(entry.profile.provider)) throw new ModelError('请先保存该服务的 API Key')
      const descriptor = settings.providers?.find(item => item.provider === entry.profile.provider && item.baseUrl === entry.profile.baseUrl)?.models.find(item => item.id === entry.profile.model)
      const profile = this.requestProfile(settings, entry.profile, descriptor)
      if (profile.provider === 'openrouter') {
        profile.supportedParameters = descriptor?.supportedParameters
        profile.maxTokens = Math.min(profile.maxTokens, descriptor?.maxOutputTokens ?? profile.maxTokens)
        if (descriptor?.thinking) {
          const selected = selectedModelThinking(profile, descriptor.thinking)
          profile.thinkingLevel = typeof selected === 'string' ? selected as ModelProfile['thinkingLevel'] : null
        } else profile.thinkingLevel = null
      }
      if (profile.provider === 'ollama' && descriptor?.thinking) {
        const selected = selectedModelThinking(profile, descriptor.thinking)
        profile.ollamaThinkingLevel = typeof selected === 'string' ? selected : null
        profile.thinking = typeof selected === 'boolean' ? selected : null
      }
      return { profile, apiKey }
    })
  }
}
