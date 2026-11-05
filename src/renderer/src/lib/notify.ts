import { toast } from 'sonner'

/** 空文本只表示清理旧的内联状态，不生成通知。 */
export function notify(message: string): void {
  if (message) toast.success(message)
}

/** 各供应商共用的模型目录反馈，空目录不误报为成功。 */
export function notifyModelCatalog(provider: string, count: number, emptyHint: string): void {
  if (count > 0) toast.success(`${provider} 模型列表已更新`, { description: `共 ${count} 个模型，可在列表中启用需要的模型。` })
  else toast.warning(`${provider} 未发现可用模型`, { description: emptyHint, duration: 8000 })
}
