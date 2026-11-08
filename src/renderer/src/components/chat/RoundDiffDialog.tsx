import { useEffect, useState } from 'react'
import { FileCode2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { baseName, DiffFileHeader, DiffStat, DiffView, DiffViewSwitch, fileIcon, initialDiffViewMode, type DiffViewMode } from './DiffView'
import type { ChangedFile, FileDiff } from '../../../../shared/api'
import type { AgentSnapshot } from '../../../../shared/models'
import { FileContextMenu } from './FileContextMenu'
import { PagedList } from '../PagedList'
import { FileChangeStatus } from './FileChangeStatus'

const STATUS_LABELS: Record<ChangedFile['status'], string> = { A: '新增文件', M: '修改文件', D: '删除文件' }

/** 单个文件的审查卡片：标题行显示文件与增删统计，展开时才按需读取并展示只读对比。 */
function FileReview({ round, file, mode, defaultExpanded }: { round: AgentSnapshot; file: ChangedFile; mode: DiffViewMode; defaultExpanded: boolean }): React.JSX.Element {
  const [diff, setDiff] = useState<FileDiff>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(defaultExpanded)
  useEffect(() => {
    // 折叠状态不读取；已读到的对比内容按快照缓存，重复展开不再请求
    if (!expanded || diff) return
    let active = true
    setError('')
    void window.piRunner.getDiff(round.before.hash, round.after.hash, file.path, round.project).then(value => { if (active) setDiff(value) }).catch(e => { if (active) setError(e instanceof Error ? e.message : '文件对比加载失败，请重试') })
    return () => { active = false }
  }, [round.before.hash, round.after.hash, round.project, file.path, retry, expanded, diff])
  return <section className={`tool-approval-file${expanded ? '' : ' is-collapsed'}`}>
    <FileContextMenu project={round.project} path={file.path}><DiffFileHeader
      icon={fileIcon(file.path)}
      name={baseName(file.path)}
      path={file.path}
      hidden={STATUS_LABELS[file.status]}
      expanded={expanded}
      onToggle={() => setExpanded(value => !value)}
      trailing={<>{file.binary ? <span className="tool-approval-binary">二进制</span> : <DiffStat additions={file.additions} deletions={file.deletions} />}<FileChangeStatus status={file.status} /></>}
    /></FileContextMenu>
    {expanded && <div className="tool-approval-file-body">
      {error
        ? <div className="tool-approval-preview-state" role="alert">{error}<Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>重试</Button></div>
        : !diff
          ? <div className="tool-approval-preview-state" role="status">正在加载修改对比…</div>
          : diff.binary
            ? <div className="tool-approval-preview-state">二进制文件不支持文本对比</div>
            : <DiffView before={diff.before} after={diff.after} mode={mode} path={file.path} hunks={diff.hunks} />}
    </div>}
  </section>
}

/** 本轮文件审查弹窗：统一 / 分栏切换；默认全部折叠，展开哪个文件才读取哪个文件的对比。 */
export function RoundDiffDialog({ round, files, selectedPath, onClose }: { round: AgentSnapshot; files: ChangedFile[]; selectedPath: string; onClose(): void }): React.JSX.Element {
  const [mode, setMode] = useState<DiffViewMode>(initialDiffViewMode)
  const visible = selectedPath ? files.filter(file => file.path === selectedPath) : files
  // 从单个文件入口打开时直接展开该文件；整轮审查时保持全部折叠，避免一次性加载所有对比
  return <Modal open onOpenChange={open => { if (!open) onClose() }} title={<span className="tool-approval-file-title"><FileCode2 size={18} aria-hidden="true" /><span>{visible.length} 个文件</span></span>} contentClassName="tool-approval-preview tool-approval-multi" headingExtra={<DiffViewSwitch mode={mode} onChange={setMode} />}>
    <div className="tool-approval-filelist"><PagedList items={visible} label="文件对比" resetKey={`${round.after.hash}:${selectedPath}`}>{page => page.map(file => <FileReview key={file.path} round={round} file={file} mode={mode} defaultExpanded={Boolean(selectedPath)} />)}</PagedList></div>
  </Modal>
}
