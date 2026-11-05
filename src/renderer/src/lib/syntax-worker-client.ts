import type { SyntaxResult, SyntaxSource } from './syntax-types'
import { WorkerTaskClient } from './worker-task-client'

const client = new WorkerTaskClient<SyntaxResult>(async () => {
  const { default: SyntaxWorker } = await import('./syntax.worker?worker')
  return new SyntaxWorker()
}, { maxCacheBytes: 16 * 1024 * 1024, maxCacheEntries: 64, sizeOf: value => JSON.stringify(value).length * 2, error: '代码着色暂不可用' })

/** 合并相同代码的计算，卸载视图只取消自己的订阅。 */
export function loadSyntax(source: SyntaxSource, signal?: AbortSignal): Promise<SyntaxResult> {
  return client.request(JSON.stringify(source), { source }, signal)
}
