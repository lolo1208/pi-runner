import type { ModelProfile, ProviderId } from './models'

/** 提示词语言：中文为源，英文版服务英文词表模型。 */
export type PromptLang = 'zh' | 'en'

/** 这些供应商本身即英文原生词表模型，无需再看模型名。 */
const ENGLISH_NATIVE_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'google', 'chatgpt', 'claude-subscription']

/** 常见国产模型关键词（命中即用中文）。 */
const CHINESE_MODEL_KEYWORDS = [
  'qwen', 'deepseek', 'glm', 'chatglm', 'kimi', 'moonshot', 'minimax', 'abab',
  'doubao', 'hunyuan', 'ernie', 'baichuan', 'internlm', 'stepfun', 'step-', 'spark',
  'mimo', 'zhipu', 'sensenova', 'sensetime', 'yi-'
]

/** 常见英文模型关键词（仅对 ollama/vllm/custom/openrouter 这类不明确供应商时兜底）。 */
const ENGLISH_MODEL_KEYWORDS = [
  'gpt', 'claude', 'gemini', 'grok', 'llama', 'mistral', 'mixtral', 'command',
  'phi', 'falcon', 'nemotron', 'openai', 'anthropic', 'google'
]

/** 根据供应商和模型名判断该模型适合中文还是英文提示词。 */
export function promptLangFor(profile: Pick<ModelProfile, 'provider' | 'model'>): PromptLang {
  if (profile.provider === 'deepseek') return 'zh'
  if (ENGLISH_NATIVE_PROVIDERS.includes(profile.provider)) return 'en'
  const model = (profile.model ?? '').toLowerCase()
  if (CHINESE_MODEL_KEYWORDS.some(keyword => model.includes(keyword))) return 'zh'
  if (ENGLISH_MODEL_KEYWORDS.some(keyword => model.includes(keyword))) return 'en'
  // 无法识别时保持中文（当前行为），避免边界模型被意外切换。
  return 'zh'
}

/** 按语言选取中文（源）或英文文案。 */
export function pick<T>(lang: PromptLang, zh: T, en: T): T {
  return lang === 'zh' ? zh : en
}
