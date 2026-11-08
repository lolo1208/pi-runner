import { SquareDot, SquareMinus, SquarePlus } from 'lucide-react'
import type { ChangedFile } from '../../../../shared/api'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const statuses = {
  A: { label: '新增文件', icon: SquarePlus, color: 'var(--diff-add)' },
  D: { label: '删除文件', icon: SquareMinus, color: 'var(--diff-del)' },
  M: { label: '修改文件', icon: SquareDot, color: 'var(--warning)' }
} as const

/** 使用文件状态而非增删行数，区分新增、删除和修改。 */
export function FileChangeStatus({ status }: { status: ChangedFile['status'] }): React.JSX.Element {
  const { label, icon: Icon, color } = statuses[status]
  return <Tooltip><TooltipTrigger asChild><span role="img" aria-label={label} style={{ display: 'inline-flex', flexShrink: 0, color }}><Icon size={14} strokeWidth={1.5} aria-hidden="true" /></span></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}
