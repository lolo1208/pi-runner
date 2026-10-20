import type { SandboxState } from '../../../shared/sandbox'

export function sameSandboxProject(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === right.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

/** 状态请求与推送可能乱序返回，旧响应不能覆盖已经收到的检查结果。 */
export function mergeSandboxState(current: SandboxState | null, incoming: SandboxState): SandboxState {
  if (!current || !sameSandboxProject(current.project, incoming.project)) return incoming
  if (incoming.updatedAt < current.updatedAt) return current
  if (incoming.phase === 'unconfigured' && current.phase !== 'unconfigured' && !incoming.operationId) return current
  if (current.operationId === incoming.operationId && (current.phase === 'ready' || current.phase === 'failed') && incoming.phase === 'running') return current
  return incoming
}
