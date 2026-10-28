import { useEffect, useMemo, useState } from 'react'
import { FileCode2, LockKeyhole, ShieldQuestion, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { PagedList } from '../PagedList'
import { AiReviewBadge } from './AiReviewBadge'
import { baseName, DiffFileHeader, DiffStat, DiffView, DiffViewSwitch, fileIcon, initialDiffViewMode, type DiffViewMode } from './DiffView'
import { isCommandApproval, isFileChangeApproval } from '../../lib/tool-approval'
import type { ToolApproval, ToolApprovalPreview } from '../../../../shared/models'

function filePath(approval: ToolApproval): string { return typeof approval.args.path === 'string' ? approval.args.path : approval.cwd }
type PreviewLoader = (approval: ToolApproval, signal: AbortSignal) => Promise<ToolApprovalPreview>

/** 未开始的读取随卡片卸载取消，已开始的读取最多三个；翻页不会累积请求。 */
function previewLoader(getPreview: (approval: ToolApproval) => Promise<ToolApprovalPreview>): PreviewLoader {
  let running = 0
  const queue: (() => void)[] = []
  const pump = (): void => { while (running < 3 && queue.length) queue.shift()!() }
  return (approval, signal) => new Promise((resolve, reject) => {
    const abort = (): void => {
      const index = queue.indexOf(start)
      if (index >= 0) queue.splice(index, 1)
      reject(new Error('预览读取已取消'))
    }
    const start = (): void => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) { reject(new Error('预览读取已取消')); return }
      running++
      void Promise.resolve().then(() => getPreview(approval)).then(resolve, reject).finally(() => { running--; pump() })
    }
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    queue.push(start)
    pump()
  })
}

function ApprovalReview({ approval, mode, load }: { approval: ToolApproval; mode: DiffViewMode; load: PreviewLoader }): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [preview, setPreview] = useState<ToolApprovalPreview>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [stats, setStats] = useState<{ added: number; removed: number }>()
  const isFile = isFileChangeApproval(approval)
  const path = filePath(approval)
  useEffect(() => { setPreview(undefined); setStats(undefined); setError('') }, [approval, load])
  useEffect(() => {
    if (!isFile || !expanded || preview) return
    const controller = new AbortController()
    setError('')
    void load(approval, controller.signal).then(value => { if (!controller.signal.aborted) setPreview(value) }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '修改对比加载失败')
    })
    return () => controller.abort()
  }, [approval, isFile, expanded, preview, retry, load])
  return <section className={`tool-approval-file${expanded ? '' : ' is-collapsed'}`}>
    <DiffFileHeader icon={isFile ? fileIcon(path) : <Terminal size={15} aria-hidden="true" />} name={baseName(path)} path={path} expanded={expanded} onToggle={() => setExpanded(value => !value)} trailing={stats && <DiffStat additions={stats.added} deletions={stats.removed} />} />
    {expanded && <div className="tool-approval-file-body">
      {!isFile ? <pre className="tool-approval-operation">{typeof approval.args.command === 'string' ? approval.args.command : JSON.stringify(approval.args, null, 2)}</pre>
        : error ? <div className="tool-approval-preview-state" role="alert"><ShieldQuestion size={24} aria-hidden="true" /><p>{error}</p><Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>重试</Button></div>
          : !preview ? <div className="tool-approval-preview-state" role="status">正在加载修改对比…</div>
            : <DiffView before={preview.before} after={preview.after} mode={mode} path={preview.path} onStats={setStats} />}
    </div>}
  </section>
}

export function ToolApprovalDiffDialog({ open, onOpenChange, approvals, getPreview }: {
  open: boolean
  onOpenChange(open: boolean): void
  approvals: ToolApproval[]
  getPreview(approval: ToolApproval): Promise<ToolApprovalPreview>
}): React.JSX.Element {
  const [mode, setMode] = useState<DiffViewMode>(initialDiffViewMode)
  const load = useMemo(() => previewLoader(getPreview), [getPreview])
  // 终端命令有自己的审批弹窗，这里只保留文件改动和其他普通操作。
  const operations = approvals.filter(approval => !isCommandApproval(approval))
  const fileCount = operations.filter(isFileChangeApproval).length
  return <Modal open={open} onOpenChange={onOpenChange} title={<span className="tool-approval-file-title"><FileCode2 size={18} aria-hidden="true" /><span>{fileCount > 0 ? `${fileCount} 个文件` : '执行操作'}</span><AiReviewBadge show={operations.some(approval => approval.aiReviewed)} /></span>}
    description={<span>本次请求批准的操作共 {operations.length} 项，确认后将按权限执行</span>}
    headingExtra={<DiffViewSwitch mode={mode} onChange={setMode} />}
    contentClassName="tool-approval-preview tool-approval-multi">
    <div className="tool-approval-filelist">
      {operations.length === 0 && <div className="tool-approval-preview-state" role="status">没有待审批的文件操作</div>}
      <PagedList items={operations} label="待审批操作" pageSize={10}>{page => page.map(approval => <ApprovalReview key={approval.id} approval={approval} mode={mode} load={load} />)}</PagedList>
    </div>
    <footer className="tool-approval-preview-footer"><span className="tool-approval-readonly"><LockKeyhole size={12} aria-hidden="true" />只读预览</span><span className="tool-approval-reason">{operations[0]?.reason}</span></footer>
  </Modal>
}
