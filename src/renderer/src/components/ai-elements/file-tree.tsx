// 基于 AI SDK Elements 的 File Tree，适配项目现有的 Radix 与主题。
import { Collapsible } from 'radix-ui'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import { createContext, useContext, useState, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type TreeContext = { expanded: Set<string>; toggle: (path: string) => void; selectedPath?: string; onSelect?: (path: string) => void }
const Context = createContext<TreeContext>({ expanded: new Set(), toggle: () => {} })

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> & { expanded?: Set<string>; defaultExpanded?: Set<string>; selectedPath?: string; onSelect?: (path: string) => void; onExpandedChange?: (expanded: Set<string>) => void }
export function FileTree({ expanded, defaultExpanded, selectedPath, onSelect, onExpandedChange, className, children, ...props }: FileTreeProps): React.JSX.Element {
  const [internal, setInternal] = useState(defaultExpanded ?? new Set<string>())
  const paths = expanded ?? internal
  const toggle = (path: string): void => {
    const next = new Set(paths)
    if (next.has(path)) next.delete(path); else next.add(path)
    setInternal(next); onExpandedChange?.(next)
  }
  return <Context.Provider value={{ expanded: paths, toggle, selectedPath, onSelect }}><div role="tree" className={cn('ai-file-tree', className)} {...props}>{children}</div></Context.Provider>
}

export function FileTreeIcon({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element { return <span className={cn('ai-file-tree-icon', className)} {...props} /> }
export function FileTreeName({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element { return <span className={cn('ai-file-tree-name', className)} {...props} /> }
export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & { path: string; name: string; trigger?: (child: React.ReactElement) => React.ReactNode }
export function FileTreeFolder({ path, name, children, className, trigger, ...props }: FileTreeFolderProps): React.JSX.Element {
  const { expanded, toggle, selectedPath, onSelect } = useContext(Context)
  const open = expanded.has(path)
  const row = <Collapsible.Trigger asChild><button type="button" className="ai-file-tree-row" title={path} onClick={() => onSelect?.(path)}><ChevronRight size={16} className={cn('ai-file-tree-chevron', open && 'is-open')} /><FileTreeIcon>{open ? <FolderOpen size={16} /> : <Folder size={16} />}</FileTreeIcon><FileTreeName>{name}</FileTreeName></button></Collapsible.Trigger>
  return <Collapsible.Root open={open} onOpenChange={() => toggle(path)} asChild><div role="treeitem" aria-expanded={open} aria-selected={selectedPath === path} className={className} {...props}>{trigger ? trigger(row) : row}<Collapsible.Content><div role="group" className="ai-file-tree-children">{children}</div></Collapsible.Content></div></Collapsible.Root>
}
export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & { path: string; name: string; icon?: ReactNode; trigger?: (child: React.ReactElement) => React.ReactNode }
export function FileTreeFile({ path, name, icon, children, className, trigger, ...props }: FileTreeFileProps): React.JSX.Element {
  const { selectedPath, onSelect } = useContext(Context)
  const row = <button type="button" className="ai-file-tree-row" title={path} onClick={() => onSelect?.(path)}>{children ?? <><span className="ai-file-tree-spacer" /><FileTreeIcon>{icon ?? <File size={16} />}</FileTreeIcon><FileTreeName>{name}</FileTreeName></>}</button>
  return <div role="treeitem" aria-selected={selectedPath === path} className={className} {...props}>{trigger ? trigger(row) : row}</div>
}
export function FileTreeActions({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element { return <div role="group" className={cn('ai-file-tree-actions', className)} {...props} /> }
