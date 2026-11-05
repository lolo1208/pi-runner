import { ModelIcon } from './chat/ModelIcon'

// 仅根据明确的服务域名识别，避免把第三方代理误认为模型原厂。
const vendorDomains: Array<{ domains: string[]; model: string }> = [
  { domains: ['openai.com'], model: 'chatgpt' },
  { domains: ['anthropic.com'], model: 'anthropic' },
  { domains: ['deepseek.com'], model: 'deepseek' },
  { domains: ['openrouter.ai'], model: 'openrouter' },
  { domains: ['siliconflow.cn', 'siliconflow.com', 'siliconflow.com.cn'], model: 'siliconflow' },
  { domains: ['groq.com'], model: 'groq' },
  { domains: ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'bailian.aliyuncs.com'], model: 'qwen' },
  { domains: ['generativelanguage.googleapis.com', 'aiplatform.googleapis.com'], model: 'gemini' },
  { domains: ['moonshot.cn', 'moonshot.ai'], model: 'moonshot' },
  { domains: ['bigmodel.cn', 'zhipuai.cn', 'z.ai'], model: 'zhipu' },
  { domains: ['minimax.chat', 'minimaxi.com', 'minimax.io'], model: 'minimax' },
  { domains: ['mistral.ai'], model: 'mistral' },
  { domains: ['x.ai'], model: 'grok' },
  { domains: ['volces.com', 'volcengine.com'], model: 'bytedance' },
  { domains: ['stepfun.com'], model: 'stepfun' },
  { domains: ['fireworks.ai'], model: 'fireworks' },
  { domains: ['nvidia.com'], model: 'nvidia' },
  { domains: ['cohere.com', 'cohere.ai'], model: 'cohere' },
]

export function CompatibleConnectionIcon({ baseUrl }: { baseUrl: string }): React.JSX.Element {
  let model: string | undefined
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase().replace(/\.$/, '')
    model = vendorDomains.find(vendor => vendor.domains.some(domain => host === domain || host.endsWith(`.${domain}`)))?.model
  } catch { /* 无效地址使用通用图标。 */ }
  return <span aria-hidden="true" className="inline-flex shrink-0"><ModelIcon model={model} size={16} /></span>
}
