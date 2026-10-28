/** 只提取供应商明确返回的明文，绝不将加密数据、签名或整个 JSON 当作思考展示。 */
export function thinkingText(block: { thinking: string; thinkingSignature?: string }): string {
  if (block.thinking.trim()) return block.thinking
  if (!block.thinkingSignature) return ''
  try {
    const value: unknown = JSON.parse(block.thinkingSignature)
    const text = (entries: unknown): string => Array.isArray(entries) ? entries.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return []
      const item = entry as Record<string, unknown>
      if (item.type === 'reasoning.encrypted') return []
      if (item.type === 'reasoning.summary' && typeof item.summary === 'string') return [item.summary]
      if (['reasoning.text', 'summary_text', 'reasoning_text', 'text'].includes(String(item.type)) && typeof item.text === 'string') return [item.text]
      return []
    }).join('\n\n') : ''
    // OpenRouter 将结构化推理明文和回放签名保存在同一个字段中。
    if (Array.isArray(value)) return text(value)
    if (value && typeof value === 'object' && (value as Record<string, unknown>).type === 'reasoning') {
      const item = value as Record<string, unknown>
      return text(item.summary) || text(item.content)
    }
  } catch { /* 普通签名不是 JSON，不包含可展示文本。 */ }
  return ''
}

/** 保留推理强度及其他参数，只显式要求服务返回可展示的摘要。 */
export function requestThinkingSummary(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const body = payload as Record<string, unknown>
  const reasoning = body.reasoning
  if (reasoning && typeof reasoning === 'object' && (reasoning as Record<string, unknown>).effort !== 'none') {
    return { ...body, reasoning: { ...reasoning, summary: 'detailed' } }
  }
  return payload
}
