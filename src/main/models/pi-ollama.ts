import type { ModelProfile } from '../../shared/models'
import { randomUUID } from 'node:crypto'
import { normalizeOllamaUrl } from './model-validation'

/** Ollama 未配置上下文上限时的兜底窗口：默认的 4K 装不下 pi 的系统提示词与工具说明。 */
export const OLLAMA_FALLBACK_CONTEXT_TOKENS = 16384

/** 应用侧窗口必须与 num_ctx 一致：超出 num_ctx 的输入 Ollama 只截断，不报错。 */
export function ollamaContextTokens(profile: Pick<ModelProfile, 'contextTokens'>): number {
  return profile.contextTokens ?? OLLAMA_FALLBACK_CONTEXT_TOKENS
}

/** 单次 Ollama 生成的结束信息，用于解释空正文、截断等异常。 */
export interface OllamaCallInfo {
  doneReason: string
  outputTokens: number
  promptTokens: number
  numCtx: number
  numPredict: number
  /** num_predict 已用尽或被截断：思考与正文共用同一个额度。 */
  outputLimitReached: boolean
}

/** 保留 Ollama 原生上下文、推理参数，将 NDJSON 映射到 pi 的流式协议。 */
export function ollamaFetch(profile: ModelProfile, fetchRequest: typeof fetch, onCall?: (info: OllamaCallInfo) => void): typeof fetch {
  return async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    const messages = request.messages.map((message: Record<string, any>) => {
      const blocks = Array.isArray(message.content) ? message.content : []
      const images = blocks.filter(block => block.type === 'image_url').map(block => block.image_url.url.split(',')[1])
      return { ...message, content: blocks.length ? blocks.filter(block => block.type === 'text').map(block => block.text).join('\n') : message.content ?? '',
        ...(images.length ? { images } : {}),
        ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call: Record<string, any>) => ({ ...call, function: { ...call.function, arguments: typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments } })) } : {}) }
    })
    // 上下文始终显式下发：省略 num_ctx 时 Ollama 用远小于应用预算的默认值静默截断。
    const numCtx = ollamaContextTokens(profile)
    const numPredict = Math.min(request.max_tokens ?? request.max_completion_tokens ?? profile.maxTokens, profile.maxTokens)
    const response = await fetchRequest(`${normalizeOllamaUrl(profile.baseUrl)}/api/chat`, {
      ...init, redirect: 'error', body: JSON.stringify({ model: profile.model, messages, stream: true, ...(request.tools?.length ? { tools: request.tools } : {}),
        ...(profile.ollamaThinkingLevel != null || profile.thinking != null ? { think: profile.ollamaThinkingLevel ?? profile.thinking } : {}), options: { num_predict: numPredict, num_ctx: numCtx,
          ...(profile.temperature !== null ? { temperature: profile.temperature } : {}) } })
    })
    if (!response.ok || !response.body) return response
    const encoder = new TextEncoder()
    const responseId = randomUUID()
    let pending = '', toolIndex = 0, finished = false
    const stream = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, Uint8Array>({
      transform(chunk, controller) {
        pending += chunk
        const lines = pending.split('\n'); pending = lines.pop()!
        for (const line of lines) if (line.trim()) emit(JSON.parse(line), controller)
      },
      flush(controller) {
        if (pending.trim()) emit(JSON.parse(pending), controller)
        if (!finished) throw new Error('Ollama 响应意外中断，请重试')
      }
    }))
    function emit(item: Record<string, any>, controller: TransformStreamDefaultController<Uint8Array>): void {
      if (item.error) throw new Error('Ollama 服务返回错误，请检查模型和请求参数')
      const delta: Record<string, unknown> = { role: 'assistant' }
      if (item.message?.content) delta.content = item.message.content
      if (item.message?.thinking) delta.reasoning_content = item.message.thinking
      if (item.message?.tool_calls?.length) delta.tool_calls = item.message.tool_calls.map((call: Record<string, any>) => {
        const index = toolIndex++
        return { index, id: `${responseId}-${index}`, type: 'function', function: { name: call.function.name, arguments: JSON.stringify(call.function.arguments) } }
      })
      const doneReason = typeof item.done_reason === 'string' ? item.done_reason : ''
      const outputTokens = typeof item.eval_count === 'number' ? item.eval_count : 0
      const promptTokens = typeof item.prompt_eval_count === 'number' ? item.prompt_eval_count : 0
      // num_predict 用尽优先于工具调用：否则被截断的空响会被上层当成模型自然结束。
      const finishReason = !item.done ? null : doneReason === 'length' ? 'length' : toolIndex ? 'tool_calls' : 'stop'
      if (item.done) {
        finished = true
        onCall?.({ doneReason: doneReason || (finishReason === 'stop' ? 'stop' : ''), outputTokens, promptTokens, numCtx, numPredict,
          outputLimitReached: doneReason === 'length' || (numPredict > 0 && outputTokens >= numPredict) })
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: responseId, object: 'chat.completion.chunk', model: profile.model, choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(item.done ? { usage: { prompt_tokens: promptTokens, completion_tokens: outputTokens, total_tokens: promptTokens + outputTokens } } : {}) })}\n\n`))
      if (item.done) controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    }
    return new Response(stream, { status: response.status, headers: { 'content-type': 'text/event-stream' } })
  }
}
