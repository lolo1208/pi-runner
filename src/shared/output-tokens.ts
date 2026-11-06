import type { ModelDescriptor, ModelProfile, ProviderId } from './models'

export function systemOutputTokens(provider: ProviderId): boolean {
  return provider === 'claude-subscription' || provider === 'openrouter' || provider === 'chatgpt' || provider === 'ollama'
}

/** 输出额度由供应商能力和当前上下文决定，不使用旧配置中的手动额度。 */
export function automaticOutputTokens(profile: Pick<ModelProfile, 'provider' | 'contextTokens'>, model?: Pick<ModelDescriptor, 'maxOutputTokens' | 'maxContextTokens'> | null): number {
  const context = Math.min(profile.contextTokens ?? Infinity, model?.maxContextTokens ?? Infinity, 2097152)
  if (profile.provider === 'ollama') {
    // 本地模型通常不单独声明输出上限：为输入保留一半上下文，最多生成 32K。
    const localContext = Number.isFinite(profile.contextTokens ?? model?.maxContextTokens ?? Infinity) ? context : 8192
    return Math.max(1, Math.min(model?.maxOutputTokens ?? 32768, 32768, Math.floor(localContext / 2)))
  }
  return Math.max(1, Math.min(model?.maxOutputTokens ?? 65536, context))
}
