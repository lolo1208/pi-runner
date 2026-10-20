/** 合并短时间内的更新；持续变化时也保证在最长等待时间内执行。 */
export class BufferedAction {
  private timer?: ReturnType<typeof setTimeout>
  private deadline?: ReturnType<typeof setTimeout>
  constructor(private readonly action: () => void, private readonly delay: number, private readonly maxWait: number) {}

  schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delay)
    this.deadline ??= setTimeout(() => this.flush(), this.maxWait)
  }

  flush(): void {
    const pending = this.timer !== undefined || this.deadline !== undefined
    this.cancel()
    if (pending) this.action()
  }

  cancel(): void {
    clearTimeout(this.timer)
    clearTimeout(this.deadline)
    this.timer = this.deadline = undefined
  }
}

/** 一次只保存一份快照；等待期间的新快照替换尚未开始的旧快照。 */
export class BufferedSave<T> {
  private pending?: T
  private running?: Promise<void>
  private readonly buffer: BufferedAction
  constructor(private readonly write: (value: T) => Promise<void>, onError: (error: unknown) => void) {
    this.buffer = new BufferedAction(() => { void this.flush().catch(onError) }, 300, 1000)
  }

  schedule(value: T): void {
    this.pending = value
    this.buffer.schedule()
  }

  async flush(): Promise<void> {
    this.buffer.cancel()
    if (this.running) {
      await this.running
      if (this.pending !== undefined) await this.flush()
      return
    }
    this.running = this.drain()
    try { await this.running }
    finally { this.running = undefined }
  }

  private async drain(): Promise<void> {
    while (this.pending !== undefined) {
      const value = this.pending
      this.pending = undefined
      try { await this.write(value) }
      catch (error) {
        // 保留失败的最新版本，允许下一次输入或退出时重新保存。
        this.pending ??= value
        throw error
      }
    }
  }
}

export const FLUSH_DRAFTS_EVENT = 'pi-runner:flush-drafts'
