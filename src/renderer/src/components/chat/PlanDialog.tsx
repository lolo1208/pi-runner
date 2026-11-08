import { useMemo, useState, type ReactNode } from 'react'
import { Check, ListTodo } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { PlanInteraction, PlanResponse } from '../../../../shared/models'
import { isCustomPlanOption } from '../../../../shared/models'

import { PlanContent, parsePlan } from './PlanContent'

export function PlanDialog({ interaction, onRespond, onDismiss, onCancel, modelPicker, modelSettingsBusy = false }: { modelSettingsBusy?: boolean; modelPicker?: (disabled: boolean) => ReactNode; interaction: PlanInteraction; onRespond(response: PlanResponse): Promise<void>; onDismiss(): void; onCancel(): void }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const questions = interaction.questions ?? []
  const question = questions[step]
  const options = question?.options.filter(option => !isCustomPlanOption(option.label)) ?? []
  const answer = question ? answers[question.id] === '__custom__' ? custom[question.id]?.trim() : answers[question.id] : ''
  const submit = async (response: PlanResponse): Promise<void> => {
    if (submitting) return
    setSubmitting(true); setError('')
    try { await onRespond(response) }
    catch (e) { setError(e instanceof Error ? e.message : '计划回应失败，请重试') }
    finally { setSubmitting(false) }
  }
  const { tokens, sections } = useMemo(() => parsePlan(interaction.content ?? ''), [interaction.content])
  return <Modal open onOpenChange={open => { if (!open) onDismiss() }} closeDisabled={submitting} closeLabel="收起计划对话框" title={interaction.kind === 'questions' ? '确认需求' : '审阅计划'} contentClassName={`plan-dialog ${interaction.kind === 'review' ? 'plan-review-dialog' : ''}`}>
    {interaction.kind === 'questions' && question ? <div className="plan-question-body">
      <div className="plan-question-meta"><h2 id="plan-question-title">{question.header}</h2><span>{step + 1}/{questions.length}</span></div>
      <p id="plan-question-description" className="plan-question-description">{question.question}</p>
      <RadioGroup aria-labelledby="plan-question-title" aria-describedby="plan-question-description" value={answers[question.id] ?? ''} onValueChange={value => setAnswers(previous => ({ ...previous, [question.id]: value }))} disabled={submitting} className="plan-options">
        {options.map((option, index) => <RadioGroupItem variant="segmented" value={option.label} key={index} className="plan-option"><span><strong>{option.label}{(option.recommended || (!options.some(item => item.recommended) && index === 0)) && <small>推荐</small>}</strong>{option.description && <span className="plan-option-description">{option.description}</span>}</span><span className="plan-option-check" aria-hidden="true">{answers[question.id] === option.label && <Check size={16} />}</span></RadioGroupItem>)}
        <RadioGroupItem variant="segmented" value="__custom__" className="plan-option"><strong>输入自己的回答</strong><span className="plan-option-check" aria-hidden="true">{answers[question.id] === '__custom__' && <Check size={16} />}</span></RadioGroupItem>
      </RadioGroup>
      {answers[question.id] === '__custom__' && <Textarea autoFocus aria-label="自己的回答" placeholder="说说你的想法…" maxLength={8000} value={custom[question.id] ?? ''} disabled={submitting} onChange={event => setCustom(previous => ({ ...previous, [question.id]: event.target.value }))} />}
      {error && <p className="error" role="alert">{error}</p>}
      <footer className="plan-dialog-actions"><Button className="plan-cancel" variant="ghost" onClick={onCancel} disabled={submitting}>停止计划</Button><div><Button variant="outline" disabled={step === 0 || submitting} onClick={() => setStep(previous => previous - 1)}>上一步</Button><Button className="plan-submit-answer" disabled={!answer || submitting} onClick={() => {
        if (step < questions.length - 1) { setStep(previous => previous + 1); return }
        const completed = Object.fromEntries(questions.map(item => [item.id, answers[item.id] === '__custom__' ? custom[item.id]?.trim() ?? '' : answers[item.id]]))
        void submit({ answers: completed })
      }}>{submitting ? '正在提交…' : step === questions.length - 1 ? '提交回答' : '下一步'}</Button></div></footer>
    </div> : <>
      <div className="plan-review-body">
        {sections.length > 0 && <nav className="plan-contents" aria-label="计划目录"><span>目录</span>{sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.text}</a>)}</nav>}
        <main className="plan-review-content"><h1><ListTodo size={20} />{interaction.title}</h1><PlanContent tokens={tokens} /></main>
      </div>
      <div className="plan-review-footer">
        <label htmlFor="plan-feedback">修改意见</label>
        <Textarea id="plan-feedback" placeholder="告诉助手应该如何调整计划…" value={feedback} maxLength={8000} disabled={submitting} onChange={event => setFeedback(event.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <footer className="plan-dialog-actions"><Button className="plan-cancel" variant="ghost" onClick={onCancel} disabled={submitting}>停止计划</Button><div><Button className="plan-revise" variant="outline" disabled={!feedback.trim() || submitting} onClick={() => { void submit({ decision: 'revise', feedback }) }}>修改计划</Button>{modelPicker?.(submitting)}<Button className="plan-approve" disabled={submitting || modelSettingsBusy || !!feedback.trim()} onClick={() => { void submit({ decision: 'approve' }) }}><Check size={15} />批准计划并开始执行</Button></div></footer>
      </div>
    </>}
  </Modal>
}
