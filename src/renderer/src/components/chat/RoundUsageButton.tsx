import { useState } from 'react'
import { ChartNoAxesColumn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ChatExecution, ModelReply } from '../../../../shared/models'
import { RoundUsageDialog } from './RoundUsageDialog'

export function RoundUsageButton({ execution }: { execution: ChatExecution }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const reply: ModelReply = {
    ...execution.roundStatistics,
    text: '',
    model: execution.model,
    elapsedMs: execution.elapsedMs ?? 0,
    truncated: execution.roundStatistics?.truncated ?? false,
    auxiliaryCalls: execution.auxiliaryCalls
  }
  return <>
    <Tooltip><TooltipTrigger asChild><span className="inline-flex">
      <Button type="button" variant="ghost" size="icon" className="message-copy" aria-label="查看调用明细" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <ChartNoAxesColumn size={14} aria-hidden="true" />
      </Button>
    </span></TooltipTrigger><TooltipContent>查看调用明细</TooltipContent></Tooltip>
    {open && <RoundUsageDialog reply={reply} onClose={() => setOpen(false)} />}
  </>
}
