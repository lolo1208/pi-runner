import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown, ChevronUp, MessageCirclePlus, Search, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Modal } from '@/components/ui/modal'
import { UNLINKED_PROJECT_LABEL } from '../app-types'
import type { Task } from '../app-types'
import { TaskProjectHeading, TaskProjectRow } from './TaskProjectGroup'

const DEFAULT_VISIBLE_TASKS = 8

interface ProjectSidebarProps {
  groups: Map<string, Task[]>
  busyProjectRoots: Set<string>
  projectNames: Map<string, string>
  hasMatchingTasks: boolean
  currentTaskId?: string
  busyTaskIds: string[]
  waitingTaskIds: string[]
  query: string
  searchOpen: boolean
  collapsedProjects: string[]
  pendingProjectRemoval: string | null
  isBusy: boolean
  onStartTask: () => void
  onToggleSearch: () => void
  onQueryChange: (query: string) => void
  onCloseSearch: () => void
  onToggleProject: (root: string) => void
  onPendingProjectRemovalChange: (root: string | null) => void
  onEditProject: (root: string) => void
  onRemoveProject: (root: string) => void
  onSelectTask: (task: Task) => void
  onEditTask: (task: Task) => void
  onRemoveTask: (task: Task) => void
  onCreateProjectTask: (root: string) => void
  onOpenSettings: () => void
}

export function ProjectSidebar({ groups, busyProjectRoots, projectNames, hasMatchingTasks, currentTaskId, busyTaskIds, waitingTaskIds, query, searchOpen, collapsedProjects, pendingProjectRemoval, isBusy, onStartTask, onToggleSearch, onQueryChange, onCloseSearch, onToggleProject, onPendingProjectRemovalChange, onEditProject, onRemoveProject, onSelectTask, onEditTask, onRemoveTask, onCreateProjectTask, onOpenSettings }: ProjectSidebarProps): React.JSX.Element {
  const [now, setNow] = useState(Date.now)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [expandedTaskProjects, setExpandedTaskProjects] = useState<Set<string>>(() => new Set())
  const toggleTaskExpansion = (root: string): void => {
    setExpandedTaskProjects(previous => {
      const next = new Set(previous)
      if (next.has(root)) next.delete(root)
      else next.add(root)
      return next
    })
  }
  const rows = useMemo(() => {
    const collapsed = new Set(collapsedProjects)
    const result: { key: string; root: string; tasks: Task[]; task?: Task; empty?: boolean; taskToggle?: boolean }[] = []
    for (const [root, tasks] of groups) {
      result.push({ key: `project:${root}`, root, tasks })
      if (collapsed.has(root)) continue
      for (const task of tasks.slice(0, DEFAULT_VISIBLE_TASKS)) result.push({ key: `task:${task.id}`, root, tasks, task })
      if (tasks.length > DEFAULT_VISIBLE_TASKS) {
        if (expandedTaskProjects.has(root)) {
          for (const task of tasks.slice(DEFAULT_VISIBLE_TASKS)) result.push({ key: `task:${task.id}`, root, tasks, task })
        }
        result.push({ key: `task-toggle:${root}`, root, tasks, taskToggle: true })
      }
      if (!tasks.length) result.push({ key: `empty:${root}`, root, tasks, empty: true })
    }
    return result
  }, [groups, collapsedProjects, expandedTaskProjects])
  const deletionDisabled = isBusy || Boolean(deletingTask && busyTaskIds.includes(deletingTask.id))
  /** 只有目标项目自身仍有会话执行或等待输入时才禁止移除；其他项目的执行不影响。 */
  const projectRemovalDisabled = (root: string): boolean =>
    isBusy || (groups.get(root) ?? []).some(task => busyTaskIds.includes(task.id) || waitingTaskIds.includes(task.id))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return <aside className="task-sidebar">
    <nav className="task-actions" aria-label="对话操作">
      <Button className="conversation-action-button" disabled={isBusy} aria-label="新建对话" onClick={onStartTask}><MessageCirclePlus size={17} aria-hidden="true" /><span>新建对话</span></Button>
      <Button aria-label="搜索对话" onClick={onToggleSearch} aria-expanded={searchOpen}><Search size={17} /><span>搜索对话</span></Button>
    </nav>
    {searchOpen && <div className="search-field">
      <Search size={15} />
      <Input autoFocus aria-label="搜索对话" placeholder="搜索对话…" value={query} onChange={event => onQueryChange(event.target.value)} />
      <Button className="icon-button" aria-label="关闭搜索" onClick={onCloseSearch}><X size={14} /></Button>
    </div>}
    <Virtuoso className="task-list" aria-label="项目与对话" tabIndex={0} data={rows} defaultItemHeight={36} increaseViewportBy={200}
      computeItemKey={(_, row) => row.key}
      initialTopMostItemIndex={Math.max(0, rows.findIndex(row => row.task?.id === currentTaskId))}
      itemContent={(index, row) => row.task ? <TaskProjectRow task={row.task} currentTaskId={currentTaskId} busyTaskIds={busyTaskIds} waitingTaskIds={waitingTaskIds} now={now} creationDisabled={isBusy} onSelectTask={onSelectTask} onEditTask={onEditTask} onRemoveTask={onRemoveTask} onRequestTaskRemoval={setDeletingTask} />
        : row.taskToggle ? <Button variant="ghost" className="task-item project-task-item project-task-toggle" aria-expanded={expandedTaskProjects.has(row.root)} onClick={() => toggleTaskExpansion(row.root)}>
          {expandedTaskProjects.has(row.root) ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
          <span>{expandedTaskProjects.has(row.root) ? '收起' : '查看更多'}</span>
        </Button>
        : row.empty ? <Button className="project-start conversation-action-button" disabled={isBusy} onClick={() => onCreateProjectTask(row.root)}><MessageCirclePlus size={14} aria-hidden="true" />新建对话</Button>
        : <div style={{ paddingTop: index ? 10 : 0 }}><TaskProjectHeading
          root={row.root} tasks={row.tasks} currentTaskId={currentTaskId} busyTaskIds={busyTaskIds} waitingTaskIds={waitingTaskIds}
          projectBusy={busyProjectRoots.has(row.root)} now={now} creationDisabled={isBusy} collapsed={collapsedProjects.includes(row.root)}
          canRemoveProjects={row.root !== UNLINKED_PROJECT_LABEL} projectName={projectNames.get(row.root) ?? row.root}
          removalDisabled={projectRemovalDisabled(row.root)} isRemovalPending={false} hideRemovalDialog
          onToggleCollapsed={() => onToggleProject(row.root)} onRemovalPendingChange={open => onPendingProjectRemovalChange(open ? row.root : null)}
          onEditProject={() => onEditProject(row.root)} onRemoveProject={() => onRemoveProject(row.root)}
          onSelectTask={onSelectTask} onEditTask={onEditTask} onRemoveTask={onRemoveTask} onCreateTask={() => onCreateProjectTask(row.root)}
        /></div>}
    />
    {!hasMatchingTasks && query && <p className="hint">没有找到匹配的对话</p>}
    <Modal open={Boolean(deletingTask)} onOpenChange={open => { if (!open) setDeletingTask(null) }} title="删除此对话？" description={`将删除“${deletingTask?.title ?? ''}”的全部消息和草稿，删除后无法恢复。项目文件会保留。`} closeDisabled={deletionDisabled}>
      <div className="modal-actions"><Button variant="outline" autoFocus onClick={() => setDeletingTask(null)}>取消</Button><Button variant="destructive" disabled={deletionDisabled} onClick={() => { if (deletingTask) { onRemoveTask(deletingTask); setDeletingTask(null) } }}>确认删除</Button></div>
    </Modal>
    <Modal open={Boolean(pendingProjectRemoval)} onOpenChange={open => { if (!open) onPendingProjectRemovalChange(null) }} title="移除此项目？" description="同时移除此项目的对话，并删除 Pi Runner 快照数据。项目文件会保留。" closeDisabled={pendingProjectRemoval ? projectRemovalDisabled(pendingProjectRemoval) : isBusy}>
      <div className="modal-actions"><Button variant="outline" autoFocus disabled={isBusy} onClick={() => onPendingProjectRemovalChange(null)}>取消</Button><Button variant="destructive" disabled={pendingProjectRemoval ? projectRemovalDisabled(pendingProjectRemoval) : isBusy} onClick={() => { if (pendingProjectRemoval) onRemoveProject(pendingProjectRemoval) }}>确认移除</Button></div>
    </Modal>
    <div className="sidebar-bottom"><Button onClick={onOpenSettings}><Settings size={16} />设置<small>v0.1</small></Button></div>
  </aside>
}
