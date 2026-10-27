import { net } from 'electron'

/** Electron fetch 的 manual 重定向会取消请求；用 request 将每一跳交回下载器校验。 */
export const anonymousDownloadFetch: typeof fetch = async (input, init) => new Promise<Response>((resolve, reject) => {
  const signal = init?.signal
  signal?.throwIfAborted()
  const request = net.request({ url: String(input), method: 'GET', headers: {}, credentials: 'omit', useSessionCookies: false, redirect: 'manual', referrerPolicy: 'no-referrer', bypassCustomProtocolHandlers: true })
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let completed = false
  let received = 0
  const cleanup = (): void => signal?.removeEventListener('abort', abort)
  const fail = (error: unknown): void => {
    if (completed) return
    completed = true; cleanup()
    if (controller) controller.error(error)
    else reject(error)
  }
  const abort = (): void => { fail(signal?.reason ?? new Error('下载已取消')); request.abort() }
  signal?.addEventListener('abort', abort, { once: true })
  request.on('error', fail)
  request.on('redirect', (status, _method, url) => {
    if (completed) return
    completed = true; cleanup()
    resolve(new Response(null, { status, headers: { location: url } }))
    request.abort()
  })
  request.on('response', message => {
    if (completed) return
    const headers = new Headers()
    for (const name of ['content-type', 'content-length', 'content-encoding']) {
      const value = message.headers[name]
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
    if (message.statusCode !== 200) {
      completed = true; cleanup()
      resolve(new Response(null, { status: message.statusCode, headers })); request.abort(); return
    }
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
        message.on('end', () => { if (!completed) { completed = true; cleanup(); controller!.close() } })
        message.on('error', fail)
        message.on('aborted', () => fail(new Error('下载连接已中断')))
        message.on('data', chunk => {
          if (completed) return
          received += chunk.length
          // IncomingMessage 不提供暂停接口，接收层也设限，避免慢写入导致无限排队。
          if (received > 64 * 1024 * 1024) { fail(new Error('下载内容超过 64 MiB 上限')); request.abort(); return }
          controller!.enqueue(new Uint8Array(chunk))
        })
      },
      cancel() { completed = true; cleanup(); request.abort() }
    })
    resolve(new Response(body, { status: 200, headers }))
  })
  request.end()
})
