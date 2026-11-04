import type { ModelDescriptor } from '../../shared/models'
import { deepseekPricing } from '../../shared/model-pricing'
import { DEEPSEEK_BASE_URL, deepseekModelInfo } from '../../shared/deepseek'
import { ModelError, asRecord, requiredString } from './model-validation'
import { readModelJson } from './ollama-client'

export { DEEPSEEK_BASE_URL } from '../../shared/deepseek'

/** 官方目录提供模型 ID；已公布的价格单独按官方定价页匹配。 */
export class DeepseekClient {
  constructor(private readonly fetchRequest: typeof fetch = fetch) {}

  async balance(apiKey: string): Promise<import('../../shared/models').DeepseekBalance> {
    const signal = AbortSignal.timeout(15000)
    try {
      const response = await this.fetchRequest(`${new URL(DEEPSEEK_BASE_URL).origin}/user/balance`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal, redirect: 'error'
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ModelError(response.status === 401 ? 'DeepSeek API Key 无效，请重新配置连接' : `DeepSeek 余额读取失败（HTTP ${response.status}）`)
      }
      const data = await readModelJson(response, 1024 * 1024)
      if (typeof data.is_available !== 'boolean' || !Array.isArray(data.balance_infos) || data.balance_infos.length > 20) throw new ModelError('DeepSeek 余额数据格式无效')
      const balances = data.balance_infos.map(value => {
        const item = asRecord(value)
        const amount = (value: unknown): string => {
          if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 40) throw new ModelError('DeepSeek 余额数据格式无效')
          return value
        }
        return { currency: requiredString(item.currency, '币种', 10), total: amount(item.total_balance), granted: amount(item.granted_balance), toppedUp: amount(item.topped_up_balance) }
      })
      return { fetchedAt: Date.now(), available: data.is_available, balances }
    } catch (error) {
      if (signal.aborted) throw new ModelError('DeepSeek 余额读取超时，将自动重试')
      if (error instanceof ModelError) throw error
      throw new ModelError('无法读取 DeepSeek 余额，请检查网络后重试')
    }
  }

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
