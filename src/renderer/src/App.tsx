import { Button } from '@/components/ui/button'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { FolderOpen, MessageCirclePlus, PanelRightOpen } from 'lucide-react'
import type { ModelSettings } from '../../shared/models'
import ModelChat from './ModelChat'
import { sameSandboxProject } from './lib/sandbox-state'
import SettingsPage from './SettingsPage'
import { readPreferences, type Preferences } from './preferences'
import { unwrapModelResult } from './model-result'
import { useProjectWorkspace } from './hooks/useProjectWorkspace'
import { UNLINKED_PROJECT_LABEL, type Task } from './app-types'
import { defaultProjectName } from './project-meta'
import { ProjectEditDialog } from './components/ProjectEditDialog'
import { ConversationEditDialog } from './components/ConversationEditDialog'
import { composeCustomPrompt } from '../../shared/prompts'
import { ProjectPickerDialog } from './components/ProjectPickerDialog'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ToolSidebar } from './components/ToolSidebar'
import { WindowTitleBar } from './components/WindowTitleBar'
import './styles.css'
export default function App(): React.JSX.Element {
  const workspace = useProjectWorkspace()
  const {
    project, readyProjects, savedProjects, projectMeta, isBusy, error, setError, projectPickerOpen, setProjectPickerOpen,
    pendingProjectRemoval, setPendingProjectRemoval, busyTasks, setBusyTasks, pendingProjectDirectories, tasks, setTasks,
    currentTask, composerFocusTaskId, setComposerFocusTaskId, query, setQuery, collapsedProjects, setCollapsedProjects, searchOpen, setSearchOpen,
    projectSnapshot, isChatBusy, createProjectTask,
    chooseExistingProject, saveProjectEdit, selectTask, removeTask, removeProject,
  } = workspace
  const { checkpoints } = projectSnapshot
  const [preferences, setPreferences] = useState(readPreferences)
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedTheme = preferences.theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preferences.theme
  const [settings, setSettings] = useState<ModelSettings | null>(null)
  const [settingsError, setSettingsError] = useState('')
  const [waitingTaskIds, setWaitingTaskIds] = useState<string[]>([])
  const [notificationNavigationRequests, setNotificationNavigationRequests] = useState<Record<string, number>>({})
  const [settingsSection, setSettingsSection] = useState<string | null>(null)
  // 历史会话在首次打开时恢复；已打开的会话保留状态，后台运行和排队不受切换影响。
  const [openedTaskIds, setOpenedTaskIds] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setOpenedTaskIds(previous => {
      const existing = new Set(tasks.map(task => task.id))
      const next = new Set([...previous].filter(id => existing.has(id)))
      if (currentTask) next.add(currentTask.id)
      return next.size === previous.size && [...next].every(id => previous.has(id)) ? previous : next
    })
  }, [tasks, currentTask?.id])
  const mountedTasks = tasks.filter(task => task.id === currentTask?.id || openedTaskIds.has(task.id) || task.queuedMessages?.length || busyTasks.includes(task.id))
  const conversationRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!composerFocusTaskId || currentTask?.id !== composerFocusTaskId || isBusy || projectPickerOpen || settingsSection !== null) return
    // 等待弹窗卸载并恢复焦点后，再聚焦新会话的输入框。
    const timer = window.setTimeout(() => {
      conversationRef.current?.querySelector<HTMLTextAreaElement>('.task-chat:not([hidden]) .composer textarea')?.focus({ preventScroll: true })
      setComposerFocusTaskId(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [composerFocusTaskId, currentTask?.id, isBusy, projectPickerOpen, settingsSection, setComposerFocusTaskId])
  useEffect(() => {
    const markViewed = (): void => {
      if (!currentTask || settingsSection !== null || document.hidden) return
      setTasks(items => items.some(item => item.id === currentTask.id && item.unreadCompletion)
        ? items.map(item => item.id === currentTask.id ? { ...item, unreadCompletion: false } : item)
        : items)
    }
    markViewed()
    document.addEventListener('visibilitychange', markViewed)
    return () => document.removeEventListener('visibilitychange', markViewed)
  }, [currentTask?.id, currentTask?.unreadCompletion, settingsSection, setTasks])
  const [toolsOpen, setToolsOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [tool, setTool] = useState<'snapshots' | 'files' | 'terminal' | 'browser'>('snapshots')
  const loadSettings = (): void => {
    setSettingsError('')
    void window.piRunner.getModelSettings().then(unwrapModelResult).then(setSettings).catch(e => setSettingsError(e instanceof Error ? e.message : '无法读取模型设置'))
  }
  useEffect(loadSettings, [])
  useEffect(() => window.piRunner.onWindowMaximizedChange?.(setIsMaximized), [])
  /** 选中会话时同时关闭对应的通知气泡。 */
  const selectConversation = (task: Parameters<typeof selectTask>[0]): void => {
    void window.piRunner.closeNotifications?.()?.catch(() => {})
    selectTask(task)
  }
  // 点击通知时显示主窗口并选中对应会话；若正在设置页则先返回工作台。
  // 会话已被删除或不存在时只保持已打开的程序，不提示错误。
  useEffect(() => window.piRunner.onNotificationActivate?.(conversationId => {
    if (typeof conversationId !== 'string' || !conversationId) return
    const task = tasks.find(item => item.id === conversationId)
    if (!task) return
    setSettingsSection(null)
    selectConversation(task)
    setNotificationNavigationRequests(previous => ({ ...previous, [conversationId]: (previous[conversationId] ?? 0) + 1 }))
  }), [tasks, selectConversation])
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setSystemPrefersDark(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.font = preferences.font
    document.documentElement.style.setProperty('--ui-font-size', `${preferences.fontSize}px`)
  }, [resolvedTheme, preferences.font, preferences.fontSize])
  // 有会话执行且开关开启时请求主进程阻止系统休眠；结束或关闭后自动恢复。
  const sleepBlocking = preferences.preventSleep && busyTasks.length > 0
  useEffect(() => {
    void window.piRunner.setSleepBlocker?.(sleepBlocking)?.catch(() => {})
    return () => { void window.piRunner.setSleepBlocker?.(false)?.catch(() => {}) }
  }, [sleepBlocking])
  const updatePreferences = (next: Preferences): void => {
    setPreferences(next)
    try { localStorage.setItem('pi-runner.preferences', JSON.stringify({ ...next, sendWithCtrlEnterVersion: 1 })) } catch { setError('偏好设置未能保存，重启后将恢复默认值。请检查本地存储。') }
  }
  /** 按开关发送系统通知；macOS 走系统通知，Windows 走桌面右下角气泡。 */
  // 程序处于激活状态且正在查看该会话时不再弹出通知，避免打扰当前操作。
  const sendNotification = (kind: 'success' | 'failure' | 'input', title: string, body: string, conversationId: string, userInput?: string): void => {
    if (!preferences.systemNotifications) return
    if (conversationId === currentTask?.id && settingsSection === null && document.hasFocus()) return
    // 兼容尚未注入通知接口的测试环境。
    void window.piRunner.showNotification?.({ kind, title, body, conversationId, userInput })?.catch(() => {})
  }
  const activeProfile = settings?.profiles.find(item => item.id === settings.activeProfileId)
  // 最近交流的对话先分组，同时让其所属项目排在列表顶部。
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase()
    return tasks.filter(item => `${item.title} ${item.preview} ${item.project ?? ''}`.toLowerCase().includes(search))
      .sort((left, right) => (right.lastSentAt ?? right.updatedAt ?? 0) - (left.lastSentAt ?? left.updatedAt ?? 0))
  }, [tasks, query])
  const knownProjects = useMemo(() => [...new Set([...savedProjects, ...tasks.map(item => item.project).filter((root): root is string => Boolean(root))])], [tasks, savedProjects])
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, Task[]>()
    for (const task of filtered) {
      const root = task.project ?? UNLINKED_PROJECT_LABEL
      const group = groups.get(root)
      if (group) group.push(task)
      else groups.set(root, [task])
    }
    if (!query.trim()) for (const root of knownProjects) if (!groups.has(root)) groups.set(root, [])
    return groups
  }, [filtered, knownProjects, query])
  const projectNameFor = (root: string): string => projectMeta[root]?.name?.trim() || defaultProjectName(root)
  const projectNames = useMemo(() => new Map(knownProjects.map(root => [root, projectMeta[root]?.name?.trim() || defaultProjectName(root)])), [knownProjects, projectMeta])
  const [projectEditTarget, setProjectEditTarget] = useState<string | null>(null)
  const [conversationEditId, setConversationEditId] = useState<string | null>(null)
  const conversationEditTarget = tasks.find(task => task.id === conversationEditId)
  return <div className={`window-shell ${toolsOpen ? 'tools-open' : ''}`}>
    <WindowTitleBar
      pageTitle={settingsSection ? '设置' : currentTask?.title ?? ''}
      projectName={settingsSection ? null : currentTask?.project ? projectNameFor(currentTask.project) : null}
      isMaximized={isMaximized}
      onMinimize={() => { void window.piRunner.minimizeWindow() }}
      onToggleMaximize={() => { void window.piRunner.toggleMaximizeWindow() }}
      onClose={() => { void window.piRunner.closeWindow() }}
    />
    <div className={`app ${toolsOpen ? 'tools-open' : ''}`} hidden={settingsSection !== null}>
      <ProjectSidebar
        groups={groupedTasks}
        busyProjectRoots={new Set(tasks.filter(task => busyTasks.includes(task.id)).map(task => task.project ?? UNLINKED_PROJECT_LABEL))}
        projectNames={projectNames}
        hasMatchingTasks={filtered.length > 0}
        currentTaskId={currentTask?.id}
        busyTaskIds={busyTasks}
        waitingTaskIds={waitingTaskIds}
        query={query}
        searchOpen={searchOpen}
        collapsedProjects={collapsedProjects}
        pendingProjectRemoval={pendingProjectRemoval}
        isBusy={isBusy}
        onStartTask={() => { setError(''); setProjectPickerOpen(true) }}
        onToggleSearch={() => setSearchOpen(value => !value)}
        onQueryChange={setQuery}
        onCloseSearch={() => { setQuery(''); setSearchOpen(false) }}
        onToggleProject={root => setCollapsedProjects(items => items.includes(root) ? items.filter(item => item !== root) : [...items, root])}
        onPendingProjectRemovalChange={setPendingProjectRemoval}
        onEditProject={root => { setError(''); setProjectEditTarget(root) }}
        onRemoveProject={removeProject}
        onSelectTask={selectConversation}
        onEditTask={task => setConversationEditId(task.id)}
        onRemoveTask={removeTask}
        onCreateProjectTask={chooseExistingProject}
        onOpenSettings={() => setSettingsSection('general')}
      />
      <main className="conversation" ref={conversationRef}>
        <header className="conversation-header"><Button className="icon-button" aria-label={toolsOpen ? '收起工具栏' : '展开工具栏'} aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}><PanelRightOpen size={18} /></Button></header>
        {!currentTask && <section className="no-task-state"><FolderOpen size={30} /><h1>从一个项目开始</h1><p>为新对话选择已有项目，或添加一个新的目录。</p><Button className="project-new-button conversation-action-button" onClick={() => setProjectPickerOpen(true)}><MessageCirclePlus size={17} aria-hidden="true" />新建对话</Button></section>}
        {mountedTasks.map(task => <div className="task-chat" key={task.id} hidden={task.id !== currentTask?.id}><ModelChat notificationNavigationRequest={notificationNavigationRequests[task.id] ?? 0} snapshots={task.agentSnapshots} active={task.id === currentTask?.id && settingsSection === null} projectReady={!pendingProjectDirectories[task.project ?? ''] && Boolean(task.project && [...readyProjects].some(root => sameSandboxProject(root, task.project!)))} projectCurrent={!isBusy && Boolean(project && task.project && sameSandboxProject(project, task.project))} conversationId={task.id} initialIntentMode={task.intentMode} onIntentChange={intentMode => setTasks(items => items.map(item => item.id === task.id ? { ...item, intentMode } : item))} initialPermissionMode={task.permissionMode} onPermissionChange={permissionMode => setTasks(items => items.map(item => item.id === task.id ? { ...item, permissionMode } : item))} compressionThreshold={preferences.compressionThreshold} initialCompaction={task.compaction} onCompactionChange={compaction => setTasks(items => items.map(item => item.id === task.id ? { ...item, compaction } : item))} initialModelId={task.modelId} onModelChange={modelId => setTasks(items => items.map(item => item.id === task.id && item.modelId !== modelId ? { ...item, modelId } : item))} customPrompt={composeCustomPrompt(task.prompt, task.project ? projectMeta[task.project]?.prompt : undefined, preferences.customPrompt)} project={task.project} providers={settings?.providers} initialMessages={task.messages} initialDraft={task.draft} initialDraftImages={task.draftImages} initialDraftSkillIds={task.draftSkillIds} initialQueue={task.queuedMessages} initialQueuePaused={task.queuePaused} initialQueueEdit={task.queueEdit} onQueueChange={(queuedMessages, queuePaused, queueEdit) => setTasks(items => items.map(item => item.id === task.id && (item.queuedMessages !== queuedMessages || item.queuePaused !== queuePaused || item.queueEdit !== queueEdit) ? { ...item, queuedMessages, queuePaused, queueEdit } : item))} onDraftChange={(draft, draftImages, draftSkillIds) => setTasks(items => items.map(item => item.id === task.id && (item.draft !== draft || item.draftImages !== draftImages || item.draftSkillIds !== draftSkillIds) ? { ...item, draft, draftImages, draftSkillIds } : item))} profile={activeProfile} profiles={settings?.profiles} onModelSettingsChange={setSettings} onWaitingForInputChange={(waiting, reason) => {
          setWaitingTaskIds(items => waiting ? items.includes(task.id) ? items : [...items, task.id] : items.includes(task.id) ? items.filter(id => id !== task.id) : items)
          if (waiting && reason) sendNotification('input', task.title, reason === 'plan-question' ? '计划正在等待你的回答' : reason === 'plan-review' ? '计划已准备好，等待你的批准' : '需要你批准一个操作', task.id)
          if (waiting) setCollapsedProjects(items => items.filter(root => root !== (task.project ?? UNLINKED_PROJECT_LABEL)))
        }} onTaskEnd={(ok, userInput) => sendNotification(ok ? 'success' : 'failure', task.title, ok ? '任务已完成' : '任务执行失败', task.id, userInput)} onReplyComplete={() => {
          const unreadCompletion = task.id !== currentTask?.id || settingsSection !== null || document.hidden
          setTasks(items => items.map(item => item.id === task.id ? { ...item, unreadCompletion } : item))
          setCollapsedProjects(items => items.filter(root => root !== (task.project ?? UNLINKED_PROJECT_LABEL)))
        }} onBusyChange={busy => { setBusyTasks(items => busy ? [...items.filter(id => id !== task.id), task.id] : items.filter(id => id !== task.id)); if (busy) setTasks(items => items.map(item => item.id === task.id ? { ...item, updatedAt: Date.now(), lastSentAt: Date.now() } : item)) }} onOpenSettings={section => setSettingsSection(section ?? 'models')} sendWithCtrlEnter={preferences.sendWithCtrlEnter} onMessagesChange={(messages, restored) => setTasks(items => items.map(item => item.id === task.id ? { ...item, messages, updatedAt: restored ? item.updatedAt : Date.now(), title: item.titleEdited ? item.title : messages.find(message => message.role === 'user')?.content.slice(0, 36) || (messages.some(message => message.images?.length) ? '附件对话' : '新建对话'), preview: messages.at(-1)?.content.slice(0, 90) ?? '开始一段新的对话' } : item))} /></div>)}
        {error && <p role="alert" className="error">{error}</p>}
        {settingsError && <p role="alert" className="error">{settingsError}<Button onClick={loadSettings}>重新读取设置</Button></p>}

      </main>
      {toolsOpen && <ToolSidebar
        project={currentTask?.project ?? project}
        isBusy={isBusy || isChatBusy}
        activeTool={tool}
        checkpoints={checkpoints}
        onToolChange={setTool}
        onClose={() => setToolsOpen(false)}
      />}
    </div>
    {settingsSection !== null && <SettingsPage initialSection={settingsSection} settings={settings} error={settingsError} reload={loadSettings} preferences={preferences} onPreferences={updatePreferences} onChange={setSettings} onClose={() => setSettingsSection(null)} />}
    {projectPickerOpen && <ProjectPickerDialog
      projects={knownProjects}
      projectNames={projectNames}
      error={error}
      isBusy={isBusy}
      onClose={() => setProjectPickerOpen(false)}
      onOpenProject={chooseExistingProject}
      onChooseProjectDirectory={createProjectTask}
    />}
    {conversationEditTarget && <ConversationEditDialog
      key={conversationEditTarget.id}
      task={conversationEditTarget}
      onClose={() => setConversationEditId(null)}
      onSave={next => {
        setTasks(items => items.map(item => item.id === conversationEditTarget.id ? { ...item, title: next.title, titleEdited: true, prompt: next.prompt } : item))
        setConversationEditId(null)
      }}
    />}
    {projectEditTarget && <ProjectEditDialog
      root={projectEditTarget}
      name={projectMeta[projectEditTarget]?.name ?? ''}
      directory={pendingProjectDirectories[projectEditTarget] ?? projectEditTarget}
      prompt={projectMeta[projectEditTarget]?.prompt ?? ''}
      isBusy={isBusy}
      error={error}
      onClose={() => setProjectEditTarget(null)}
      onSave={next => { void saveProjectEdit(projectEditTarget, next).then(saved => { if (saved) setProjectEditTarget(null) }) }}
    />}
  </div>
}
