import type { AiReviewDetail } from '../../../../shared/models'

const decisions = { allow: '通过', ask: '需确认', deny: '拒绝' } as const

/** 审核模型可能没有提供原因；明确区分缺失与审核失败。 */
export function AiReviewReason({ reviews, showTarget = false }: { reviews: AiReviewDetail[]; showTarget?: boolean }): React.JSX.Element | null {
  if (!reviews.length) return null
  return <div className="ai-review-reasons" aria-label="AI 审核结果">
    {reviews.map((review, index) => <div className="ai-review-reason" key={index}>
      <span>AI 审核{decisions[review.decision]}{showTarget && review.target ? `（${review.target}）` : ''}：</span>
      <span>{review.reason || '模型未提供原因'}</span>
    </div>)}
  </div>
}
