import type { SandboxState } from '../../../../shared/sandbox'
import { SANDBOX_CHECKS, SANDBOX_MESSAGES } from '../../../../shared/sandbox'
import { Button } from '../ui/button'

const progress: Record<string, string> = Object.fromEntries(Object.entries(SANDBOX_CHECKS).map(([id, step]) => [id, step.progress]))

/** 仅在任务检查过程中或存在失败、能力限制时显示，日常浏览保持安静。 */
export function SandboxStatus({ state, onInspect, visible = true, taskRunning = false }: { state: SandboxState | null; onInspect(): void; visible?: boolean; taskRunning?: boolean }): React.JSX.Element | null {
  const limited = state?.phase === 'ready' && state.developerNetwork === false
  const attention = state?.phase === 'ready' && (limited || Boolean(state.warning))
  const step = state?.steps.find(item => item.status === 'running')
  const failed = state?.phase === 'failed' || attention
  const checking = taskRunning && (state?.phase === 'running' || Boolean(step))
  if (!visible || !state || (!failed && !checking)) return null
  return <div className="sandbox-entry">
    {failed
      ? <Button variant="ghost" size="sm" onClick={onInspect}>{limited ? '文件隔离可用，查看开发能力限制' : attention ? '隔离可用，查看待处理问题' : SANDBOX_MESSAGES.inspect}</Button>
      : <span role="status" aria-live="polite">{step ? progress[step.id] ?? state.message : SANDBOX_MESSAGES.progress}</span>}
  </div>
}
