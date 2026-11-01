import { GoogleGenAI } from '@google/genai'
import { GOOGLE_BASE_URL } from '../../shared/google'

let supported: boolean | undefined

/**
 * 官方 SDK 默认只用全局 fetch，无法接入应用的网络通道。项目通过本地补丁让客户端接受
 * httpOptions.fetch；若依赖被重新安装或升级而补丁失效，SDK 会静默回退到 Node 直连，
 * 在不走代理的网络里表现为请求长时间无响应。这里显式检测，把静默挂起变成可诊断的错误。
 */
export function googleFetchInjectionWorks(): boolean {
  if (supported !== undefined) return supported
  const marker = (() => undefined) as unknown as typeof fetch
  try {
    // fetch 是本项目补丁扩展的字段，上游类型未声明；经变量传递避免多余属性检查。
    const httpOptions = { baseUrl: GOOGLE_BASE_URL, apiVersion: '', fetch: marker }
    const client = new GoogleGenAI({ apiKey: 'probe', vertexai: false, httpOptions })
    const injected = (client as unknown as { apiClient?: { clientOptions?: { httpOptions?: { fetch?: unknown } } } })
      .apiClient?.clientOptions?.httpOptions?.fetch
    supported = injected === marker
  } catch { supported = false }
  return supported
}
