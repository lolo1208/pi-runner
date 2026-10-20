import type { OllamaCallInfo } from './pi-ollama'

/**
 * 空正文兜底提示：把结束原因和本地推理参数一并带出，
 * 否则只剩「请重试」，无法区分截断、额度用尽还是模型空响应。
 */
export function emptyReplyMessage(final: { stopReason?: string; usage?: { output?: number } }, ollama?: OllamaCallInfo): string {
  const facts = [`stopReason=${final.stopReason ?? '未知'}`, `本次生成 ${final.usage?.output ?? 0} Token`]
  if (ollama) facts.push(`done_reason=${ollama.doneReason || '未提供'}`, `num_ctx=${ollama.numCtx}`, `num_predict=${ollama.numPredict}`)
  const detail = `（${facts.join('，')}）`
  if (ollama?.outputLimitReached) return `模型在生成正文前用完了本次输出额度${detail}。Ollama 的 num_predict 同时计入思考与正文，请提高“输出 Token 上限”、降低推理强度或拆分任务后重试`
  if (ollama) return `模型已结束响应，但未返回正文${detail}。本地 Ollama 在输入超过 num_ctx 时会静默截断，请提高“上下文上限”、降低推理强度或缩短输入后重试`
  return `模型已结束响应，但未返回正文${detail}。请重试，或切换模型及服务节点；本次未报告达到输出 Token 上限`
}
