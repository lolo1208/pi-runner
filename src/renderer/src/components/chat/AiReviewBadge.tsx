import { Sparkles } from 'lucide-react'
import type { ReviewDecision } from '../../../../shared/models'

/** 只标记模型实际返回的有效结论，不将回退或规则审核误认为 AI 审核。 */
export function AiReviewBadge({ show, decision = 'ask', partial = false }: { show?: boolean; decision?: ReviewDecision; partial?: boolean }): React.JSX.Element | null {
  if (!show) return null
  const result = { allow: '已通过', ask: '需你确认', deny: '已拒绝' }[decision]
  const label = partial ? `AI 已评估部分操作，最严格结论：${result}` : `AI 已评估，${result}`
  return <span className="tool-approval-ai-badge" role="img" aria-label={label} title={label}><Sparkles size={12} aria-hidden="true" /><span aria-hidden="true">AI</span></span>
}
