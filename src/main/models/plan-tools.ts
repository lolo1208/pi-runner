import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { PlanInteraction, PlanQuestion, PlanResponse } from '../../shared/models'
import { isCustomPlanOption } from '../../shared/models'
import { ModelError } from './model-validation'

export const PLAN_INSTRUCTION = '当前为计划模式。若用户只要求技能生成文字结果（例如 Git 提交信息、摘要或说明），无需制定实施计划，可以先读取必要内容和技能，完成结果并用 report_skill_usage 报告本轮用途后直接回复并结束；不要在交付最终结果后再发起需求确认或计划审阅。此例外不允许修改文件或执行终端命令；已经开始的计划问答仍需完成原有流程。其他任务每次开始本轮计划，都必须先调用 ask_user_question 弹出需求确认窗口，至少完成一轮用户回答；历史对话或旧计划的回答不能替代本轮确认。即使需求看似明确，也应针对本次目标、实施范围或验收方式提出具体选项，请用户确认。可先读取必要的项目内容，问题应结合用户任务，不要重复询问已知事实；有不确定事项时可继续多轮提问。每题提供推荐方案和其他具体方案，界面自动提供自定义回答入口。禁止文件修改、终端命令或其他有副作用的操作。本轮收到用户回答并确认需求后，必须调用 submit_plan 提交完整中文计划（目标、具体步骤、验证方法），等待审阅；不能仅输出文字就结束。修改意见需要融入新计划并再次提交。只有工具明确返回用户已批准，才进入执行模式并按已批准的计划实施。'
/** 计划模式的可执行文件工具；批量下载不得借内部单项调用绕过外层守卫。 */
export const PLAN_READ_TOOLS = ['read', 'read_many', 'ls', 'find', 'grep', 'stat'] as const

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], details: {} })
// SDK 接受标准 JSON Schema，模型参数也由 SDK 在执行前校验。
const schema = (properties: Record<string, unknown>, required: string[]): ToolDefinition['parameters'] => ({ type: 'object', properties, required, additionalProperties: false }) as ToolDefinition['parameters']

export function planTools(ask: (interaction: Omit<PlanInteraction, 'id'>, signal?: AbortSignal) => Promise<PlanResponse>, approve: (title: string, content: string) => void, isPlanning: () => boolean, hasAnswers: () => boolean): ToolDefinition[] {
  return [{
    name: 'ask_user_question', label: '澄清计划需求', description: '向用户弹出 1–3 个问题。每题提供 2–4 个具体方案，标记推荐项。界面自动提供“其他”选项供用户填写自己的回答，不要重复生成“其他”或自定义回答选项。等待回答后再继续，可多轮调用。', executionMode: 'sequential',
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
    name: 'submit_plan', label: '审阅计划', description: '提交最终中文计划（目标、步骤、验收方法）供批准。批准后自动执行；要求修改时继续沟通并再次提交。', executionMode: 'sequential',
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
