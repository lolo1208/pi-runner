import type { AiReviewDetail } from '../../../../shared/models'
import { ModelIcon } from './ModelIcon'

/** 审核模型可能没有提供原因；明确区分缺失与审核失败。 */
export function AiReviewReason({ reviews, showTarget = false }: { reviews: AiReviewDetail[]; showTarget?: boolean }): React.JSX.Element | null {
  if (!reviews.length) return null
  return <div className="ai-review-reasons" aria-label="AI 审核结果">
    {reviews.map((review, index) => <div className="ai-review-reason" key={index}>
      <span className="ai-review-reason-heading"><ModelIcon model={review.model} provider={review.provider} size={13} /><span>{review.model || '审核模型'}：</span></span>
      <span>{showTarget && review.target ? `（${review.target}）` : ''}{review.reason || '模型未提供原因'}</span>
    </div>)}
  </div>
}
