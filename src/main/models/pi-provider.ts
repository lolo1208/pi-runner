import { InMemoryCredentialStore, type Api, type Model, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ModelProfile, ModelRateLimit } from '../../shared/models'
import type { PiAttachments } from './pi-attachments'
import { ollamaContextTokens, ollamaFetch, type OllamaCallInfo } from './pi-ollama'
import { requestPiStream } from './pi-stream'
import type { ChatgptService } from './chatgpt-service'
import { ModelError } from './model-validation'
import { googleTransport } from './google-transport'
import { googleFetchInjectionWorks } from './google-fetch-support'
import { googleThinking } from '../../shared/google'
import { modelResponseError } from './model-request-error'
import { deepseekModelInfo, deepseekThinking } from '../../shared/deepseek'

export async function createPiProvider(profile: ModelProfile, apiKey: string, attachments: PiAttachments, responses: boolean, onLimits: (limits: ModelRateLimit[]) => void, fetchRequest: typeof fetch = fetch, chatgpt?: ChatgptService, onModelRequestActive: (active: boolean) => void = () => {}, onGoogleRetry: (attempt: number) => void = () => {}) {
  if (profile.provider === 'chatgpt') {
    if (!chatgpt) throw new ModelError('ChatGPT 订阅服务尚未初始化，请重启应用')
    return chatgpt.createProvider(profile, attachments, onModelRequestActive)
  }
  if (profile.provider === 'google' && !googleFetchInjectionWorks()) throw new ModelError('Google SDK 的网络注入未生效（@google/genai 补丁丢失）。请在项目目录重新运行 pnpm install 后重启应用')
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false })
  const provider = `pi-runner-${profile.id}`
  const googleControls = profile.provider === 'google' ? googleThinking(profile.model) : undefined
  const thinkingLevel = profile.provider === 'google' ? (profile.thinkingLevel != null && googleControls?.values.includes(profile.thinkingLevel) ? profile.thinkingLevel : googleControls?.default as ModelProfile['thinkingLevel']) ?? 'off' : undefined
  const deepseek = profile.provider === 'deepseek'
  const api = profile.provider === 'google' ? 'google-generative-ai' : profile.protocol === 'anthropic' ? 'anthropic-messages' : responses ? 'openai-responses' : 'openai-completions'
  const implementation = api === 'google-generative-ai' ? googleGenerativeAIApi() : api === 'anthropic-messages' ? anthropicMessagesApi() : responses ? openAIResponsesApi() : openAICompletionsApi()
  const securedFetch: typeof fetch = (url, init) => {
    const headers = new Headers(init?.headers)
    if (!apiKey) { headers.delete('authorization'); headers.delete('x-api-key') }
    return (profile.provider === 'google' ? googleTransport(fetchRequest, undefined, onGoogleRetry) : fetchRequest)(url, { ...init, headers, redirect: 'error' })
  }
  // 本地窗口与下发的 num_ctx 保持一致，避免应用按 32K 估算而 Ollama 只给了默认的 4K。
  let ollamaCall: OllamaCallInfo | undefined
  const contextWindow = profile.provider === 'ollama' ? ollamaContextTokens(profile) : profile.contextTokens ?? (deepseek ? deepseekModelInfo(profile.model).maxContextTokens : undefined) ?? Math.max(32768, profile.maxTokens * 2)
  runtime.registerProvider(provider, {
    api, baseUrl: profile.baseUrl, apiKey: apiKey || 'pi-runner-local',
    models: [{ id: profile.model, name: profile.name, input: deepseek && !deepseekModelInfo(profile.model).capabilities?.includes('vision') ? ['text'] : ['text', 'image'], reasoning: deepseek ? true : profile.provider === 'google' ? Boolean(googleControls) : profile.provider === 'openrouter' ? profile.supportedParameters?.includes('reasoning') === true || (profile.thinkingLevel != null && profile.thinkingLevel !== 'off') : profile.thinking === true,
      contextWindow, maxTokens: profile.maxTokens,
      ...(googleControls ? { thinkingLevelMap: Object.fromEntries(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(level => [level, googleControls.values.includes(level) ? level : null])) } : {}),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(api === 'openai-completions' ? { compat: { maxTokensField: deepseek ? 'max_tokens' as const : profile.tokenParameter, supportsDeveloperRole: profile.provider === 'openai', supportsStore: false, supportsReasoningEffort: deepseek || profile.provider === 'openai' || profile.provider === 'openrouter', ...(deepseek ? { thinkingFormat: 'deepseek' as const, requiresReasoningContentOnAssistantMessages: true } : {}), ...(profile.provider === 'openrouter' ? { thinkingFormat: 'openrouter' as const } : {}) } } : {}) }],
    streamSimple: (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
      const controller = new AbortController()
      let responseError: string | undefined
      return requestPiStream(() => implementation.streamSimple(model, context, {
      ...options, apiKey: apiKey || 'pi-runner-local', maxTokens: Math.min(options?.maxTokens ?? profile.maxTokens, profile.maxTokens),
      signal: options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      ...(profile.temperature !== null ? { temperature: profile.temperature } : {}),
      // OpenAI/Anthropic SDK 将 0 视为立即超时；实际空闲超时由 ModelService 控制。
      // Google 的 503 重试由传输层处理，避免 SDK 对其他状态重复重试。
      timeoutMs: 2_147_483_647,
      maxRetries: 0,
      fetch: async (url, init) => {
        const response = await (profile.provider === 'ollama' ? ollamaFetch(profile, securedFetch, info => { ollamaCall = info }) : securedFetch)(url, init)
        onModelRequestActive(true)
        if (!response.ok) responseError = await modelResponseError(response, apiKey)
        return response
      },
      onPayload: async (payload, target) => {
        const modified = await options?.onPayload?.(payload, target) ?? payload
        const body = attachments.replacePayload(modified, profile.provider === 'ollama' ? { ...profile, provider: 'custom' } : profile, responses) as Record<string, unknown>
        if (profile.provider === 'google') {
          // 目录里存在但官方未声明思考能力的型号：不发送任何 thinkingConfig，让服务端用默认行为。
          if (!googleControls) delete (body.config as Record<string, unknown> | undefined)?.thinkingConfig
          const config = body.config as { thinkingConfig?: { thinkingBudget?: number } } | undefined
          const budget = config?.thinkingConfig?.thinkingBudget
          // Gemini 2.5 的思考预算包含在输出总额度中，为正文保留空间。
          if (config?.thinkingConfig && budget != null && budget > 0) config.thinkingConfig.thinkingBudget = Math.min(budget, Math.max(128, profile.maxTokens - 256))
          if (Buffer.byteLength(JSON.stringify(body)) > 19_000_000) throw new ModelError('Google 内联请求接近 20 MB 上限，请减少附件或压缩文件后重试')
        }
        if (responses) body.store = false
        if (profile.temperature === null || (deepseek && deepseekThinking(profile) !== 'off')) delete body.temperature
        if (profile.provider === 'openrouter') {
          if (!profile.supportedParameters?.includes('temperature')) delete body.temperature
          delete body.reasoning_effort
          if (profile.thinkingLevel != null) body.reasoning = profile.thinkingLevel === 'off' ? { enabled: false } : { effort: profile.thinkingLevel, exclude: false }
          else if (body.reasoning && typeof body.reasoning === 'object') body.reasoning = { ...body.reasoning, exclude: false }
        }
        return body
      },
      onProviderStreamEvent: async (event, target) => {
        onModelRequestActive(true)
        await options?.onProviderStreamEvent?.(event, target)
      },
      onResponse: async (response, target) => {
        await options?.onResponse?.(response, target)
        if (profile.provider !== 'openai') return
        const headers = new Headers(response.headers)
        const limits: ModelRateLimit[] = []
        for (const kind of ['requests', 'tokens'] as const) {
          const limit = Number(headers.get(`x-ratelimit-limit-${kind}`))
          const remainingText = headers.get(`x-ratelimit-remaining-${kind}`)
          const remaining = Number(remainingText)
          if (Number.isSafeInteger(limit) && limit > 0 && remainingText && Number.isSafeInteger(remaining) && remaining >= 0 && remaining <= limit) limits.push({ kind, limit, remaining, reset: headers.get(`x-ratelimit-reset-${kind}`) ?? undefined })
        }
        onLimits(limits)
      }
    }), apiKey, () => controller.abort(), onModelRequestActive, () => responseError)
    }
  })
  return { runtime, model: runtime.getModel(provider, profile.model)!, thinkingLevel: thinkingLevel ?? (deepseek ? deepseekThinking(profile) : profile.provider === 'openrouter' ? profile.thinkingLevel ?? 'off' : profile.thinking === true || profile.ollamaThinkingLevel != null ? 'medium' as const : 'off' as const),
    ollamaCall: (): OllamaCallInfo | undefined => ollamaCall }
}
