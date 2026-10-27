import { Button } from '@/components/ui/button'
import { Camera, Files, Globe, Terminal, X } from 'lucide-react'
import type { Checkpoint } from '../../../shared/api'
import { useEffect, useState } from 'react'

type ToolId = 'snapshots' | 'files' | 'terminal' | 'browser'

interface ToolSidebarProps {
  project: string | null
  isBusy: boolean
  activeTool: ToolId
  checkpoints: Checkpoint[]
  onToolChange: (tool: ToolId) => void
  onClose: () => void
}

const tools: { id: ToolId; label: string; icon: typeof Camera }[] = [
  { id: 'snapshots', label: '快照', icon: Camera },
  { id: 'files', label: '文件', icon: Files },
  { id: 'terminal', label: '终端', icon: Terminal },
  { id: 'browser', label: '浏览器', icon: Globe },
]

function PlaceholderTool({ tool }: { tool: Exclude<ToolId, 'snapshots'> }): React.JSX.Element {
  const placeholders = {
    files: { label: '文件浏览器', icon: Files },
    terminal: { label: '终端', icon: Terminal },
    browser: { label: '浏览器', icon: Globe },
  }
  const { label, icon: Icon } = placeholders[tool]

  return <div className="tool-placeholder">
    <Icon size={30} />
    <h3>{label}</h3>
    <span className="badge">待实现</span>
    <p>已纳入后续开发计划，完成后将在这里使用。</p>
  </div>
}

export function ToolSidebar({ project, isBusy, activeTool, checkpoints, onToolChange, onClose }: ToolSidebarProps): React.JSX.Element {
  const [history, setHistory] = useState<{ project: string; checkpoints: Checkpoint[] } | null>(null)
  const [historyError, setHistoryError] = useState('')
  useEffect(() => {
    setHistoryError('')
    if (!project || activeTool !== 'snapshots') return
    let active = true
    void window.piRunner.listCheckpoints(project).then(items => {
      if (active) setHistory({ project, checkpoints: items })
    }).catch(() => {
      if (active) setHistoryError('完整快照列表读取失败，请重新打开侧栏重试。')
    })
    return () => { active = false }
  }, [project, activeTool, checkpoints, isBusy])
  const sortedCheckpoints = [...new Map([
    ...(history?.project === project ? history.checkpoints : []), ...checkpoints
  ].map(checkpoint => [checkpoint.hash, checkpoint])).values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  return <section className="tool-sidebar" aria-label="侧栏工具">
    <header>
      <span>侧栏工具</span>
      <Button className="icon-button" aria-label="关闭工具栏" onClick={onClose}><X size={17} /></Button>
    </header>
    <nav className="tool-tabs" aria-label="工具选择">
      {tools.map(({ id, label, icon: Icon }) => <Button key={id} aria-pressed={activeTool === id} onClick={() => onToolChange(id)}><Icon size={16} />{label}</Button>)}
    </nav>
    {activeTool === 'snapshots' ? <div className="snapshot-panel">
      <div className="snapshot-summary">
        <h3>项目快照</h3>
        <p className="hint">{project ?? '打开项目后查看快照。'}</p>
        <h3>快照记录 <span className="muted">{sortedCheckpoints.length}</span></h3>
        {historyError && <p role="alert" className="error">{historyError}</p>}
        <ol className="checkpoint-list" aria-label="快照记录">
          {sortedCheckpoints.map(checkpoint => <li className="checkpoint" key={checkpoint.hash}>
            <span className="checkpoint-label">{checkpoint.label}</span>
            <div className="checkpoint-meta">
              {Number.isFinite(Date.parse(checkpoint.createdAt)) ? <time dateTime={checkpoint.createdAt}>{new Date(checkpoint.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time> : <span>创建时间未知</span>}
              <code title={checkpoint.hash}>{checkpoint.hash.slice(0, 8)}</code>
            </div>
          </li>)}
        </ol>
        {!sortedCheckpoints.length && <p className="hint">{project && history?.project !== project && !historyError ? '正在读取快照…' : '暂无快照'}</p>}
      </div>
    </div> : <PlaceholderTool tool={activeTool} />}
  </section>
}
