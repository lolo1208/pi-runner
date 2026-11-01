import type { ModelDescriptor, ModelProfile } from './models'

export const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const GOOGLE_CATALOG_LIMIT = 2000
// Google Gemini API 模型文档（2026-10-28）中仍在服务的通用文本模型。
// 目录列出模型不代表当前项目有权限；新型号需核对官方文档后更新此快照。
const documentedGoogleModels = new Set([
  'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview',
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'
])
export const googleDocumentedModel = (id: string): boolean => documentedGoogleModels.has(id)

/** 通用 Pro/Flash 系列（含 latest 别名）；排除生成图片、实时音频等专用端点。 */
export function googleChatModel(id: string): boolean {
  return (id === 'gemini-4-argon' || /^gemini-(?:\d+(?:\.\d+)?-)?(?:pro|flash)(?:-[a-z0-9.-]+)?$/.test(id))
    && !/image|audio|tts|live|native|robotics|computer-use|deep-research|customtools|embedding/.test(id)
}
/**
 * 各型号默认与支持的思考档位，逐项取自官方表格（https://ai.google.dev/gemini-api/docs/thinking，2026-11-01 核对）。
 * 2.5 系列用 thinkingBudget：官方默认“开启”（dynamic），此处以 medium 表示开启，避免下发关闭。
 * 只有 2.5 Flash-Lite 官方默认关闭。
 */
const googleThinkingLevels: Record<string, { values: string[]; default?: string }> = {
  'gemini-4-argon': { values: ['low', 'medium', 'high'], default: 'medium' },
  'gemini-3.8-flash': { values: ['low', 'medium', 'high'], default: 'medium' },
  'gemini-3.6-flash': { values: ['minimal', 'low', 'medium', 'high'], default: 'medium' },
  'gemini-3.5-flash-lite': { values: ['minimal', 'low', 'medium', 'high'], default: 'minimal' },
  'gemini-3.1-pro-preview': { values: ['low', 'medium', 'high'], default: 'high' },
  'gemini-3-flash-preview': { values: ['minimal', 'low', 'medium', 'high'], default: 'high' },
  'gemini-3-pro-preview': { values: ['low', 'high'], default: 'high' },
  'gemini-2.5-pro': { values: ['low', 'medium', 'high'], default: 'medium' },
  'gemini-2.5-flash': { values: ['low', 'medium', 'high'], default: 'medium' },
  'gemini-2.5-flash-lite': { values: ['off', 'low', 'medium', 'high'], default: 'off' },
}
export function googleThinking(id: string): ModelDescriptor['thinking'] {
  const known = Object.hasOwn(googleThinkingLevels, id) ? googleThinkingLevels[id] : undefined
  if (known) return { values: known.values, ...(known.default ? { default: known.default } : {}) }
  // 官方文档未列出的型号（如 gemini-3.5-flash、gemini-3.7-flash）不下发思考配置：
  // 发送服务端未声明的 thinkingLevel 可能被拒绝或长时间无响应，且档位本身就是猜的。
  return undefined
}
export function googleModelProfile(model: ModelDescriptor, id: string): ModelProfile {
  return { id, name: model.id.slice(0, 80), provider: 'google', protocol: 'google-generative-ai', baseUrl: GOOGLE_BASE_URL, model: model.id,
    temperature: null, contextTokens: null, enabled: false, tokenParameter: 'max_tokens', timeoutSeconds: 120,
    // 与 OpenRouter 同口径：按模型目录上限，最多 65,536；思考与正文共用该额度，过小会被思考吃光。
    maxTokens: Math.min(65536, model.maxOutputTokens ?? 65536),
    thinkingLevel: model.thinking?.default as ModelProfile['thinkingLevel'] ?? null }
}
