/** 错误进入界面和会话记录前脱敏；保留排查所需的错误码与原因。 */
export function safeModelErrorDetail(value: string, secret = ''): string {
  let text = secret ? value.split(secret).join('[已隐藏凭据]') : value
  text = text
    .replace(/\bBearer\s+[^\s"',;<>]+/gi, 'Bearer [已隐藏凭据]')
    .replace(/\b(?:set-cookie|cookie)\s*:[^\r\n]+/gi, 'Cookie: [已隐藏凭据]')
    .replace(/(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|password|client_secret|cookie|set-cookie)["']?\s*[:=]\s*)["']?[^\s"',;}<>]+["']?/gi, '$1[已隐藏凭据]')
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[已隐藏凭据]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[已隐藏凭据]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, address => {
      try { const url = new URL(address); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString() }
      catch { return '[已隐藏地址]' }
    })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  return text.trim().slice(0, 1000)
}

/** 只根据服务实际返回的状态和原因分类，不把所有订阅请求失败推断为授权问题。 */
export function modelRequestError(value: unknown, secret = ''): string {
  const raw = (value instanceof Error ? value.message : typeof value === 'string' ? value : '').slice(0, 32000)
  let detail = raw, code = '', status = Number(raw.match(/^(?:Error:\s*)?(?:HTTP\s*)?([45]\d{2})\b/i)?.[1]
    ?? raw.match(/\b(?:HTTP|status(?:\s+code)?)\s*[:=]?\s*([45]\d{2})\b/i)?.[1]
    ?? raw.match(/^[^{}\r\n]{0,80}\(([45]\d{2})\)\s*:/)?.[1])
  // SDK 常返回“状态码 + JSON”；只显示服务的 message/code，不回显整个响应对象。
  const jsonStart = raw.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(raw.slice(jsonStart))
      const error = body.error && typeof body.error === 'object' ? body.error : body
      detail = typeof error.message === 'string' ? error.message : typeof body.error === 'string' ? body.error : typeof error.detail === 'string' ? error.detail : ''
      code = [error.code, error.type].filter((item): item is string => typeof item === 'string').join(' / ')
      const suppliedStatus = Number(error.status ?? body.status)
      if (!status && suppliedStatus >= 400 && suppliedStatus <= 599) status = suppliedStatus
    } catch { detail = raw.slice(0, jsonStart).trim() || '服务返回了无法解析的错误响应' }
  }
  if (/^(?:Error:\s*)?(?:HTTP\s*)?[45]\d{2}[\s:]*$/i.test(detail)) detail = ''
  const reason = `${code} ${detail}`.toLowerCase()
  let summary: string
  if (/context_length_exceeded|context_window_exceeded|maximum context length|context.*too long/.test(reason)) summary = '模型上下文超出上限，请缩短消息或压缩历史后重试'
  else if (/insufficient_quota|quota_exceeded|usage_limit_reached|subscription_sharing_usage_limit_exceeded|exceeded.*quota|usage limit.*reached|hit your.*usage limit/.test(reason)) summary = '模型服务报告可用额度不足，请检查额度或等待额度恢复'
  else if (status === 401 || /invalid_api_key|token_expired|authentication_error|invalid authentication/.test(reason)) summary = '模型服务认证失败，请检查凭据或重新登录'
  else if (status === 429 || /rate_limit_exceeded|too many requests/.test(reason)) summary = '模型服务请求受限，请稍后重试'
  else if (status === 403) summary = '模型服务拒绝访问，请根据返回原因检查访问权限'
  else if (/model_not_found|model.*does not exist/.test(reason)) summary = '模型服务无法找到指定模型，请检查模型名称及可用权限'
  else if (status === 404) summary = '模型服务未找到请求的资源，请检查接口地址及模型名称'
  // 503 多数是服务端容量波动，与请求无关；给出可操作提示，不混同为普通服务器错误。
  else if (status === 503 || /high demand|currently experiencing|overloaded|capacity/.test(reason)) summary = '模型服务当前需求过高（临时状态），请稍后重试或临时切换其它模型'
  else if (status >= 500) summary = '模型服务发生服务器错误，请稍后重试'
  else if (/etimedout|connect_timeout|timed?\s*out|timeout/.test(reason)) summary = '模型请求超时，请检查网络或增加超时秒数'
  else if (/econnreset|econnrefused|enotfound|eai_again|fetch failed|network|socket|connection error/.test(reason)) summary = '模型服务连接失败，请检查网络、代理和接口地址'
  else if (status === 400 || status === 422 || /unsupported_parameter|invalid_request_error/.test(reason)) summary = '模型服务拒绝了请求参数，请根据返回原因调整模型设置'
  else if (/缺少结束事件/.test(reason)) summary = '模型响应流提前结束，未收到结束事件，请重试'
  else summary = '模型请求失败，请根据返回原因排查后重试'
  const metadata = [status ? `HTTP ${status}` : '', safeModelErrorDetail(code, secret)].filter(Boolean).join('；')
  const safeDetail = safeModelErrorDetail(detail, secret)
  return `${summary}${metadata ? `（${metadata}）` : ''}。${safeDetail ? `\n具体原因：${safeDetail}` : '\n服务未提供具体错误原因。'}`
}

/** 在 SDK 将不同 HTTP 错误改写成统一说明之前保留实际服务响应；不消费原响应。 */
export async function modelResponseError(response: Response, secret = ''): Promise<string> {
  const reader = response.clone().body?.getReader()
  if (!reader) return modelRequestError(`HTTP ${response.status}`, secret)
  let body = '', bytes = 0
  const decoder = new TextDecoder()
  try {
    while (bytes < 32000) {
      const chunk = await reader.read()
      if (chunk.done) break
      const kept = chunk.value.subarray(0, 32000 - bytes)
      body += decoder.decode(kept, { stream: true })
      bytes += kept.byteLength
    }
    body += decoder.decode()
  } catch { /* 状态码已确认；读取错误正文失败时仍保留 HTTP 状态。 */ }
  finally {
    // clone 使用 tee；等待取消完成可能需要 SDK 消费原响应，不能在此阻塞。
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return modelRequestError(`HTTP ${response.status}${body ? ` ${body}` : ''}`, secret)
}
