import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { FileTree, FileTreeFile, FileTreeFolder } from './ai-elements/file-tree'
import type { ProjectFileEntry } from '../../../shared/api'
import { FileContextMenu } from './chat/FileContextMenu'
import { fileIcon } from './FileIcon'

export function ProjectFileTree({ project, reveal }: { project: string | null; reveal: { path: string; id: number } | null }): React.JSX.Element {
  const [entries, setEntries] = useState<Record<string, ProjectFileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const selectedRef = useRef<HTMLDivElement>(null)
  const load = useCallback(async (directory: string) => {
    if (!project) return
    const result = await window.piRunner.listProjectFiles(project, directory)
    setEntries(previous => ({ ...previous, [directory]: result }))
  }, [project])
  useEffect(() => {
    setEntries({}); setExpanded(new Set()); setSelected(''); setError('')
    if (project) void load('').catch(() => setError('无法读取项目目录，请检查访问权限。'))
  }, [project, load])
  useEffect(() => {
    if (!project || !reveal) return
    let active = true
    const path = reveal.path.replace(/\\/g, '/')
    const parts = path.split('/').filter(Boolean)
    void (async () => {
      try {
        const directories = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
        await Promise.all(['', ...directories].map(load))
        if (active) { setExpanded(previous => new Set([...previous, ...directories])); setSelected(path); setError('') }
      } catch { if (active) setError('无法定位文件，目录可能已不存在。') }
    })()
    return () => { active = false }
  }, [project, reveal, load])
  useEffect(() => { selectedRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [selected, entries, expanded])
  const renderEntries = (directory: string): React.ReactNode => entries[directory]?.map(entry => {
    const trigger = (child: React.ReactElement): React.ReactNode => <FileContextMenu project={project!} path={entry.path} inSidebar isDirectory={entry.isDirectory}>{child}</FileContextMenu>
    const props = { key: entry.path, path: entry.path, name: entry.name, trigger, ref: selected === entry.path ? selectedRef : undefined }
    return entry.isDirectory ? <FileTreeFolder {...props}>{renderEntries(entry.path)}</FileTreeFolder> : <FileTreeFile {...props} icon={fileIcon(entry.path)} />
  })
  return <div className="project-file-panel">
    <div className="project-file-heading"><strong>项目文件</strong>{project && <button type="button" title="刷新文件列表" aria-label="刷新文件列表" onClick={() => { setError(''); void Promise.all(['', ...expanded].map(load)).catch(() => setError('刷新文件列表失败。')) }}><RefreshCw size={15} /></button>}</div>
    {!project ? <p className="hint">打开项目后查看文件。</p> : <FileTree className="project-file-tree" aria-label="项目文件" expanded={expanded} selectedPath={selected} onSelect={setSelected} onExpandedChange={next => {
      for (const directory of next) if (!expanded.has(directory)) void load(directory).catch(() => setError(`无法读取目录：${directory}`))
      setExpanded(next)
    }}>{renderEntries('')}{entries['']?.length === 0 && <p className="hint">项目目录为空。</p>}</FileTree>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>
}
