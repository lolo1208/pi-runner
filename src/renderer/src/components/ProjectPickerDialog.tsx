import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ChevronRight, FolderOpen, MessagesSquare, PlusCircle } from 'lucide-react'
import { PagedList } from './PagedList'
import { Input } from '@/components/ui/input'
import { useState } from 'react'

interface ProjectPickerDialogProps {
  projects: string[]
  projectNames: Map<string, string>
  error: string
  isBusy: boolean
  onClose: () => void
  onOpenProject: (root: string) => void
  onChooseProjectDirectory: () => void
  onCreateOrdinaryTask: () => void
}

function getProjectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root
}

export function ProjectPickerDialog({ projects, projectNames, error, isBusy, onClose, onOpenProject, onChooseProjectDirectory, onCreateOrdinaryTask }: ProjectPickerDialogProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const filtered = projects.filter(root => `${projectNames.get(root) ?? getProjectName(root)} ${root}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <Modal open onOpenChange={open => { if (!open && !isBusy) onClose() }} title="新建对话" description="直接开始普通对话，或选择此对话要使用的项目。" closeLabel="关闭" closeDisabled={isBusy}>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="project-picker-list project-picker-ordinary"><Button disabled={isBusy} onClick={onCreateOrdinaryTask}><MessagesSquare size={20} /><span><b>普通对话</b><small>无需选择项目目录</small></span><ChevronRight size={16} /></Button></div>
    {projects.length > 40 && <Input aria-label="搜索项目" placeholder="搜索项目名称或目录" value={query} onChange={event => setQuery(event.target.value)} />}
    <PagedList items={filtered} label="项目" resetKey={query}>{page => <div className="project-picker-list">
      {page.map(root => <Button key={root} disabled={isBusy} title={root} onClick={() => onOpenProject(root)}>
        <FolderOpen size={20} /><span><b>{projectNames.get(root) ?? getProjectName(root)}</b><small>{root}</small></span><ChevronRight size={16} />
      </Button>)}
      {!projects.length && <p className="hint">还没有已添加的项目。</p>}
      {projects.length > 0 && !filtered.length && <p className="hint">没有匹配的项目。</p>}
    </div>}</PagedList>
    <Button className="project-picker-new-button" disabled={isBusy} onClick={onChooseProjectDirectory}><PlusCircle size={17} />新的项目</Button>
    {isBusy && <p className="hint" role="status">正在打开项目…</p>}
  </Modal>
}
