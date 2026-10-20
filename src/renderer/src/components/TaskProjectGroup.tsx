import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ChevronRight, MessageCircleQuestion, LoaderCircle, MessageCircle, SquarePen, SlidersHorizontal, MessageCirclePlus, Trash2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { UNLINKED_PROJECT_LABEL, type Task } from '../app-types'
import { formatTaskTime } from '../task-time'

export interface TaskProjectGroupProps {
  root: string
  onRequestTaskRemoval?: (task: Task) => void
  hideRemovalDialog?: boolean
  tasks: Task[]
  currentTaskId?: string
  busyTaskIds: string[]
  waitingTaskIds: string[]
  projectBusy: boolean
  now?: number
  creationDisabled?: boolean
  collapsed: boolean
  canRemoveProjects: boolean
  projectName: string
  removalDisabled: boolean
  isRemovalPending: boolean
  onToggleCollapsed: () => void
  onRemovalPendingChange: (open: boolean) => void
  onEditProject: () => void
  onRemoveProject: () => void
  onSelectTask: (task: Task) => void
  onEditTask: (task: Task) => void
  onRemoveTask: (task: Task) => void
  onCreateTask: () => void
}

function TaskTitle({ title }: { title: string }): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const [truncated, setTruncated] = useState(false)
  const measure = (): void => {
    const element = ref.current
    setTruncated(Boolean(element && element.clientWidth > 0 && element.scrollWidth > element.clientWidth))
  }
  useLayoutEffect(() => {
    measure()
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    // 悬停操作按钮、字体及窗口尺寸变化都会改变名称可用宽度。
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [title])
  return <b ref={ref} title={truncated ? title : undefined} onMouseEnter={measure}>{title}</b>
}

function TaskDeleteDialog({ task, busy, disabled, onRemoveTask, onRequestTaskRemoval }: { task: Task; busy: boolean; disabled: boolean; onRemoveTask: (task: Task) => void; onRequestTaskRemoval?: (task: Task) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return <>
    <Button className="task-delete-button" aria-label={`删除对话 ${task.title}`} title={busy ? '回复结束后可删除对话' : '删除对话'} disabled={busy || disabled} onClick={() => onRequestTaskRemoval ? onRequestTaskRemoval(task) : setOpen(true)}><Trash2 size={14} aria-hidden="true" /></Button>
    <Modal open={open} onOpenChange={setOpen} title="删除此对话？" description={`将删除“${task.title}”的全部消息和草稿，删除后无法恢复。项目文件会保留。`} closeDisabled={busy || disabled}>
      <div className="modal-actions">
        <Button variant="outline" autoFocus onClick={() => setOpen(false)}>取消</Button>
        <Button variant="destructive" disabled={busy || disabled} onClick={() => { setOpen(false); onRemoveTask(task) }}>确认删除</Button>
      </div>
    </Modal>
  </>
}

export function TaskProjectHeading({ root, tasks, waitingTaskIds, projectBusy, creationDisabled = false, collapsed, canRemoveProjects, projectName, removalDisabled, isRemovalPending, onToggleCollapsed, onRemovalPendingChange, onEditProject, onRemoveProject, onCreateTask, hideRemovalDialog }: TaskProjectGroupProps): React.JSX.Element {
  const projectWaiting = tasks.some(task => waitingTaskIds.includes(task.id))
  return <div className={`project-heading-row ${collapsed && (projectBusy || projectWaiting) ? 'project-running' : ''}`}>
      <Button className="project-heading" title={root} aria-expanded={!collapsed} onClick={onToggleCollapsed}>
        <span className="project-folder" aria-hidden="true"><ChevronRight className={`project-chevron ${collapsed ? '' : 'expanded'}`} size={15} /></span>
        <span>{root === UNLINKED_PROJECT_LABEL ? root : projectName}</span>
      </Button>
      {collapsed && (projectBusy || projectWaiting) && <span className="project-running-status" role="status" aria-label={projectWaiting ? '项目中有对话等待输入' : '项目中有对话正在执行'} title={projectWaiting ? '项目中有对话等待输入' : '项目中有对话正在执行'}>{projectWaiting ? <MessageCircleQuestion size={14} aria-hidden="true" /> : <LoaderCircle className="task-spinner" size={14} aria-hidden="true" />}</span>}
      {root !== UNLINKED_PROJECT_LABEL && <Button className="project-create-button conversation-action-button" aria-label={`在项目 ${projectName} 中新建对话`} title="新建对话" disabled={creationDisabled} onClick={onCreateTask}><MessageCirclePlus size={14} aria-hidden="true" /></Button>}
      {canRemoveProjects && <Button className="project-edit-button conversation-action-button" aria-label={`编辑项目 ${projectName}`} title="编辑项目信息" disabled={creationDisabled} onClick={onEditProject}><SlidersHorizontal size={14} aria-hidden="true" /></Button>}
      {canRemoveProjects && <Button className="project-remove-button" aria-label={`移除项目 ${projectName}`} title="移除项目并删除快照数据" disabled={removalDisabled} onClick={() => onRemovalPendingChange(true)}><Trash2 size={14} /></Button>}
      {canRemoveProjects && !hideRemovalDialog && <Modal open={isRemovalPending} onOpenChange={onRemovalPendingChange} title="移除此项目？" description="同时移除此项目的对话，并删除 Pi Runner 快照数据。项目文件会保留。" closeDisabled={removalDisabled}>
        <div className="modal-actions">
          <Button variant="outline" autoFocus disabled={removalDisabled} onClick={() => onRemovalPendingChange(false)}>取消</Button>
          <Button variant="destructive" disabled={removalDisabled} onClick={onRemoveProject}>确认移除</Button>
        </div>
      </Modal>}
    </div>
}

export function TaskProjectRow({ task, currentTaskId, busyTaskIds, waitingTaskIds, now = Date.now(), creationDisabled = false, onSelectTask, onEditTask, onRemoveTask, onRequestTaskRemoval }: Pick<TaskProjectGroupProps, 'currentTaskId' | 'busyTaskIds' | 'waitingTaskIds' | 'now' | 'creationDisabled' | 'onSelectTask' | 'onEditTask' | 'onRemoveTask' | 'onRequestTaskRemoval'> & { task: Task }): React.JSX.Element {
  const busy = busyTaskIds.includes(task.id)
  const waiting = waitingTaskIds.includes(task.id)
  const editing = !busy && !waiting && !task.unreadCompletion && Boolean(task.draft?.trim() || task.draftImages?.length || task.draftSkillIds?.length)
  const time = formatTaskTime(task.updatedAt, now)
  return <div className={`task-row ${task.id === currentTaskId ? 'selected' : ''} ${busy ? 'running' : ''}`} key={task.id}>
  <Button className={`task-item project-task-item ${task.id === currentTaskId ? 'selected' : ''} ${busy ? 'running' : ''}`} aria-current={task.id === currentTaskId ? 'true' : undefined} onClick={() => onSelectTask(task)}>
    <span className="task-title">{editing ? <span className="inline-flex shrink-0" title="有未提交的输入"><SquarePen className="task-icon" size={13} aria-hidden="true" /></span> : <MessageCircle className="task-icon" size={13} aria-hidden="true" />}<TaskTitle title={task.title} />{editing && <span className="sr-only" role="status" aria-label="正在编辑" />}</span>
    {waiting ? <span className="task-input-status" role="status" aria-label="等待输入" title="等待你的选择、回答或确认"><MessageCircleQuestion size={14} aria-hidden="true" /></span> : busy ? <span className="task-running-status" role="status" aria-label="正在回复"><LoaderCircle className="task-spinner" size={14} aria-hidden="true" /></span> : task.unreadCompletion ? <span className="task-completed-status" role="status" aria-label="已完成，未读" title="已完成，未读"><span className="task-unread-dot" aria-hidden="true" /></span> : time && <time className="task-time" dateTime={new Date(task.updatedAt!).toISOString()} title={new Date(task.updatedAt!).toLocaleString('zh-CN')}>{time}</time>}
  </Button>
  <Button className="task-edit-button conversation-action-button" aria-label={`编辑会话 ${task.title}`} title="编辑会话信息" disabled={creationDisabled} onClick={() => onEditTask(task)}><SlidersHorizontal size={14} aria-hidden="true" /></Button>
  <TaskDeleteDialog task={task} busy={busy} disabled={creationDisabled} onRemoveTask={onRemoveTask} onRequestTaskRemoval={onRequestTaskRemoval} />
  </div>
}

export function TaskProjectGroup(props: TaskProjectGroupProps): React.JSX.Element {
  return <section className="project-group">
    <TaskProjectHeading {...props} />
    {!props.collapsed && props.tasks.map(task => <TaskProjectRow key={task.id} {...props} task={task} />)}
    {!props.collapsed && !props.tasks.length && props.root !== UNLINKED_PROJECT_LABEL && <Button className="project-start conversation-action-button" disabled={props.creationDisabled} onClick={props.onCreateTask}><MessageCirclePlus size={14} aria-hidden="true" />新建对话</Button>}
  </section>
}
