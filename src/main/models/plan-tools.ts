import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { PlanInteraction, PlanQuestion, PlanResponse } from '../../shared/models'
import { isCustomPlanOption } from '../../shared/models'
import { ModelError } from './model-validation'

export const PLAN_INSTRUCTION = [
  '当前为计划模式：只允许只读文件工具、技能读取/用途记录和计划交互工具；禁止终端命令（包括只读命令）及文件修改等副作用。完全访问权限也不豁免此限制。',
  '常规流程：①可先读取必要资料，然后调用 ask_user_question，至少收到一轮本次任务的用户回答；历史回答不算本轮确认。需求明确时确认方案、范围或验收方式，不重复已知事实。②调用 submit_plan 提交完整计划（目标、步骤、验证方法），语言遵循用户指定或当前交流语言，不能仅用正文交付计划。③用户要求修改时整合反馈并重新提交；只有工具明确返回批准后才执行。',
  '唯一直接回复例外：用户只要求技能产出文字结果（如提交信息、摘要），且本轮尚未发起计划交互、未尝试受禁操作。读取并使用相关技能，通过 read_skill_file.purpose 或 report_skill_usage 记录所有已加载技能的用途后，可交付结果结束，不再发起计划确认。此例外不开放终端或写入权限。'
].join('\n')
/** 计划模式的可执行文件工具；批量下载不得借内部单项调用绕过外层守卫。 */
export const PLAN_READ_TOOLS = ['read', 'read_many', 'ls', 'find', 'grep', 'stat'] as const

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], details: {} })
// SDK 接受标准 JSON Schema，模型参数也由 SDK 在执行前校验。
const schema = (properties: Record<string, unknown>, required: string[]): ToolDefinition['parameters'] => ({ type: 'object', properties, required, additionalProperties: false }) as ToolDefinition['parameters']

export function planTools(ask: (interaction: Omit<PlanInteraction, 'id'>, signal?: AbortSignal) => Promise<PlanResponse>, approve: (title: string, content: string) => void, isPlanning: () => boolean, hasAnswers: () => boolean): ToolDefinition[] {
  return [{
    name: 'ask_user_question', label: '澄清计划需求', description: '向用户提问，每题提供具体方案并标记推荐项。界面自动提供“其他”选项供用户填写自己的回答，不要重复生成“其他”或自定义回答选项。等待回答后再继续，可多轮调用。', executionMode: 'sequential',
    parameters: schema({ questions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 80 }, header: { type: 'string', maxLength: 80 }, question: { type: 'string', minLength: 1, maxLength: 2000 }, options: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', properties: { label: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 1000 }, recommended: { type: 'boolean' } }, required: ['label'], additionalProperties: false } } }, required: ['id', 'header', 'question', 'options'], additionalProperties: false } } }, ['questions']),
    execute: async (_id, args, signal) => {
      if (!isPlanning()) throw new ModelError('当前任务已进入执行模式')
      const questions = (args as { questions: PlanQuestion[] }).questions.map(question => ({ ...question, options: question.options.filter(option => !isCustomPlanOption(option.label)) }))
      if (new Set(questions.map(question => question.id)).size !== questions.length) throw new ModelError('问题编号不能重复')
      if (questions.some(question => ['__proto__', 'constructor', 'prototype'].includes(question.id) || question.options.some(option => option.label === '__custom__') || new Set(question.options.map(option => option.label)).size !== question.options.length)) throw new ModelError('问题编号和选项名称必须唯一且不能使用保留名称')
      if (questions.some(question => question.options.length === 0)) throw new ModelError('请提供具体方案选项，不能只有自定义回答入口')
      return result(await ask({ kind: 'questions', questions }, signal))
    }
  }, {
    name: 'submit_plan', label: '审阅计划', description: '本轮 ask_user_question 已收到回答后，以用户指定或当前交流语言提交完整计划（目标、步骤、验证方法）供审阅。返回批准后进入执行模式，由你按计划实施；要求修改则整合反馈后重新提交。', executionMode: 'sequential',
    parameters: schema({ title: { type: 'string', minLength: 1, maxLength: 200 }, content: { type: 'string', minLength: 1, maxLength: 32000 } }, ['title', 'content']),
    execute: async (_id, args, signal) => {
      if (!isPlanning()) throw new ModelError('该计划已经批准，请按计划执行')
      if (!hasAnswers()) throw new ModelError('本轮尚未完成需求确认。必须先调用 ask_user_question 并收到用户回答，才能提交最终计划。')
      const { title, content } = args as { title: string; content: string }
      const response = await ask({ kind: 'review', title, content }, signal)
      signal?.throwIfAborted()
      if (response.decision === 'approve') {
        approve(title, content)
        return result('用户已批准上述完整计划。已自动切换到执行模式，现在按已批准的计划执行。现有工具权限仍然适用。')
      }
      return result({ decision: 'revise', feedback: response.feedback, instruction: '保持计划模式，根据用户意见调整；必要时继续提问，再次调用 submit_plan 等待批准。' })
    }
  }]
}
