import type { ModelDescriptor } from '../../shared/models'
import { siliconflowGlobalPrices } from '../../shared/siliconflow-global-data'
import { siliconflowCnPrices } from '../../shared/siliconflow-cn-data'

export function siliconflowPricingSnapshot(baseUrl: string, models: ModelDescriptor[]): ModelDescriptor[] {
  const region = siliconflowRegion(baseUrl)
  if (!region) return models
  if (region === 'cn') return models.map(model => {
    if (model.pricing?.kind === 'siliconflow' && Date.parse(model.pricing.checkedAt) >= Date.parse('2026-11-05')) return model
    const price = Object.hasOwn(siliconflowCnPrices, model.id) ? siliconflowCnPrices[model.id] : undefined
    return price ? { ...model, pricing: { input: price[0], output: price[1], kind: 'siliconflow', currency: 'CNY', source: 'https://www.siliconflow.cn/pricing', checkedAt: '2026-11-05' } } : model
  })
  return models.map(model => {
    if (model.pricing?.kind === 'siliconflow' && Date.parse(model.pricing.checkedAt) >= Date.parse('2026-11-05')) return model
    const name = model.id.split('/').at(-1)!
    const price = !model.id.startsWith('Pro/') && models.filter(other => other.id.split('/').at(-1) === name).length === 1 && Object.hasOwn(siliconflowGlobalPrices, name) ? siliconflowGlobalPrices[name] : undefined
    return price ? { ...model, pricing: { input: price[0], output: price[1], cacheRead: price[2], kind: 'siliconflow', currency: 'USD', source: 'https://www.siliconflow.com/pricing', checkedAt: '2026-11-05' } } : model
  })
}

/** 严格识别官方 API 地址；代理、自定义子域和异常路径不套用官方价。 */
export function siliconflowRegion(baseUrl: string): 'cn' | 'global' | null {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' || url.port || !/^\/v1\/?$/.test(url.pathname)) return null
    return url.hostname === 'api.siliconflow.cn' ? 'cn' : url.hostname === 'api.siliconflow.com' ? 'global' : null
  } catch { return null }
}

/** 官网快照动态采集；不猜测默认生成参数，不将图像/音频价格当作 Token 价格。 */
export async function enrichSiliconflowModels(baseUrl: string, models: ModelDescriptor[], fetchRequest: typeof fetch): Promise<ModelDescriptor[]> {
  const region = siliconflowRegion(baseUrl)
  if (!region) return models
  models = siliconflowPricingSnapshot(baseUrl, models)
  const source = `https://www.siliconflow.${region === 'cn' ? 'cn' : 'com'}/pricing`
  try {
    const response = await fetchRequest(source, { signal: AbortSignal.timeout(15000), redirect: 'error' })
    if (!response.ok) return models
    const reader = response.body?.getReader()
    if (!reader) return models
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 12 * 1024 * 1024) return models
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    const html = Buffer.concat(chunks).toString('utf8')
    const checkedAt = new Date().toISOString()
    const prices = new Map<string, { input: number; output: number; cacheRead?: number; context?: number; source?: string }>()
    if (region === 'cn') {
      const payload = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)].map(match => JSON.parse(match[1]) as string).join('')
      const records = new Map<string, unknown>()
      for (const line of payload.split('\n')) {
        const match = /^([a-f0-9]+):([\[{].*)$/.exec(line)
        if (match) { try { records.set(match[1], JSON.parse(match[2])) } catch { /* 非 JSON 的 Flight 记录不参与解析。 */ } }
      }
      const resolve = (value: unknown): any => typeof value === 'string' && /^\$[a-f0-9]+$/.test(value) ? records.get(value.slice(1)) : value
      for (const value of records.values()) {
        const item = value as Record<string, unknown>
        if (!item || typeof item !== 'object' || item.type !== 'text' || typeof item.modelName !== 'string') continue
        const entries = resolve(item.pricing)
        if (!Array.isArray(entries)) continue
        const rates = entries.map(resolve)
        // 条件分档无法用单一输入/输出价表达时保持未知。
        const input = rates.filter(rate => rate?.specification === 'prompt' && rate.unitOfGood === '/ M Tokens')
        const output = rates.filter(rate => rate?.specification === 'completion' && rate.unitOfGood === '/ M Tokens')
        if (input.length !== 1 || output.length !== 1) continue
        const a = Number(input[0].price), b = Number(output[0].price)
        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) continue
        // 国内首屏存在条件价与 Flight 默认零值冲突，已知冲突型号不标成免费。
        if (item.modelName === 'zai-org/GLM-5.3-Flash' && a === 0 && b === 0) continue
        prices.set(item.modelName, { input: a, output: b, context: typeof item.contextLen === 'number' ? item.contextLen : undefined })
      }
    } else {
      const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ')
      // 国际官网公开表格：型号、上下文、输入、可选缓存输入、输出、Details。
      const rows = [...text.matchAll(/([\w][\w.\/-]*)\s+(\d+(?:\.\d+)?)[KM]\s+\$\s*([\d.]+)\s+\$\s*([\d.]+)(?:\s+\$\s*([\d.]+))?\s+Details/g)]
      // 补采完整模型列表，解决定价页首屏 Load More 导致的缺失；不执行页面脚本。
      try {
        for (const page of ['llm', 'vision']) {
        const extra = await fetchRequest(`https://www.siliconflow.com/models/${page}`, { signal: AbortSignal.timeout(15000), redirect: 'error' })
        if (extra.ok) {
          const body = await extra.text()
          if (body.length <= 12 * 1024 * 1024) {
            const plain = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
            const cards = [...plain.matchAll(/([\w][\w.\/-]*) Release on:((?:(?!Release on:).)*?)(?= [\w][\w.\/-]* Release on:|$)/g)]
            for (const card of cards) {
              const input = /Input:\s*\$\s*([\d.]+)\s*\/ M Tokens/.exec(card[2])
              const output = /Output:\s*\$\s*([\d.]+)\s*\/ M Tokens/.exec(card[2])
              if (input && output && Number.isFinite(Number(input[1])) && Number.isFinite(Number(output[1]))) prices.set(card[1], { input: Number(input[1]), output: Number(output[1]), source: `https://www.siliconflow.com/models/${page}` })
            }
          }
        }
        }
      } catch { /* 补采失败时仍保留定价页及已核对快照。 */ }
      for (const row of rows) {
        const input = Number(row[3]), output = Number(row[5] ?? row[4])
        if (Number.isFinite(input) && Number.isFinite(output)) prices.set(row[1], { input, output, cacheRead: row[5] ? Number(row[4]) : undefined })
      }
    }
    return models.map(model => {
      // 国际页无完整命名空间：仅允许目录内唯一的同名型号，Pro 前缀不降级匹配。
      const name = model.id.split('/').at(-1)!
      const rate = prices.get(model.id) ?? (region === 'global' && !model.id.startsWith('Pro/') && models.filter(other => other.id.split('/').at(-1) === name).length === 1 ? prices.get(name) : undefined)
      return rate ? { ...model, maxContextTokens: model.maxContextTokens ?? rate.context ?? null, pricing: { input: rate.input, output: rate.output, cacheRead: rate.cacheRead ?? (model.pricing?.input === rate.input && model.pricing?.output === rate.output ? model.pricing.cacheRead : undefined), kind: 'siliconflow', currency: region === 'cn' ? 'CNY' : 'USD', source: rate.source ?? source, checkedAt } } : model
    })
  } catch { return models }
}
