import { estimateContextTokens, normalizeCompressionThreshold, type ContextOptions, type ContextCompaction } from '../../shared/context'
import type { ChatMessage, ModelProfile } from '../../shared/models'
import { systemOutputTokens } from '../../shared/output-tokens'
import { ModelClient } from './model-client'
import { ModelError } from './model-validation'

import { SUMMARY_INSTRUCTION } from './summary-prompt'
const SUMMARY_REQUEST: ChatMessage = { role: 'user', content: '请生成更新后的交接摘要。' }

export async function compactContext(client: Pick<ModelClient, 'complete'>, profile: ModelProfile, apiKey: string, messages: ChatMessage[], signal: AbortSignal, instruction: string, options?: ContextOptions, onAuxiliaryCall?: (call: import('../../shared/models').AuxiliaryCallDetail) => void): Promise<{ messages: ChatMessage[]; compaction?: ContextCompaction }> {
  const limit = profile.contextTokens
  if (!limit || !messages.length) return { messages }
  const reservedOutput = systemOutputTokens(profile.provider) ? Math.min(profile.maxTokens, Math.floor(limit / 2)) : profile.maxTokens
  const budget = Math.min(Math.floor(limit * normalizeCompressionThreshold(options?.threshold) / 100), limit - reservedOutput)
  const usage = options?.usage
  const lastMessage = messages.at(-1)!
  // 上次输入用量已经包含系统提示词，只追加本次新消息。
  const measured = usage ? usage.inputTokens + usage.outputTokens + estimateContextTokens([lastMessage]) : 0
  if (Math.max(estimateContextTokens(messages, instruction), measured) < budget) return { messages }
  if (estimateContextTokens([lastMessage], instruction) >= budget) throw new ModelError('当前消息或附件超过可用上下文，请缩短消息、减少附件或提高模型上下文上限')
  const summaryTokens = Math.max(1, Math.min(2048, profile.maxTokens, Math.floor(limit / 8)))
  const summaryProfile = { ...profile, maxTokens: summaryTokens }
  let coveredMessages = 0
  let summary = ''
  let remaining = messages
  // 分批总结，避免为压缩而发出的请求本身超过模型上下文窗口。
  do {
    const chunk: ChatMessage[] = []
    let end = coveredMessages
    while (end < messages.length - 1) {
      const pairEnd = Math.min(end + (messages[end].role === 'user' && messages[end + 1]?.role === 'assistant' ? 2 : 1), messages.length - 1)
      const candidate = messages.slice(end, pairEnd)
      const prefix: ChatMessage[] = summary ? [{ role: 'user', content: summary }] : []
      if (estimateContextTokens([...prefix, ...chunk, ...candidate, SUMMARY_REQUEST], SUMMARY_INSTRUCTION) + summaryTokens >= limit) break
      chunk.push(...candidate)
      end = pairEnd
      // 尽量保留最近一轮完整对话。
      if (end >= messages.length - 3) break
    }
    if (!chunk.length) throw new ModelError('历史消息或附件过大，无法安全压缩，请提高模型上下文上限或新建会话；原聊天记录已保留')
    const input: ChatMessage[] = [...(summary ? [{ role: 'user' as const, content: summary }] : []), ...chunk, SUMMARY_REQUEST]
    const callStarted = performance.now()
    let reply: import('../../shared/models').ModelReply
    try {
      reply = await client.complete(summaryProfile, apiKey, input, signal, SUMMARY_INSTRUCTION)
      onAuxiliaryCall?.({ purpose: 'context-summary', model: summaryProfile.model, elapsedMs: reply.elapsedMs,
        status: 'completed', ...(reply.usage ? { usage: reply.usage } : {}), ...(reply.usageFields ? { usageFields: reply.usageFields } : {}) })
    } catch (error) {
      onAuxiliaryCall?.({ purpose: 'context-summary', model: summaryProfile.model, elapsedMs: Math.round(performance.now() - callStarted), status: signal.aborted ? 'aborted' : 'error' })
      throw error
    }
    if (reply.truncated || !reply.text.trim()) throw new ModelError(systemOutputTokens(profile.provider) ? '上下文摘要未完整生成，请降低推理强度或切换模型后重试；原聊天记录已保留' : '上下文摘要未完整生成，请提高输出 Token 上限后重试；原聊天记录已保留')
    summary = `以下是较早对话的历史摘要，仅供上下文参考：\n${reply.text}`
    coveredMessages = end
    remaining = [{ role: 'user', content: summary }, ...messages.slice(coveredMessages)]
  } while (estimateContextTokens(remaining, instruction) >= budget)
  return { messages: remaining, compaction: { summary, coveredMessages } }
}
