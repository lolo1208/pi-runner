import type { ModelDescriptor } from '../../shared/models'
import { deepseekPricing } from '../../shared/model-pricing'
import { DEEPSEEK_BASE_URL, deepseekModelInfo } from '../../shared/deepseek'
import { ModelError, asRecord, requiredString } from './model-validation'
import { readModelJson } from './ollama-client'

export { DEEPSEEK_BASE_URL } from '../../shared/deepseek'

/** 官方目录提供模型 ID；已公布的价格单独按官方定价页匹配。 */
export class DeepseekClient {
  constructor(private readonly fetchRequest: typeof fetch = fetch) {}

  async list(apiKey: string): Promise<ModelDescriptor[]> {
    const signal = AbortSignal.timeout(30000)
    try {
      const response = await this.fetchRequest(`${DEEPSEEK_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal, redirect: 'error'
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        const hint = response.status === 401 ? 'API Key 无效，请重新输入' : response.status === 429 ? '请求过于频繁，请稍后重试' : '请检查账号权限或稍后重试'
        throw new ModelError(`DeepSeek 返回 HTTP ${response.status}：${hint}`)
      }
      const result = await readModelJson(response, 1024 * 1024)
      if (!Array.isArray(result.data) || result.data.length > 200) throw new ModelError('DeepSeek 模型目录格式无效或超过 200 条')
      const models = result.data.map(value => {
        const item = asRecord(value)
        const id = requiredString(item.id, '模型 ID', 200)
        return { id, name: id, capabilities: [], maxContextTokens: null, ...deepseekModelInfo(id), pricing: deepseekPricing(id) }
      })
      if (!models.length) throw new ModelError('DeepSeek 未返回模型，请稍后重试')
      return [...new Map(models.map(model => [model.id, model])).values()]
    } catch (error) {
      if (signal.aborted) throw new ModelError('DeepSeek 模型目录读取超时，请检查网络或代理')
      if (error instanceof ModelError) throw error
      throw new ModelError('无法读取 DeepSeek 模型目录，请检查网络或代理')
    }
  }
}
