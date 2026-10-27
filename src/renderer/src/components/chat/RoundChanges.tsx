import { useId } from 'react'
import { Check, ChevronDown, ChevronRight, ChevronUp, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AgentSnapshot } from '../../../../shared/models'
import { RoundDiffDialog } from './RoundDiffDialog'
import { FileContextMenu } from './FileContextMenu'
import { baseName, fileIcon } from './DiffView'
import { PROJECT_FILES_RESTORED, type RoundFileState } from '../../hooks/useRoundFileState'
import type { RoundChangesData } from '../../hooks/useRoundChanges'
import { useTranscriptOverlay, useTranscriptState } from './TranscriptState'
import { TranscriptPagedList } from './TranscriptPagedList'

export function RoundChanges({ round, disabled, data, onRetry, fileState = data?.fileState ?? 'checking', beforeFileState = data?.beforeFileState ?? 'checking' }: { round: AgentSnapshot; disabled?: boolean; data?: RoundChangesData; onRetry?: () => void; fileState?: RoundFileState; beforeFileState?: RoundFileState }): React.JSX.Element | null {
  const files = data?.files
  const [expanded, setExpanded] = useTranscriptState('files-expanded', false)
  const [busy, setBusy] = useTranscriptState<'before' | 'after' | null>('restore-busy', null)
  const [error, setError] = useTranscriptState('restore-error', '')
  const [notice, setNotice] = useTranscriptState('restore-notice', '')
  const [lock] = useTranscriptState('restore-lock', () => ({ current: false }))
  const { showOverlay, overlay } = useTranscriptOverlay()
  const setReview = (selectedPath: string): void => {
    if (files) showOverlay(close => <RoundDiffDialog round={round} files={files} selectedPath={selectedPath} onClose={close} />)
  }
  const listId = useId()
  const restore = async (point: 'before' | 'after'): Promise<void> => {
    if (lock.current || disabled) return
    lock.current = true; setBusy(point); setError(''); setNotice('')
    try {
      await window.piRunner.restoreCheckpoint(round[point].hash, round.project)
      setNotice(point === 'before' ? '项目文件已还原到改前状态' : '项目文件已还原到改后状态')
      window.dispatchEvent(new CustomEvent(PROJECT_FILES_RESTORED, { detail: round.project }))
    } catch (e) { setError(e instanceof Error ? e.message : '文件恢复失败，请重试') }
    finally { lock.current = false; setBusy(null) }
  }
  // 未知是否有改动时不挂载占位卡片，空轮次读完后无需再移除整块内容。
  if (files?.length === 0 || !files && data?.status !== 'error') return null
  const additions = files?.reduce((sum, file) => sum + file.additions, 0) ?? 0
  const deletions = files?.reduce((sum, file) => sum + file.deletions, 0) ?? 0
  const hidden = files ? files.length - 3 : 0
  return <section className="round-changes" aria-label="本轮文件改动" aria-busy={Boolean(busy) || data?.status === 'loading'}>
    <header className="round-changes-header">
      <div className="round-changes-summary">
      {files ? <Tooltip><TooltipTrigger asChild><button type="button" className="round-changes-title" onClick={() => setReview('')}><span className="round-changes-title-text">已更改 {files.length} 个文件</span><ChevronRight className="round-changes-title-hint" size={14} aria-hidden="true" /></button></TooltipTrigger><TooltipContent>审查本轮 {files.length} 个文件的改动</TooltipContent></Tooltip> : <button type="button" className="round-changes-title" disabled>{data?.status === 'loading' ? '正在读取文件改动…' : data?.status === 'error' ? '文件改动读取失败' : '等待加载文件改动…'}</button>}
        {files && <span className="tool-approval-diffstat"><em>+{additions}</em>{deletions > 0 && <em className="is-del">-{deletions}</em>}</span>}
      </div>
      {files && <div className="round-changes-actions">{(['before', 'after'] as const).map(point => {
        const state = point === 'before' ? beforeFileState : fileState
        const label = point === 'before' ? '改前' : '改后'
        return <div key={point} className="round-changes-point" role="group" aria-label={`${label}文件状态`}>
          {state === 'matches'
            ? <Tooltip><TooltipTrigger asChild><span className="round-changes-current" role="status" aria-label={`${label}：文件已同步`}><Check size={14} aria-hidden="true" />文件已同步</span></TooltipTrigger><TooltipContent>项目文件与此轮{label}的状态一致</TooltipContent></Tooltip>
            : state === 'error'
              ? <Button variant="ghost" aria-label={`重新检查${label}文件状态`} disabled={disabled || Boolean(busy)} onClick={() => window.dispatchEvent(new CustomEvent(PROJECT_FILES_RESTORED, { detail: round.project }))}>状态检查失败，重试</Button>
              : <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={disabled || Boolean(busy) || state === 'checking' ? 0 : undefined}><Button variant="ghost" aria-label={`还原到${label}`} disabled={disabled || Boolean(busy) || state === 'checking'} onClick={() => void restore(point)}><RotateCcw size={14} aria-hidden="true" />{busy === point ? '正在还原…' : `还原到${label}`}</Button></span></TooltipTrigger><TooltipContent>{state === 'checking' ? `正在检查${label}文件状态…` : `把整个项目还原到此轮${label}的文件状态，包括后来新增和删除的文件`}</TooltipContent></Tooltip>}
        </div>
      })}</div>}
    </header>
    {files && <div id={listId} className="round-changes-list"><TranscriptPagedList items={expanded ? files : files.slice(0, 3)} label="本轮文件">{page => page.map(file => <FileContextMenu key={file.path} project={round.project} path={file.path}><button type="button" className="round-changes-file" onClick={() => setReview(file.path)} title={file.path}>{fileIcon(file.path)}<span className="tool-approval-file-meta"><strong title={baseName(file.path)}>{baseName(file.path)}</strong><small title={file.path}>{file.path}</small></span><span className="tool-approval-diffstat">{file.binary ? '二进制' : <><em>+{file.additions}</em>{file.deletions > 0 && <em className="is-del">-{file.deletions}</em>}</>}</span></button></FileContextMenu>)}</TranscriptPagedList></div>}
    {files && files.length > 3 && <Button className="round-changes-more" variant="ghost" aria-controls={listId} aria-expanded={expanded} aria-label={expanded ? '收起' : `更多（${hidden} 个文件）`} onClick={() => setExpanded(value => !value)}>{expanded ? <>收起 <ChevronUp size={14} aria-hidden="true" /></> : <>再显示 {hidden} 个文件 <ChevronDown size={14} aria-hidden="true" /></>}</Button>}
    {(error || data?.error) && <div className="round-changes-error" role="alert">{error || data?.error}{!files && onRetry && <Button variant="ghost" onClick={onRetry}>重试</Button>}</div>}
    {notice && <div className="round-changes-notice" role="status">{notice}</div>}
    {overlay}
  </section>
}
