export type ModelProtocol = 'openai-compatible' | 'anthropic'
export type ProviderId = 'chatgpt' | 'openai' | 'openrouter' | 'anthropic' | 'deepseek' | 'ollama' | 'vllm' | 'custom'
export interface OpenrouterUsage {
  fetchedAt: number
  limit?: number | null
  remaining?: number | null
  dailySpend?: number
  freeDaily?: { used: number; limit: number; remaining: number }
  error?: string
}
export interface ModelProfile {
  id: string
  name: string
  provider: ProviderId
  protocol: ModelProtocol
  baseUrl: string
  model: string
  temperature: number | null
  maxTokens: number
  /** 系统管理的输出额度标记，兼容旧配置；对应供应商不再接受手动额度。 */
  autoMaxTokens?: boolean
  tokenParameter: 'max_tokens' | 'max_completion_tokens'
  timeoutSeconds: number
  /** 模型独立的上下文上限；留空时使用服务默认值。 */
  contextTokens?: number | null
  enabled?: boolean
  thinking?: boolean | null
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null
  ollamaThinkingLevel?: string | null
  /** 目录提供的请求能力，仅由主进程在调用时填充。 */
  supportedParameters?: string[]
}
export interface ModelDescriptor {
  id: string
  name?: string
  created?: number
  maxOutputTokens?: number
  supportedParameters?: string[]
  sizeBytes?: number
  parameterSize?: string
  quantization?: string
  capabilities: string[]
  maxContextTokens: number | null
  thinking?: { values: (boolean | string)[]; default?: boolean | string }
  pricing?: import('./model-pricing').ModelPricing
  /** OpenRouter 目录已读取缓存定价；无价格也保留标记，避免重复刷新。 */
  cachePricingChecked?: boolean
}
export function parseThinkingControls(value: unknown): ModelDescriptor['thinking'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const controls = value as Record<string, unknown>
  if (!Array.isArray(controls.values)) return undefined
  const values = [...new Set(controls.values.filter((item): item is boolean | string => typeof item === 'boolean' || (typeof item === 'string' && item.length > 0 && item.length <= 80)))].slice(0, 20)
  const defaultValue = controls.default
  return { values, ...(values.includes(defaultValue as boolean | string) ? { default: defaultValue as boolean | string } : {}) }
}
export const THINKING_LEVEL_LABELS: Record<string, string> = { off: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' }
/** 把推理档位转成界面短标签，模型列表概览与配置面板共用。 */
export function thinkingLabel(value: boolean | string | null | undefined): string | null {
  if (value == null) return null
  if (typeof value === 'boolean') return value ? '开启' : '关闭'
  return THINKING_LEVEL_LABELS[value] ?? value
}
export function selectedModelThinking(profile: ModelProfile, controls: ModelDescriptor['thinking']): boolean | string | null {
  const values = controls?.values ?? []
  const selected = profile.provider === 'chatgpt' || profile.provider === 'openrouter' ? profile.thinkingLevel ?? (profile.thinking === false ? 'off' : null) : profile.ollamaThinkingLevel ?? profile.thinking
  if (selected != null && values.includes(selected)) return selected
  // 保留用户选择；未配置时优先模型声明的默认值，再回退到中档或开启。
  if (controls?.default != null && values.includes(controls.default)) return controls.default
  if (values.includes('medium')) return 'medium'
  if (values.includes(true)) return true
  return values.find(value => value !== false && value !== 'off') ?? values[0] ?? null
}
export interface ModelProviderConnection { provider: ProviderId; baseUrl: string; models: ModelDescriptor[]; hasApiKey?: boolean }
export interface ModelProfileView extends ModelProfile { hasApiKey: boolean; available?: boolean }
/** 按供应商与服务地址查找界面使用的模型描述符；Ollama 地址可能带或不带 /v1。 */
export function findModelDescriptor(providers: ModelProviderConnection[] | undefined, profile: Pick<ModelProfile, 'provider' | 'baseUrl' | 'model'>): ModelDescriptor | undefined {
  if (!providers?.length) return undefined
  const normalize = (url: string): string => url.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
  return providers.find(item => item.provider === profile.provider && normalize(item.baseUrl) === normalize(profile.baseUrl))?.models.find(item => item.id === profile.model)
}
/** 把 Token 数压成界面短标签，例如 128K、1.05M；无数据时返回 null。 */
export function tokenCountLabel(value: number | null | undefined): string | null {
  if (!value || value <= 0) return null
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  if (value >= 1000) return `${Number((value / 1000).toFixed(value >= 100_000 ? 0 : 1))}K`
  return String(value)
}
export interface ModelSettings {
  profiles: ModelProfileView[]
  activeProfileId: string | null
  /** 审核模型：空表示跟随默认模型；用于工具权限第二层自动审核。 */
  reviewProfileId?: string | null
  encryptionAvailable: boolean
  providers?: ModelProviderConnection[]
}
export interface SaveModelProfile {
  profile: ModelProfile
  credential: { action: 'keep' | 'replace' | 'remove'; value?: string }
}
export const MAX_MESSAGE_IMAGES = 8
export const MAX_CUSTOM_PROMPT_LENGTH = 32000
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_CONVERSATION_IMAGE_BYTES = 32 * 1024 * 1024
export const MAX_MESSAGE_ATTACHMENTS = 8
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024
export const MAX_CONVERSATION_ATTACHMENT_BYTES = 128 * 1024 * 1024
export interface ChatAttachment { id: string; name: string; dataUrl: string }
/** 沿用图片附件的类型与存储字段，兼容已有会话；现在可包含任意文件。 */
export type ChatImage = ChatAttachment
export interface ChatExecution { model: string; provider?: ProviderId; elapsedMs?: number; roundId?: string }
export interface ChatWorkItem { id: string; kind: 'thinking' | 'tool'; name?: string; skillName?: string; args?: Record<string, unknown>; content: string; isError?: boolean; completed?: boolean; state?: 'queued' | 'running' | 'waiting' | 'interrupted'; stateText?: string }
export interface ChatCall { elapsedMs?: number; usage?: ModelUsage; work: ChatWorkItem[] }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; images?: ChatImage[]; skillIds?: string[]; execution?: ChatExecution; call?: ChatCall; snapshotHash?: string; codeSnapshotId?: string; historyId?: string }
export interface ModelUsage { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
export interface ModelRateLimit { kind: 'requests' | 'tokens'; limit: number; remaining: number; reset?: string }
export interface ChatgptAuthStatus { state: 'signed-out' | 'authorizing' | 'signed-in'; url?: string; manualInput?: boolean; error?: string; catalogSource?: 'account' | 'sdk' }
export interface SubscriptionWindow { seconds: number; usedPercent: number; resetsAt?: number }
export interface ResetCredits { availableCount: number; earliestExpiresAt?: number | null }
export interface ChatgptUsage { windows: SubscriptionWindow[]; fetchedAt: number; plan?: string; error?: string; resetCredits?: ResetCredits; resetCreditsError?: string }
export interface ModelReply { text: string; elapsedMs: number; model: string; truncated: boolean; usage?: ModelUsage; roundUsage?: ModelUsage; rateLimits?: ModelRateLimit[]; compaction?: import('./context').ContextCompaction; messages?: ChatMessage[]; warnings?: string[] }
export type PermissionMode = 'default' | 'auto' | 'full'
export const PERMISSION_MODES: PermissionMode[] = ['default', 'auto', 'full']
/** 工具权限第二层自动审核的结论：放行 / 交给用户 / 拒绝。 */
export type ReviewDecision = 'allow' | 'ask' | 'deny'
export interface ToolReviewRequest {
  tool: string
  args: Record<string, unknown>
  cwd: string
  mode: PermissionMode
  project?: string
  reason?: string
  userPrompt: string
  signal: AbortSignal
}
export interface ToolApproval {
  id: string
  toolCallId: string
  tool: string
  args: Record<string, unknown>
  cwd: string
  reason: string
  mustConfirm?: boolean
}
/** “每次询问”模式下命令审批的默认说明；命令弹窗不重复展示这条模式说明，只保留真正的扩权原因。 */
export const DEFAULT_COMMAND_APPROVAL_REASON = '“每次询问”模式下，终端命令需要逐次确认。命令获准后可能读写项目外文件或访问网络'
export interface ToolApprovalPreview { before: string; after: string; path: string }
export type IntentMode = 'plan' | 'execute'
export interface PlanQuestion { id: string; header: string; question: string; options: { label: string; description?: string; recommended?: boolean }[] }
/** 自定义回答入口由界面统一提供，避免与模型生成的兜底选项重复。 */
export function isCustomPlanOption(label: string): boolean {
  return /^(?:其他|其它|other|其他选项|自定义(?:回答)?|(?:填写|输入)自己的回答)(?:\s*[（(].*[）)])?$/i.test(label.trim())
}
export interface PlanInteraction { id: string; kind: 'questions' | 'review'; questions?: PlanQuestion[]; title?: string; content?: string }
export interface PlanResponse { answers?: Record<string, string>; decision?: 'approve' | 'revise'; feedback?: string }
export interface AgentRequestOptions { conversationId: string; project?: string | null; intentMode?: IntentMode }
export interface AgentSnapshot { project: string; before: import('./api').Checkpoint; after: import('./api').Checkpoint; messageIndex?: number; undone?: boolean }
export interface AgentEvent {
  requestId: string
  conversationId: string
  type: 'text' | 'status' | 'transcript' | 'snapshot' | 'speed' | 'approval' | 'approval-end' | 'plan-interaction' | 'plan-interaction-end' | 'intent-mode'
  interaction?: PlanInteraction
  interactionId?: string
  intentMode?: IntentMode
  approval?: ToolApproval
  approvalId?: string
  text?: string
  resetText?: boolean
  messages?: ChatMessage[]
  snapshot?: AgentSnapshot
  speed?: OutputSpeed
}
/** 流式回复期间的输出速度统计，节流后随 AgentEvent 下发。 */
export interface OutputSpeed {
  /** 本轮累计输出 Token 数（含思考）。 */
  outputTokens: number
  /** 最近一个统计窗口的输出速度。 */
  recentTokensPerSecond: number
  /** 首个 Token 起的平均输出速度。 */
  averageTokensPerSecond: number
  /** 本轮速度峰值。 */
  peakTokensPerSecond: number
  /** 从请求发出到首个输出 Token 的耗时；尚无输出时为 null。 */
  firstResponseMs: number | null
  /** 首个输出 Token 起的累计时长。 */
  elapsedMs: number
  /** 每秒窗口的采样，用于速度曲线。 */
  samples: { at: number; tokensPerSecond: number }[]
}
export type ModelResult<T> = { ok: true; value: T } | { ok: false; error: string }
export interface ProviderPreset { id: ProviderId; label: string; protocol: ModelProtocol; baseUrl: string }
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'chatgpt', label: 'ChatGPT 订阅', protocol: 'openai-compatible', baseUrl: 'https://chatgpt.com/backend-api' },
  { id: 'openai', label: 'OpenAI', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'anthropic', label: 'Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'ollama', label: 'Ollama', protocol: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' },
  { id: 'vllm', label: 'vLLM', protocol: 'openai-compatible', baseUrl: 'http://localhost:8000/v1' },
  { id: 'custom', label: '自定义服务', protocol: 'openai-compatible', baseUrl: '' }
]
