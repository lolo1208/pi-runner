import { lazy, Suspense, useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { ChevronRight, Columns2, List } from 'lucide-react'
export { fileIcon } from '../FileIcon'
import { Button } from '@/components/ui/button'
import type { CodeDiffProps } from '../../CodeDiff'

const CodeDiff = lazy(() => import('../../CodeDiff'))
export type DiffViewMode = 'unified' | 'split'

const DIFF_VIEW_MODE_KEY = 'pi-runner.diff-view-mode'

export function initialDiffViewMode(): DiffViewMode {
  try {
    const saved = localStorage.getItem(DIFF_VIEW_MODE_KEY)
    if (saved === 'unified' || saved === 'split') return saved
  } catch { /* 本地存储不可用时使用默认布局。 */ }
  return window.innerWidth < 760 ? 'unified' : 'split'
}

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** 三个对比入口共用只读视图；主题变化同步到库，布局之外使用库默认样式。 */
export function DiffView({ theme: explicitTheme, ...props }: Omit<CodeDiffProps, 'theme'> & { theme?: 'light' | 'dark' }): React.JSX.Element {
  const [theme, setTheme] = useState(currentTheme)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return <div className="tool-approval-diff" aria-label="文件对比">
    <Suspense fallback={<div className="tool-approval-preview-state" role="status">正在加载文件对比…</div>}>
      <CodeDiff {...props} theme={explicitTheme ?? theme} />
    </Suspense>
  </div>
}

export function DiffViewSwitch({ mode, onChange }: { mode: DiffViewMode; onChange(mode: DiffViewMode): void }): React.JSX.Element {
  const selectMode = (next: DiffViewMode): void => {
    try { localStorage.setItem(DIFF_VIEW_MODE_KEY, next) } catch { /* 本地存储不可用时保留当前选择。 */ }
    onChange(next)
  }
  return <div className="tool-approval-view-switch" role="group" aria-label="对比视图">
    <Button type="button" variant="ghost" aria-pressed={mode === 'unified'} onClick={() => selectMode('unified')}><List size={14} aria-hidden="true" />统一</Button>
    <Button type="button" variant="ghost" aria-pressed={mode === 'split'} onClick={() => selectMode('split')}><Columns2 size={14} aria-hidden="true" />分栏</Button>
  </div>
}

/** 新增 / 删除行数统计。 */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }): React.JSX.Element {
  return <span className="tool-approval-diffstat"><em>+{additions}</em><em className="is-del">-{deletions}</em></span>
}

/** 文件卡片标题行：折叠箭头、文件图标、文件名与路径、右侧统计。 */
export function DiffFileHeader({ icon, name, path, expanded, onToggle, trailing, hidden, ...buttonProps }: {
  icon: ReactNode
  name: string
  path: string
  expanded: boolean
  onToggle(): void
  trailing?: ReactNode
  hidden?: string
} & Omit<ComponentProps<'button'>, 'hidden'>): React.JSX.Element {
  return <button type="button" className="tool-approval-file-header" aria-expanded={expanded} onClick={onToggle} {...buttonProps}>
    <ChevronRight size={14} className="tool-approval-file-chevron" aria-hidden="true" />
    {icon}
    <span className="tool-approval-file-meta"><strong title={name}>{name}</strong><small title={path}>{path}</small></span>
    {hidden && <span className="sr-only">{hidden}</span>}
    {trailing}
  </button>
}

/** 取路径最后一段作为文件名。 */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
