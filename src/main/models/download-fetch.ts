import { net } from 'electron'

/** Electron fetch 的 manual 重定向会取消请求；用 request 将每一跳交回下载器校验。 */
export const anonymousDownloadFetch: typeof fetch = async (input, init) => new Promise<Response>((resolve, reject) => {
  const signal = init?.signal
  signal?.throwIfAborted()
  const request = net.request({ url: String(input), method: 'GET', headers: {}, credentials: 'omit', useSessionCookies: false, redirect: 'manual', referrerPolicy: 'no-referrer', bypassCustomProtocolHandlers: true })
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let completed = false, requestAborted = false, received = 0
  const cleanup = (): void => signal?.removeEventListener('abort', abort)
  const stopRequest = (): void => {
    if (requestAborted) return
    requestAborted = true
    try { request.abort() } catch { /* 已关闭的请求不能覆盖原始结果。 */ }
  }
  const fail = (error: unknown): void => {
    if (completed) return
    completed = true
    cleanup()
    if (controller) { try { controller.error(error) } catch { /* 流可能已被消费者取消。 */ } }
    reject(error)
    stopRequest()
  }
  const abort = (): void => fail(signal?.reason ?? new Error('下载已取消'))
  signal?.addEventListener('abort', abort, { once: true })
  request.on('error', fail)
  request.on('abort', () => fail(new Error('下载请求已中断')))
  request.on('close', () => { if (!completed) fail(new Error('下载请求在完整响应结束前关闭')) })
  request.on('redirect', (status, _method, url) => {
    if (completed) return
    try {
      const response = new Response(null, { status, headers: { location: url } })
      completed = true
      cleanup()
      resolve(response)
      stopRequest()
    } catch (error) { fail(error) }
  })
  request.on('response', message => {
    // 即使请求刚被取消，迟到响应也不能产生未处理的 error 事件。
    message.on('error', fail)
    if (completed) return
    try {
      const headers = new Headers()
      for (const name of ['content-type', 'content-length', 'content-encoding']) {
        const value = message.headers[name]
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      if (message.statusCode !== 200) {
        const response = new Response(null, { status: message.statusCode, headers })
        completed = true
        cleanup()
        resolve(response)
        stopRequest()
        return
      }
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value
          message.on('end', () => {
            if (completed) return
            completed = true
            cleanup()
            controller!.close()
          })
          message.on('aborted', () => fail(new Error('下载连接已中断')))
          message.on('data', chunk => {
            if (completed) return
            try {
              received += chunk.length
              // IncomingMessage 无暂停接口，接收层也设限，避免慢写入无限排队。
              if (received > 64 * 1024 * 1024) { fail(new Error('下载内容超过 64 MiB 上限')); return }
              controller!.enqueue(new Uint8Array(chunk))
            } catch (error) { fail(error) }
          })
        },
        cancel() { completed = true; cleanup(); stopRequest() }
      })
      resolve(new Response(body, { status: 200, headers }))
    } catch (error) { fail(error) }
  })
  // net.request 构造及事件订阅期间也可能已取消，不能只在入口检查一次。
  if (signal?.aborted) abort()
  else {
    try { request.end() } catch (error) { fail(error) }
  }
})
