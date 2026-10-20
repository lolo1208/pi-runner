import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '../shared/api'

/** 只接受目标窗口对本次请求的回应，避免通知窗口或旧页面提前放行退出。 */
export function flushRendererConversations(contents: WebContents): Promise<void> {
  return new Promise((resolve, reject) => {
    const token = randomUUID()
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      ipcMain.removeListener(IPC_CHANNELS.conversationsFlushed, onReply)
      contents.removeListener('destroyed', onDestroyed)
      if (error) reject(error)
      else resolve()
    }
    const onReply = (event: IpcMainEvent, received: unknown, ok: unknown): void => {
      if (event.sender !== contents || event.senderFrame !== contents.mainFrame || received !== token) return
      finish(ok === true ? undefined : new Error('会话保存失败，请检查磁盘空间和访问权限后重试退出。'))
    }
    const onDestroyed = (): void => finish(new Error('会话窗口已关闭，无法确认草稿保存结果。'))
    const timer = setTimeout(() => finish(new Error('等待会话保存超时，应用已保留，请稍后重试退出。')), 10000)
    ipcMain.on(IPC_CHANNELS.conversationsFlushed, onReply)
    contents.once('destroyed', onDestroyed)
    try { contents.send(IPC_CHANNELS.conversationsFlush, token) }
    catch { finish(new Error('无法请求保存会话，请稍后重试退出。')) }
  })
}
