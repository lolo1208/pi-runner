import { Button } from '@/components/ui/button'
import { Copy, Minus, Square, X } from 'lucide-react'

interface WindowTitleBarProps {
  pageTitle: string
  projectName: string | null
  isMaximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export function WindowTitleBar({ pageTitle, projectName, isMaximized, onMinimize, onToggleMaximize, onClose }: WindowTitleBarProps): React.JSX.Element {
  return <div className="window-titlebar">
    <div className="window-titlebar-drag" onDoubleClick={onToggleMaximize}>
      <div className="window-brand">
        <img className="window-app-mark" src="./icons/app-icon.png" alt="" draggable={false} />
        <span className="window-app-name">Pi Runner · 行动派</span>
      </div>
      <div className="window-context-title" title={projectName ? `${pageTitle} · ${projectName}` : pageTitle}>
        <span className="window-page-title">{pageTitle}</span>
        {projectName && <span className="window-project-title"> · {projectName}</span>}
      </div>
    </div>
    <div className="window-controls">
      <Button aria-label="最小化" onClick={onMinimize}><Minus size={15} /></Button>
      <Button aria-label={isMaximized ? '还原' : '最大化'} onClick={onToggleMaximize}>{isMaximized ? <Copy size={13} /> : <Square size={13} />}</Button>
      <Button className="window-close" aria-label="关闭" onClick={onClose}><X size={15} /></Button>
    </div>
  </div>
}
