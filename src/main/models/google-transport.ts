import { GOOGLE_BASE_URL } from '../../shared/google'
import { ModelError } from './model-validation'

const MAX_RETRIES = 3
const MAX_RETRY_DELAY = 8000

function retryDelay(response: Response, attempt: number): number | null {
  const header = response.headers.get('retry-after')?.trim()
  if (header) {
    const seconds = Number(header)
    const date = Date.parse(header)
    const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - Date.now()) : NaN
    if (Number.isFinite(delay)) return delay <= MAX_RETRY_DELAY ? delay : null
  }
  return Math.min(MAX_RETRY_DELAY, 1000 * 2 ** attempt + Math.random() * 1000)
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = (): void => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** 仅重试明确返回 503 的目录或生成请求，不重放已开始的响应流。 */
export function googleTransport(fetchRequest: typeof fetch, signal?: AbortSignal, onRetry?: (attempt: number) => void): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== new URL(GOOGLE_BASE_URL).origin || url.username || url.password) throw new ModelError('Google 请求地址不在官方服务范围内')
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.delete('cookie')
    const sources = [init?.signal, input instanceof Request ? input.signal : undefined, signal].filter((item): item is AbortSignal => item != null)
    const combined = sources.length === 1 ? sources[0] : sources.length ? AbortSignal.any(sources) : undefined
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const eligible = (method === 'GET' && /\/models\/?$/.test(url.pathname)) || (method === 'POST' && /:((stream)?generateContent)$/i.test(url.pathname))
    // 流式请求体不可安全重放；Request 自身则通过 clone 保留可重放副本。
    const replayable = !(init?.body instanceof ReadableStream) && !(input instanceof Request && input.bodyUsed)
    for (let attempt = 0; ; attempt++) {
      combined?.throwIfAborted()
      const request = input instanceof Request ? input.clone() : input
      const response = await fetchRequest(request, { ...init, headers, credentials: 'omit', redirect: 'error', ...(combined ? { signal: combined } : {}) })
      if (response.status !== 503 || !eligible || !replayable || attempt >= MAX_RETRIES) return response
      const delay = retryDelay(response, attempt)
      if (delay === null) return response
      void response.body?.cancel().catch(() => {})
      onRetry?.(attempt + 1)
      await wait(delay, combined)
    }
  }
}
