import { mkdir, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** 锁住整个读取—修改—替换操作，包括 OAuth 网络刷新。超时不强夺锁。 */
export async function withSharedFileLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(file), { recursive: true })
  const lock = `${file}.lock`
  const deadline = Date.now() + 30_000
  let handle
  while (!handle) {
    try { handle = await open(lock, 'wx', 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() >= deadline) throw new Error('共享模型配置或授权正在使用中；若程序异常退出，请关闭两个版本并检查对应 .lock 文件后重试')
      await delay(25)
    }
  }
  try { return await action() }
  finally { await handle.close(); await unlink(lock) }
}
