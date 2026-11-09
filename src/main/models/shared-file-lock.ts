import { mkdir, open, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** 正常持锁操作最长约 30 秒（OAuth 网络超时），超过该时长仍未释放的锁视为程序异常退出遗留。 */
const staleLockMs = 60_000

/** 删除残留锁。返回 true 表示锁已不存在（已删除或被他人释放），可以立即重试获取。 */
async function clearStaleLock(lock: string): Promise<boolean> {
  try {
    const info = await stat(lock)
    if (Date.now() - info.mtimeMs < staleLockMs) return false
    await unlink(lock)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

/** 锁住整个读取—修改—替换操作，包括 OAuth 网络刷新。仅自动清理明显过期的残留锁，正在使用中的锁不强夺。 */
export async function withSharedFileLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(file), { recursive: true })
  const lock = `${file}.lock`
  const deadline = Date.now() + 30_000
  let handle
  while (!handle) {
    try { handle = await open(lock, 'wx', 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await clearStaleLock(lock)) continue
      if (Date.now() >= deadline) throw new Error('共享模型配置或授权正在使用中，请稍后重试；若问题持续，请重启应用')
      await delay(25)
    }
  }
  try { return await action() }
  finally {
    await handle.close()
    await unlink(lock).catch(() => undefined)
  }
}
