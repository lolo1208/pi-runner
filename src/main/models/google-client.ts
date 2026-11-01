import { GoogleGenAI } from '@google/genai'
import type { ModelDescriptor } from '../../shared/models'
import { GOOGLE_BASE_URL, GOOGLE_CATALOG_LIMIT, googleChatModel, googleThinking } from '../../shared/google'
import { googleEstimatedPricing, googlePricing } from '../../shared/model-pricing'
import { ModelError } from './model-validation'
import { modelRequestError } from './model-request-error'
import { googleTransport } from './google-transport'
import { googleFetchInjectionWorks } from './google-fetch-support'

const positiveInteger = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined

export class GoogleClient {
  constructor(private readonly fetchRequest: typeof fetch = fetch) {}
  async list(apiKey: string): Promise<ModelDescriptor[]> {
    if (!googleFetchInjectionWorks()) throw new ModelError('Google SDK 的网络注入未生效（@google/genai 补丁丢失）。请在项目目录重新运行 pnpm install 后重启应用')
    const signal = AbortSignal.timeout(60000)
    try {
      // fetch 为固定版本兼容补丁提供的客户端级扩展；不替换全局网络。
      const httpOptions = { baseUrl: GOOGLE_BASE_URL, apiVersion: '', retryOptions: { attempts: 1 }, timeout: 30000, fetch: googleTransport(this.fetchRequest, signal) }
      const client = new GoogleGenAI({ apiKey, vertexai: false, httpOptions })
      const models: ModelDescriptor[] = []
      const pager = await client.models.list({ config: { pageSize: 100 } })
      let count = 0
      for await (const model of pager) {
        signal.throwIfAborted()
        if (++count > GOOGLE_CATALOG_LIMIT) throw new ModelError('Google 模型目录超过上限')
        const id = model.name?.replace(/^models\//, '') ?? ''
        if (id.length > 200 || !googleChatModel(id) || !model.supportedActions?.includes('generateContent')) continue
        const thinking = googleThinking(id)
        const pricing = googlePricing(id) ?? googleEstimatedPricing(id)
        models.push({ id, name: model.displayName?.slice(0, 200) ?? id, capabilities: ['completion', 'tools', 'vision', 'audio', 'video', 'pdf', ...(thinking ? ['thinking'] : [])],
          maxContextTokens: positiveInteger(model.inputTokenLimit) ?? null, maxOutputTokens: positiveInteger(model.outputTokenLimit),
          ...(pricing ? { pricing } : {}),
          ...(thinking ? { thinking } : {}) })
      }
      return [...new Map(models.map(model => [model.id, model])).values()]
    } catch (error) {
      if (signal.aborted) throw new ModelError('Google 模型目录读取超时，请检查网络或代理后重试')
      if (error instanceof ModelError) throw error
      throw new ModelError(`Google 模型目录读取失败：${modelRequestError(error, apiKey)}`)
    }
  }
}
