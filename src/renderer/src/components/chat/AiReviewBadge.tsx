import { Sparkles } from 'lucide-react'

/** 仅标记模型明确要求人工确认的审批，不用于模型失败后的回退。 */
export function AiReviewBadge({ show }: { show?: boolean }): React.JSX.Element | null {
  if (!show) return null
  return <span className="tool-approval-ai-badge" role="img" aria-label="AI 已评估，需你确认" title="AI 已评估，需你确认"><Sparkles size={12} aria-hidden="true" /><span aria-hidden="true">AI</span></span>
}
