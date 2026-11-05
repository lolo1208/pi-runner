import type { ModelDescriptor } from '../../shared/models'
import { enrichSiliconflowModels } from './siliconflow-pricing'
import { asRecord, ModelError, normalizeBaseUrl } from './model-validation'
import { modelResponseError, safeModelErrorDetail } from './model-request-error'

/** 目录字段不是兼容协议的强制部分，未声明的能力保持未知。 */
export async function listCompatibleModels(value: unknown, fetchRequest: typeof fetch = fetch): Promise<ModelDescriptor[]> {
  const input = asRecord(value)
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : input.apiKey ?? ''
  if (typeof key !== 'string' || key.length > 8192 || /[^\x21-\x7e]/.test(key)) throw new ModelError('API Key 格式无效')
  const signal = AbortSignal.timeout(30000)
  let response: Response
  try {
    response = await fetchRequest(`${baseUrl}/models`, { headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, signal, redirect: 'error' })
  } catch { throw new ModelError('无法读取模型目录，请检查地址和网络；也可以手动填写模型 ID') }
  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    const detail = /\bjson\b/i.test(contentType) ? await modelResponseError(response, key) : `服务返回非 JSON 错误响应（HTTP ${response.status}），可能来自服务或网络中间层。`
    const requestId = safeModelErrorDetail(response.headers.get('x-request-id') ?? response.headers.get('cf-ray') ?? '', key)
    await response.body?.cancel().catch(() => undefined)
    throw new ModelError(`模型目录读取失败：${detail}${requestId ? `\n请求标识：${requestId}` : ''}\n也可手动填写模型 ID。`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new ModelError('模型目录为空')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      size += chunk.byteLength
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new ModelError('模型目录超过 4 MiB 上限') }
      chunks.push(chunk)
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const root = body && typeof body === 'object' ? body as Record<string, unknown> : {}
    const rows = Array.isArray(body) ? body : Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : null
    if (!rows) throw new ModelError('无法识别模型目录格式，可手动填写模型 ID')
    const positive = (...values: unknown[]): number | undefined => values.map(v => typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v).find(v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0) as number | undefined
    const models = new Map<string, ModelDescriptor>()
    for (const row of rows.slice(0, 10000)) {
      const item = typeof row === 'string' ? { id: row } : row
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const rawId = record.id ?? record.model ?? record.name
      if (typeof rawId !== 'string' || !rawId.trim() || rawId.trim().length > 200) continue
      const id = rawId.trim()
      models.set(id, { id, name: typeof record.name === 'string' ? record.name.slice(0, 200) : undefined,
        capabilities: Array.isArray(record.capabilities) ? record.capabilities.filter((v): v is string => typeof v === 'string').slice(0, 30) : [],
        maxContextTokens: positive(record.context_length, record.context_window, record.max_model_len) ?? null,
        maxOutputTokens: positive(record.max_output_tokens, record.max_completion_tokens),
        supportedParameters: Array.isArray(record.supported_parameters) ? record.supported_parameters.filter((v): v is string => typeof v === 'string').slice(0, 100) : undefined })
    }
    return await enrichSiliconflowModels(baseUrl, [...models.values()], fetchRequest)
  } catch (error) {
    if (error instanceof ModelError) throw error
    if (signal.aborted) throw new ModelError('读取模型目录超时，可重试或手动填写模型 ID')
    if (error instanceof SyntaxError) throw new ModelError('模型目录不是有效 JSON，可手动填写模型 ID')
    throw new ModelError('模型目录读取中断，可重试或手动填写模型 ID')
  }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
