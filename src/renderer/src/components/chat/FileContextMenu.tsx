import { useState, type ReactElement } from 'react'
import { Copy, ExternalLink, FolderOpen, Link, PanelRightOpen } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { FileAction } from '../../../../shared/api'

/** 两处文件列表共用菜单，普通点击仍由文件行处理。 */
export function FileContextMenu({ project, path, children, inSidebar = false, isDirectory = false }: { project: string; path: string; children: ReactElement; inSidebar?: boolean; isDirectory?: boolean }): React.JSX.Element {
  const [error, setError] = useState('')
  const run = async (action: FileAction): Promise<void> => {
    setError('')
    try { await window.piRunner.performFileAction(project, path, action) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '文件操作失败，请重试') }
  }
  return <>
    <ContextMenu onOpenChange={open => { if (open) setError('') }}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label="文件操作">
        <ContextMenuItem onSelect={() => void run('copy-file')}><Copy aria-hidden="true" size={16} />复制{isDirectory ? '目录' : '文件'}</ContextMenuItem>
        <ContextMenuItem onSelect={() => void run('copy-path')}><Link aria-hidden="true" size={16} />复制路径</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void run('open-directory')}><FolderOpen aria-hidden="true" size={16} />打开所在目录</ContextMenuItem>
        <ContextMenuItem onSelect={() => void run('open-file')}><ExternalLink aria-hidden="true" size={16} />打开{isDirectory ? '目录' : '文件'}</ContextMenuItem>
        {!inSidebar && <><ContextMenuSeparator />
        <ContextMenuItem onSelect={() => window.dispatchEvent(new CustomEvent('pi-runner:reveal-file', { detail: { project, path } }))}><PanelRightOpen aria-hidden="true" size={16} />在侧边栏打开</ContextMenuItem></>}
      </ContextMenuContent>
    </ContextMenu>
    {error && <div className="file-context-menu-error" role="alert">{error}</div>}
  </>
}
