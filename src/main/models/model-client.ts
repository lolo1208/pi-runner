import type { ChatMessage, ModelProfile, ModelReply, ModelRateLimit } from '../../shared/models'
import { asRecord, ModelError, normalizeOllamaUrl } from './model-validation'
import { ollamaContextTokens } from './pi-ollama'
import { modelMessages, useFileResponses } from './model-attachments'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const tokenCount = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

function readRateLimits(headers: Headers): ModelRateLimit[] {
  return (['requests', 'tokens'] as const).flatMap(kind => {
    const limitText = headers.get(`x-ratelimit-limit-${kind}`)
    const remainingText = headers.get(`x-ratelimit-remaining-${kind}`)
    const limit = limitText?.trim() ? tokenCount(Number(limitText)) : undefined
    const remaining = remainingText?.trim() ? tokenCount(Number(remainingText)) : undefined
    if (!limit || remaining === undefined || remaining > limit) return []
    const reset = headers.get(`x-ratelimit-reset-${kind}`)
    return [{ kind, limit, remaining, ...(reset && /^[\d.hmsµu ]{1,80}$/.test(reset) ? { reset } : {}) }]
  })
}
export class ModelClient {
  constructor(private readonly fetchRequest: typeof fetch = fetch) {}

  async complete(profile: ModelProfile, apiKey: string, messages: ChatMessage[], signal: AbortSignal, customPrompt = ''): Promise<ModelReply> {
    const startedAt = performance.now()
    const isAnthropic = profile.protocol === 'anthropic'
    const isOllama = profile.provider === 'ollama'
    const isResponses = useFileResponses(profile, messages)
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (isAnthropic) {
      headers['anthropic-version'] = '2023-06-01'
      if (apiKey) headers['x-api-key'] = apiKey
    } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const requestMessages = modelMessages(profile, messages, isResponses)
    const body: Record<string, unknown> = {
      model: profile.model, [isResponses ? 'input' : 'messages']: requestMessages, stream: false,
      [isResponses ? 'max_output_tokens' : isAnthropic ? 'max_tokens' : profile.tokenParameter]: profile.maxTokens,
      ...(isResponses ? { store: false } : {})
    }
    const instruction = customPrompt.trim()
    if (instruction) {
      if (isResponses) body.instructions = instruction
      else if (isAnthropic) body.system = instruction
      else body.messages = [{ role: 'system', content: instruction }, ...requestMessages]
    }
    if (profile.temperature !== null) body.temperature = profile.temperature
    if (profile.provider === 'openrouter') {
      if (!profile.supportedParameters?.includes('temperature')) delete body.temperature
      if (profile.thinkingLevel != null) body.reasoning = profile.thinkingLevel === 'off' ? { enabled: false } : { effort: profile.thinkingLevel }
    }
    if (isOllama) {
      delete body[profile.tokenParameter]
      delete body.temperature
      const options: Record<string, number> = { num_predict: profile.maxTokens, num_ctx: ollamaContextTokens(profile) }
      if (profile.temperature !== null) options.temperature = profile.temperature
      body.options = options
      if (profile.ollamaThinkingLevel != null || profile.thinking != null) body.think = profile.ollamaThinkingLevel ?? profile.thinking
    }
    let response: Response
    try {
      signal.throwIfAborted()
      const endpoint = isOllama ? `${normalizeOllamaUrl(profile.baseUrl)}/api/chat` : `${profile.baseUrl}/${isResponses ? 'responses' : isAnthropic ? 'messages' : 'chat/completions'}`
      response = await this.fetchRequest(endpoint, {
        method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error'
      })
    } catch {
      if (signal.aborted) throw new ModelError('请求已取消或超时')
      throw new ModelError('无法连接模型服务，请检查 Base URL、网络或代理；服务重定向不会被自动跟随')
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      const hints: Record<number, string> = {
        400: messages.some(message => message.images?.length) ? '当前模型或接口不支持所附文件或请求参数，请检查模型的文件格式支持，或移除附件后重试' : '请求参数不受支持，请检查模型、Token 参数与 Temperature',
        401: '认证失败，请检查 API Key', 402: '账户余额不足，请充值后重试', 403: '没有访问权限，请检查密钥和模型授权',
        404: '接口或模型不存在，请检查 Base URL 和模型 ID',
        429: '请求过于频繁或额度不足，请检查服务额度后重试'
      }
      // 不回显服务错误正文，避免网关把请求头或密钥带入错误消息。
      throw new ModelError(`模型服务返回 HTTP ${response.status}：${hints[response.status] ?? '服务暂时不可用，请稍后重试'}`)
    }
    try {
      if (!response.body) throw new ModelError('模型服务返回空响应')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const result = await reader.read()
          if (result.done) break
          length += result.value.byteLength
          if (length > MAX_RESPONSE_BYTES) throw new ModelError('模型响应超过 2 MiB 上限，请降低输出 Token 上限')
          chunks.push(result.value)
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
      const result = asRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      let text: string
      let truncated: boolean
      if (isResponses) {
        if (!Array.isArray(result.output)) throw new Error()
        text = result.output.map(asRecord).filter(item => item.type === 'message' && Array.isArray(item.content))
          .flatMap(item => (item.content as unknown[]).map(asRecord))
          .filter(block => block.type === 'output_text' && typeof block.text === 'string').map(block => block.text).join('\n')
        truncated = result.status === 'incomplete' && asRecord(result.incomplete_details ?? {}).reason === 'max_output_tokens'
      } else if (isOllama) {
        const message = asRecord(result.message)
        if (typeof message.content !== 'string') throw new Error()
        text = message.content
        truncated = result.done_reason === 'length'
      } else if (isAnthropic) {
        if (!Array.isArray(result.content)) throw new Error()
        text = result.content.map(value => asRecord(value)).filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
        truncated = result.stop_reason === 'max_tokens'
      } else {
        if (!Array.isArray(result.choices) || !result.choices.length) throw new Error()
        const choice = asRecord(result.choices[0])
        const message = asRecord(choice.message)
        if (typeof message.content !== 'string') throw new Error()
        text = message.content
        truncated = choice.finish_reason === 'length'
      }
      if (!text.trim()) throw new ModelError(isOllama ? '模型未返回正文，请降低推理强度或关闭推理模式，或拆分任务后重试' : '模型未返回文本，请检查模型能力或提高输出 Token 上限')
      if (apiKey) text = text.split(apiKey).join('[已隐藏密钥]')
      const usageRecord = result.usage && typeof result.usage === 'object' && !Array.isArray(result.usage) ? result.usage as Record<string, unknown> : {}
      const inputTokens = tokenCount(isOllama ? result.prompt_eval_count : isAnthropic || isResponses ? usageRecord.input_tokens : usageRecord.prompt_tokens)
      const outputTokens = tokenCount(isOllama ? result.eval_count : isAnthropic || isResponses ? usageRecord.output_tokens : usageRecord.completion_tokens)
      const cacheRead = isAnthropic ? tokenCount(usageRecord.cache_read_input_tokens) ?? 0 : 0
      const cacheWrite = isAnthropic ? tokenCount(usageRecord.cache_creation_input_tokens) ?? 0 : 0
      const rateLimits = profile.provider === 'openai' ? readRateLimits(response.headers) : []
      return { text, model: profile.model, elapsedMs: Math.round(performance.now() - startedAt), truncated,
        ...(inputTokens !== undefined && outputTokens !== undefined ? { usage: { inputTokens: inputTokens + cacheRead + cacheWrite, outputTokens } } : {}),
        ...(rateLimits.length ? { rateLimits } : {}) }
    } catch (error) {
      if (signal.aborted) throw new ModelError('请求已取消或超时')
      if (error instanceof ModelError) throw error
      throw new ModelError('模型响应格式不符合所选协议，请检查服务配置')
    }
  }
}
