import { randomUUID } from 'node:crypto'
import type { AgentEvent, PlanInteraction, PlanResponse } from '../../shared/models'
import { ModelError } from './model-validation'

/** 交互绑定请求和会话；等待时暂停超时，取消后立即失效。 */
export class PlanInteractionManager {
  private pending = new Map<string, { requestId: string; conversationId: string; interaction: PlanInteraction; finish(response: PlanResponse): void }>()
  constructor(private readonly emit: (event: AgentEvent) => void) {}
  ask(requestId: string, conversationId: string, details: Omit<PlanInteraction, 'id'>, signal: AbortSignal, onWaiting: (waiting: boolean) => void): Promise<PlanResponse> {
    signal.throwIfAborted()
    const interaction = structuredClone({ ...details, id: randomUUID() })
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        this.pending.delete(interaction.id)
        signal.removeEventListener('abort', abort)
        onWaiting(false)
        this.emit({ type: 'plan-interaction-end', requestId, conversationId, interactionId: interaction.id })
      }
      const abort = (): void => { cleanup(); reject(new ModelError('计划交互已取消')) }
      this.pending.set(interaction.id, { requestId, conversationId, interaction, finish: response => { cleanup(); resolve(response) } })
      signal.addEventListener('abort', abort, { once: true })
      onWaiting(true)
      this.emit({ type: 'plan-interaction', requestId, conversationId, interaction })
    })
  }
  respond(requestId: string, conversationId: string, id: string, value: unknown): void {
    const pending = this.pending.get(id)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) throw new ModelError('计划交互已失效或不属于当前任务')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModelError('计划回应无效')
    const response = value as PlanResponse
    if (pending.interaction.kind === 'questions') {
      const answers = response.answers
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new ModelError('请回答计划问题')
      const clean: Record<string, string> = {}
      for (const question of pending.interaction.questions ?? []) {
        const answer = answers[question.id]
        if (typeof answer !== 'string' || !answer.trim() || answer.length > 8000) throw new ModelError('每个问题都需要选择选项或填写回答')
        clean[question.id] = answer.trim()
      }
      pending.finish({ answers: clean })
    } else {
      if (!['approve', 'revise'].includes(response.decision ?? '')) throw new ModelError('请选择批准或修改计划')
      if (response.feedback !== undefined && (typeof response.feedback !== 'string' || response.feedback.length > 8000)) throw new ModelError('修改意见不能超过 8000 个字符')
      if (response.decision === 'revise' && !response.feedback?.trim()) throw new ModelError('请填写希望如何修改计划')
      if (response.executionModelId !== undefined && (typeof response.executionModelId !== 'string' || !response.executionModelId.trim() || response.executionModelId.length > 128)) throw new ModelError('执行模型无效')
      pending.finish({ decision: response.decision, feedback: response.feedback?.trim(), executionModelId: response.executionModelId })
    }
  }
}
