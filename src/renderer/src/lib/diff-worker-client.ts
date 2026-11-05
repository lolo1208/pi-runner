import DiffWorker from './diff.worker?worker'
import type { DiffSource, PreparedDiff } from './diff-processing'
import { WorkerTaskClient } from './worker-task-client'

const client = new WorkerTaskClient<PreparedDiff>(async () => new DiffWorker(), {
  maxCacheBytes: 24 * 1024 * 1024, maxCacheEntries: 16, sizeOf: value => value.estimatedBytes, error: '文件对比处理失败，请重试'
})

/** 缓存有界，过时视图不再复制完整差异；可变的行状态仍由各视图独占。 */
export function loadPreparedDiff(source: DiffSource, theme: 'light' | 'dark', signal?: AbortSignal): Promise<PreparedDiff> {
  const key = JSON.stringify([theme, source.path, source.before, source.after, source.hunks])
  return client.request(key, { source, theme }, signal).then(value => {
    if (signal?.aborted) throw new DOMException('视图已关闭', 'AbortError')
    return structuredClone(value)
  })
}
