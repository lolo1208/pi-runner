interface Subscriber<T> { resolve(value: T): void; reject(error: Error): void; detach(): void }
interface Job<T> { id: number; key: string; payload: object; bytes: number; subscribers: Set<Subscriber<T>> }

/** 有界、单任务 Worker 队列；最后一个视图离开时移除任务，避免切换会话积压正文副本。 */
export class WorkerTaskClient<T> {
  private worker?: Worker
  private jobs = new Map<string, Job<T>>()
  private running?: Job<T>
  private timer?: ReturnType<typeof setTimeout>
  private nextId = 0
  private pendingBytes = 0
  private cache = new Map<string, { value: T; bytes: number }>()
  private cacheBytes = 0

  constructor(private readonly createWorker: () => Promise<Worker>, private readonly options: {
    maxCacheBytes: number; maxCacheEntries: number; sizeOf(value: T): number; error: string
  }) {}

  request(key: string, payload: object, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException('视图已关闭', 'AbortError'))
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached)
      return Promise.resolve(cached.value)
    }
    let job = this.jobs.get(key)
    if (!job) {
      const bytes = key.length * 2
      // 除结果缓存外，也限制尚未完成的输入，拒绝时由视图回退到原文或重试。
      if (this.jobs.size >= 32 || this.pendingBytes + bytes > 32 * 1024 * 1024) return Promise.reject(new Error('后台处理队列已满，请稍后重试'))
      job = { id: ++this.nextId, key, payload, bytes, subscribers: new Set() }
      this.jobs.set(key, job); this.pendingBytes += bytes
    }
    const target = job
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => {
        target.subscribers.delete(subscriber)
        subscriber.detach()
        reject(new DOMException('视图已关闭', 'AbortError'))
        if (!target.subscribers.size) {
          this.remove(target)
          if (this.running === target) { this.resetWorker(); this.running = undefined }
          this.pump()
        }
      }
      const subscriber: Subscriber<T> = { resolve, reject, detach: () => signal?.removeEventListener('abort', abort) }
      target.subscribers.add(subscriber)
      signal?.addEventListener('abort', abort, { once: true })
      this.pump()
    })
  }

  private remove(job: Job<T>): void {
    if (this.jobs.get(job.key) !== job) return
    this.jobs.delete(job.key); this.pendingBytes -= job.bytes
  }

  private resetWorker(): void {
    clearTimeout(this.timer); this.timer = undefined
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null
      this.worker.terminate(); this.worker = undefined
    }
  }

  private finish(job: Job<T>, value?: T, error?: Error): void {
    if (this.running !== job) return
    clearTimeout(this.timer); this.timer = undefined
    this.running = undefined
    if (this.worker) this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null
    this.remove(job)
    if (!error && value !== undefined) {
      let bytes = Infinity
      try { bytes = job.bytes + this.options.sizeOf(value) } catch { /* 无法估算时只交付结果，不缓存。 */ }
      if (bytes <= this.options.maxCacheBytes) {
        while (this.cache.size >= this.options.maxCacheEntries || this.cacheBytes + bytes > this.options.maxCacheBytes) {
          const oldest = this.cache.keys().next().value!
          this.cacheBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest)
        }
        this.cache.set(job.key, { value, bytes }); this.cacheBytes += bytes
      }
    }
    for (const subscriber of job.subscribers) {
      subscriber.detach()
      if (error) subscriber.reject(error)
      else subscriber.resolve(value!)
    }
    job.subscribers.clear()
    this.pump()
  }

  private pump(): void {
    if (this.running) return
    const job = this.jobs.values().next().value as Job<T> | undefined
    if (!job) return
    this.running = job
    const fail = (): void => {
      if (this.running !== job) return
      this.resetWorker()
      this.finish(job, undefined, new Error(this.options.error))
    }
    this.timer = setTimeout(fail, 15000)
    void (async () => {
      try {
        const worker = this.worker ?? await this.createWorker()
        // 动态导入尚未完成时也可能取消，迟到的 Worker 必须立即终止。
        if (this.running !== job) { if (worker !== this.worker) worker.terminate(); return }
        this.worker = worker
        worker.onmessage = (event: MessageEvent<{ id: number; result?: T; error?: string }>) => {
          if (event.data.id !== job.id || this.running !== job) return
          try {
            this.finish(job, event.data.result, event.data.error || event.data.result === undefined ? new Error(event.data.error ?? this.options.error) : undefined)
          } catch { fail() }
        }
        worker.onerror = fail
        worker.onmessageerror = fail
        worker.postMessage({ ...job.payload, id: job.id })
      } catch { fail() }
    })()
  }
}
