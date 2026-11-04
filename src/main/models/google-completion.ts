import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { ChatMessage, ModelProfile, ModelReply } from '../../shared/models'
import { createPiProvider } from './pi-provider'
import { PiAttachments } from './pi-attachments'
import { ModelError } from './model-validation'

/** 摘要和权限审核也使用与代理相同的 Google 原生流、推理设置和错误处理。 */
export async function completeGoogle(profile: ModelProfile, apiKey: string, messages: ChatMessage[], signal: AbortSignal, system: string, onProgress: () => void, fetchRequest: typeof fetch = fetch): Promise<ModelReply> {
  const started = performance.now()
  const attachments = new PiAttachments(SessionManager.inMemory())
  let fields: { input: boolean; output: boolean; cacheRead: boolean; cacheWrite: boolean } | undefined
  const provider = await createPiProvider(profile, apiKey, attachments, false, () => {}, fetchRequest, undefined, active => { if (active) onProgress() }, undefined, info => { if (info.fields) fields = info.fields })
  signal.throwIfAborted()
  const reply = await provider.runtime.completeSimple(provider.model, { messages: [
    ...(system ? [{ role: 'system' as const, content: system, timestamp: Date.now() }] : []),
    ...messages.map(message => {
      if (message.role === 'assistant') return { role: 'assistant' as const, content: [{ type: 'text' as const, text: message.content }], api: provider.model.api, provider: provider.model.provider, model: provider.model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop' as const, timestamp: Date.now() }
      const prepared = attachments.prepare(message)
      return { role: 'user' as const, content: [{ type: 'text' as const, text: prepared.text }, ...prepared.images], timestamp: Date.now() }
    })
  ] }, { signal, reasoning: provider.thinkingLevel === 'off' ? undefined : provider.thinkingLevel })
  signal.throwIfAborted()
  if (reply.stopReason === 'error' || reply.stopReason === 'aborted') throw new ModelError(reply.errorMessage ?? 'Google 模型响应失败')
  const text = reply.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  if (reply.stopReason === 'length' && !text.trim()) throw new ModelError('Google 输出额度已被思考耗尽，请增加输出 Token 上限或降低推理强度')
  if (!text.trim()) throw new ModelError('Google 未返回文本，可能被安全策略拦截，请调整输入后重试')
  const rawUsage = reply.usage as typeof reply.usage & { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
  // pi-ai 将缺失的 usageMetadata 字段也归零；零值不能证明服务端明确报告了零。
  const cacheReadReported = fields?.cacheRead || Number.isSafeInteger(rawUsage.cacheRead) && rawUsage.cacheRead! > 0
  const cacheWriteReported = fields?.cacheWrite || Number.isSafeInteger(rawUsage.cacheWrite) && rawUsage.cacheWrite! > 0
  return { text, model: profile.model, elapsedMs: Math.round(performance.now() - started), truncated: reply.stopReason === 'length',
    usageFields: { input: Boolean(fields?.input || Number.isSafeInteger(rawUsage.input) && rawUsage.input! > 0), output: Boolean(fields?.output || Number.isSafeInteger(rawUsage.output) && rawUsage.output! > 0), cacheRead: cacheReadReported, cacheWrite: cacheWriteReported },
    // pi 将 Google 的缓存读取从 input 中扣除；写入量目前未由该 SDK 提供。
    usage: { inputTokens: reply.usage.input + reply.usage.cacheRead + reply.usage.cacheWrite, outputTokens: reply.usage.output,
      ...(cacheReadReported ? { cacheReadTokens: reply.usage.cacheRead } : {}), ...(cacheWriteReported ? { cacheWriteTokens: reply.usage.cacheWrite } : {}) } }
}
