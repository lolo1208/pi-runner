import type { ModelDescriptor, ModelProfile } from './models'

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
export const DEEPSEEK_CONTEXT_TOKENS = 1_000_000
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 393_216
export const DEEPSEEK_DEFAULT_OUTPUT_TOKENS = 65_536

/** 仅对官方定价页明确列出的型号及其官方别名补充规格。 */
export function deepseekModelInfo(id: string): Partial<ModelDescriptor> {
  const flash = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(id)
  if (!flash && id !== 'deepseek-v4-pro') return {}
  return { capabilities: ['completion', 'tools', 'thinking', ...(flash ? ['vision'] : [])],
    maxContextTokens: DEEPSEEK_CONTEXT_TOKENS, maxOutputTokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
    thinking: { values: ['off', 'low', 'high', 'max'], default: 'high' } }
}

/** 旧版布尔推理开关保留原意；未设置时采用官方默认 high。 */
export function deepseekThinking(profile: Pick<ModelProfile, 'thinkingLevel' | 'thinking'>): 'off' | 'low' | 'high' | 'max' {
  if (profile.thinkingLevel === 'off' || profile.thinkingLevel === 'low' || profile.thinkingLevel === 'high' || profile.thinkingLevel === 'max') return profile.thinkingLevel
  if (profile.thinking === false) return 'off'
  return 'high'
}
