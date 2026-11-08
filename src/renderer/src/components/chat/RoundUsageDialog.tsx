import '../../styles/round-usage-table.css'
import { Modal } from '@/components/ui/modal'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ModelReply } from '../../../../shared/models'
import { ModelIcon } from './ModelIcon'

const purposeName = { 'context-summary': '上下文摘要', 'permission-review': '权限审核' } as const

const count = (value?: number): string => value === undefined ? '—' : value.toLocaleString('zh-CN')
const status = { completed: '完成', error: '失败', aborted: '已中断', truncated: '达到输出上限' } as const

export function RoundUsageDialog({ reply, onClose }: { reply: ModelReply; onClose(): void }): React.JSX.Element {
  const calls = reply.calls ?? []
  return <Modal open onOpenChange={open => { if (!open) onClose() }} title={<span className="round-usage-title">模型调用明细 <span className="round-usage-title-meta"><span className="model-name-with-icon"><span aria-hidden="true"><ModelIcon model={reply.model} /></span><span>{reply.model}</span></span> · {calls.length} 次调用</span></span>} contentClassName="round-usage-dialog" closeOnBackdropClick>
    <div className="round-usage-scroll">
    {calls.length ? <Table className="round-usage-table"><TableHeader><TableRow>{['调用', '状态', '输入', '输出', '缓存读取', '缓存写入', '命中率', '耗时'].map(label => <TableHead key={label} scope="col">{label}</TableHead>)}</TableRow></TableHeader><TableBody>{calls.map((call, index) => {
      const usage = call.usage
      const hit = usage && call.usageFields?.input !== false && call.usageFields?.cacheRead !== false && usage.cacheReadTokens !== undefined && usage.inputTokens > 0 && usage.cacheReadTokens <= usage.inputTokens ? `${Number((usage.cacheReadTokens / usage.inputTokens * 100).toFixed(1))}%` : '—'
      const cacheReasons = [...(call.cacheNotes ?? []), ...(index === 0 && hit === '0%' ? ['可能切换模型'] : [])]
      const cacheNote = cacheReasons.length ? `缓存变化：${cacheReasons.join('、')}` : ''
      return <TableRow key={index}>
        <TableCell><strong># {index + 1}</strong>{cacheNote ? <span className="round-usage-cache-note" title={cacheNote}>{cacheNote}</span> : null}</TableCell>
        <TableCell>{status[call.status]}</TableCell>
        <TableCell>{call.usageFields && (!call.usageFields.input || !call.usageFields.cacheRead || !call.usageFields.cacheWrite) ? '—' : count(usage?.inputTokens)}</TableCell>
        <TableCell>{call.usageFields?.output === false ? '—' : count(usage?.outputTokens)}</TableCell>
        <TableCell>{call.usageFields?.cacheRead === false ? '—' : count(usage?.cacheReadTokens)}</TableCell>
        <TableCell>{call.usageFields?.cacheWrite === false ? '—' : count(usage?.cacheWriteTokens)}</TableCell>
        <TableCell>{hit}</TableCell>
        <TableCell>{(call.elapsedMs / 1000).toFixed(1)} 秒</TableCell>
      </TableRow>
    })}</TableBody></Table> : <p className="round-usage-empty">此轮没有保存逐次调用明细。完成新一轮回复后可查看。</p>}
    {reply.auxiliaryCalls?.length ? <section className="round-usage-auxiliary" aria-label="辅助模型调用"><h3>辅助调用</h3>
      <Table className="round-usage-table"><TableHeader><TableRow>{['用途', '模型', '状态', '输入', '输出', '缓存读取', '缓存写入', '耗时'].map(label => <TableHead key={label} scope="col">{label}</TableHead>)}</TableRow></TableHeader><TableBody>{reply.auxiliaryCalls.map((call, index) => <TableRow key={`${call.purpose}-${index}`}>
        <TableCell><strong>{purposeName[call.purpose]}</strong></TableCell>
        <TableCell>{call.model}</TableCell>
        <TableCell>{call.status === 'completed' ? '完成' : call.status === 'aborted' ? '已中断' : '失败'}</TableCell>
        <TableCell>{call.usageFields?.input === false ? '—' : count(call.usage?.inputTokens)}</TableCell>
        <TableCell>{call.usageFields?.output === false ? '—' : count(call.usage?.outputTokens)}</TableCell>
        <TableCell>{call.usageFields?.cacheRead === false ? '—' : count(call.usage?.cacheReadTokens)}</TableCell>
        <TableCell>{call.usageFields?.cacheWrite === false ? '—' : count(call.usage?.cacheWriteTokens)}</TableCell>
        <TableCell>{(call.elapsedMs / 1000).toFixed(1)} 秒</TableCell>
      </TableRow>)}</TableBody></Table>
    </section> : null}
    </div>
  </Modal>
}
