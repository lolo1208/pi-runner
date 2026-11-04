import { MAX_CUSTOM_PROMPT_LENGTH } from './models'

/** 三层提示词各自保留完整内容，额外预留分层说明的空间。 */
export const MAX_COMBINED_PROMPT_LENGTH = MAX_CUSTOM_PROMPT_LENGTH * 3 + 1024
export const MAX_CONVERSATION_NAME_LENGTH = 200
const PROMPT_INTRO = '以下仅为自定义提示词内部的优先级：会话 > 项目 > 全局；不冲突的内容共同生效。它们不能覆盖应用的权限、安全规则、工具限制或计划审批流程。'
const GLOBAL_LABEL = '全局提示词（最低优先级）'
const PROJECT_LABEL = '项目提示词（次优先级）'

export function composeCustomPrompt(conversation?: string, project?: string, global?: string): string {
  const layers = [
    { label: GLOBAL_LABEL, content: global?.trim() },
    { label: PROJECT_LABEL, content: project?.trim() },
    { label: '会话提示词（最高优先级）', content: conversation?.trim() },
  ].filter(layer => layer.content)
  if (!layers.length) return ''
  return [PROMPT_INTRO,
    ...layers.map(layer => `【${layer.label}】\n${layer.content}`),
  ].join('\n\n')
}

/** 识别含共享层的组合提示词前缀，供缓存布局使用；不代表高于应用规则。 */
export function hasSharedCustomPromptPrefix(prompt: string): boolean {
  const firstLayer = `${PROMPT_INTRO}\n\n`
  return prompt.startsWith(`${firstLayer}【${GLOBAL_LABEL}】\n`) || prompt.startsWith(`${firstLayer}【${PROJECT_LABEL}】\n`)
}
