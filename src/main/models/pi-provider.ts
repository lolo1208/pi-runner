import { InMemoryCredentialStore, type Api, type Model, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ModelProfile, ModelRateLimit } from '../../shared/models'
import type { PiAttachments } from './pi-attachments'
import { ollamaContextTokens, ollamaFetch, type OllamaCallInfo } from './pi-ollama'
import { requestPiStream } from './pi-stream'
import type { ChatgptService } from './chatgpt-service'
import { ModelError } from './model-validation'
import { modelResponseError } from './model-request-error'

export async function createPiProvider(profile: ModelProfile, apiKey: string, attachments: PiAttachments, responses: boolean, onLimits: (limits: ModelRateLimit[]) => void, fetchRequest: typeof fetch = fetch, chatgpt?: ChatgptService, onModelRequestActive: (active: boolean) => void = () => {}) {
  if (profile.provider === 'chatgpt') {
    if (!chatgpt) throw new ModelError('ChatGPT 订阅服务尚未初始化，请重启应用')
    return chatgpt.createProvider(profile, attachments, onModelRequestActive)
  }
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false })
  const provider = `pi-runner-${profile.id}`
  const api = profile.protocol === 'anthropic' ? 'anthropic-messages' : responses ? 'openai-responses' : 'openai-completions'
  const implementation = api === 'anthropic-messages' ? anthropicMessagesApi() : responses ? openAIResponsesApi() : openAICompletionsApi()
  const securedFetch: typeof fetch = (url, init) => {
    const headers = new Headers(init?.headers)
    if (!apiKey) { headers.delete('authorization'); headers.delete('x-api-key') }
    return fetchRequest(url, { ...init, headers, redirect: 'error' })
  }
  // 本地窗口与下发的 num_ctx 保持一致，避免应用按 32K 估算而 Ollama 只给了默认的 4K。
  let ollamaCall: OllamaCallInfo | undefined
  const contextWindow = profile.provider === 'ollama' ? ollamaContextTokens(profile) : profile.contextTokens ?? Math.max(32768, profile.maxTokens * 2)
  runtime.registerProvider(provider, {
    api, baseUrl: profile.baseUrl, apiKey: apiKey || 'pi-runner-local',
    models: [{ id: profile.model, name: profile.name, input: ['text', 'image'], reasoning: profile.provider === 'openrouter' ? profile.supportedParameters?.includes('reasoning') === true || (profile.thinkingLevel != null && profile.thinkingLevel !== 'off') : profile.thinking === true,
      contextWindow, maxTokens: profile.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(api === 'openai-completions' ? { compat: { maxTokensField: profile.tokenParameter, supportsDeveloperRole: profile.provider === 'openai', supportsStore: false, supportsReasoningEffort: profile.provider === 'openai' || profile.provider === 'openrouter', ...(profile.provider === 'openrouter' ? { thinkingFormat: 'openrouter' as const } : {}) } } : {}) }],
    streamSimple: (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
      const controller = new AbortController()
      let responseError: string | undefined
      return requestPiStream(() => implementation.streamSimple(model, context, {
      ...options, apiKey: apiKey || 'pi-runner-local', maxTokens: Math.min(options?.maxTokens ?? profile.maxTokens, profile.maxTokens),
      signal: options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      ...(profile.temperature !== null ? { temperature: profile.temperature } : {}),
      timeoutMs: profile.timeoutSeconds * 1000, maxRetries: 0,
      fetch: async (url, init) => {
        const response = await (profile.provider === 'ollama' ? ollamaFetch(profile, securedFetch, info => { ollamaCall = info }) : securedFetch)(url, init)
        if (!response.ok) responseError = await modelResponseError(response, apiKey)
        return response
      },
      onPayload: async (payload, target) => {
        const modified = await options?.onPayload?.(payload, target) ?? payload
        const body = attachments.replacePayload(modified, profile.provider === 'ollama' ? { ...profile, provider: 'custom' } : profile, responses) as Record<string, unknown>
        if (responses) body.store = false
        if (profile.temperature === null) delete body.temperature
        if (profile.provider === 'openrouter') {
          if (!profile.supportedParameters?.includes('temperature')) delete body.temperature
          delete body.reasoning_effort
          if (profile.thinkingLevel != null) body.reasoning = profile.thinkingLevel === 'off' ? { enabled: false } : { effort: profile.thinkingLevel, exclude: false }
          else if (body.reasoning && typeof body.reasoning === 'object') body.reasoning = { ...body.reasoning, exclude: false }
        }
        return body
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
  return { runtime, model: runtime.getModel(provider, profile.model)!, thinkingLevel: profile.provider === 'openrouter' ? profile.thinkingLevel ?? 'off' : profile.thinking === true || profile.ollamaThinkingLevel != null ? 'medium' as const : 'off' as const,
    ollamaCall: (): OllamaCallInfo | undefined => ollamaCall }
}
