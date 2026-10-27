import { useEffect, useRef, useState } from 'react'
import { GripVertical, Pencil, Trash2, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { QueuedMessage } from '../../../../shared/conversations'
import { PagedList } from '../PagedList'

export type { QueuedMessage } from '../../../../shared/conversations'
export interface MessageQueueProps {
  queue?: QueuedMessage[]
  editingId?: string | null
  queuePaused?: boolean
  onResumeQueue?: () => void
  onEditQueued?: (id: string) => void
  onDeleteQueued?: (id: string) => void
  onReorderQueued?: (id: string, targetId: string) => void
}

export function MessageQueue({ queue = [], editingId, queuePaused, onResumeQueue, onEditQueued, onDeleteQueued, onReorderQueued }: MessageQueueProps): React.JSX.Element | null {
  const dragging = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [selectedPage, setPage] = useState(0)
  const page = Math.min(selectedPage, Math.max(0, Math.ceil(queue.length / 40) - 1))
  const root = useRef<HTMLDivElement>(null)
  const moved = useRef<string | null>(null)
  useEffect(() => {
    if (!moved.current) return
    const handle = [...root.current?.querySelectorAll<HTMLElement>('.queue-handle') ?? []].find(element => element.dataset.queueId === moved.current)
    if (handle) { handle.focus({ preventScroll: true }); moved.current = null }
  }, [queue, page])
  if (!queue.length) return null
  return <div className="message-queue" ref={root}>
    {queuePaused && <div className="queue-edit-status" role="status"><span>队列已暂停，消息已保留</span><Button type="button" variant="ghost" size="sm" disabled={Boolean(editingId)} onClick={onResumeQueue}>继续执行</Button></div>}
    <PagedList items={queue} label="待发送消息" page={page} onPageChange={setPage}>{visible => <ol aria-label="待发送消息队列" start={page * 40 + 1}>
      {visible.map((item, offset) => { const index = page * 40 + offset; return <li key={item.id} className={`queue-item${editingId === item.id ? ' is-editing' : ''}${dropTarget === item.id ? ' is-drop-target' : ''}`} onDragOver={event => {
        if (!dragging.current) return
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget(item.id)
      }} onDrop={event => {
        if (!dragging.current) return
        event.preventDefault(); event.stopPropagation()
        onReorderQueued?.(dragging.current, item.id); dragging.current = null; setDropTarget(null)
      }}>
        <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" className="queue-handle" data-queue-id={item.id} draggable aria-label={`调整第 ${index + 1} 条消息顺序`} onDragStart={event => {
          dragging.current = item.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id)
        }} onDragEnd={() => { dragging.current = null; setDropTarget(null) }} onKeyDown={event => {
          const next = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault(); if (queue[next] && onReorderQueued) { moved.current = item.id; setPage(Math.floor(next / 40)); onReorderQueued(item.id, queue[next].id) }
        }}><GripVertical size={14} /></Button></TooltipTrigger><TooltipContent>拖动排序，也可用上下方向键调整</TooltipContent></Tooltip>
        <span className="queue-content" title={[item.content, ...(item.images ?? []).map(file => file.name)].filter(Boolean).join('\n')}>
          {item.content && <span>{item.content.replace(/\s+/g, ' ')}</span>}
          {item.images?.length ? <span className="queue-attachments"><Paperclip size={12} aria-hidden="true" />{item.images.map(file => file.name).join('、')}</span> : null}
        </span>
        <div className="queue-item-actions">
          <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={Boolean(editingId) || !onEditQueued ? 0 : undefined}><Button type="button" variant="ghost" aria-label={`编辑第 ${index + 1} 条队列消息`} disabled={Boolean(editingId) || !onEditQueued} onClick={() => onEditQueued?.(item.id)}><Pencil size={13} /></Button></span></TooltipTrigger><TooltipContent>编辑消息</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={!onDeleteQueued ? 0 : undefined}><Button type="button" variant="ghost" aria-label={`删除第 ${index + 1} 条队列消息`} disabled={!onDeleteQueued} onClick={() => onDeleteQueued?.(item.id)}><Trash2 size={13} /></Button></span></TooltipTrigger><TooltipContent>删除消息</TooltipContent></Tooltip>
        </div>
      </li> })}
    </ol>}</PagedList>
  </div>
}
