import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { ModelIcon } from './ModelIcon'
import type { ChatExecution } from '../../../../shared/models'

export function formatExecutionDuration(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)}分 ${seconds % 60}秒`
}

export function ExecutionLabel({ execution, startedAt, status, busy = false }: { execution?: ChatExecution; startedAt?: number; status?: string; busy?: boolean }): React.JSX.Element {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (startedAt === undefined) return
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  const elapsedMs = startedAt === undefined ? execution?.elapsedMs : now - startedAt
  return <strong className="chat-execution">{busy ? <LoaderCircle className="chat-execution-spinner" size={15} aria-label="对话进行中" /> : <ModelIcon model={execution?.model} provider={execution?.provider} />}<span className="chat-execution-model">{execution?.model || '模型未记录'}</span>
    {elapsedMs !== undefined && <span className="chat-execution-duration" aria-label={`${startedAt === undefined ? '执行耗时' : '已执行'} ${formatExecutionDuration(elapsedMs)}`}>· {formatExecutionDuration(elapsedMs)}</span>}
    {status && <span className="chat-execution-status" role="status">· {status}</span>}
  </strong>
}
