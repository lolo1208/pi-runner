import { useEffect, useRef, useState } from 'react'
import { useConversationPersistence } from './useConversationPersistence'
import type { ChangedFile, Checkpoint, FileDiff } from '../../../shared/api'
import type { Task } from '../app-types'
import { defaultConversationPermission } from '../../../shared/conversations'
import { readProjectMetaMap, writeProjectMetaMap, defaultProjectName, type ProjectMetaMap } from '../project-meta'

interface ProjectSnapshotState {
  checkpoints: Checkpoint[]
  changes: ChangedFile[]
  diff: FileDiff | null
}

const emptySnapshotState: ProjectSnapshotState = { checkpoints: [], changes: [], diff: null }

function readProjectList(): string[] {
  try {
    const current = localStorage.getItem('pi-runner.projects')
    const legacy = localStorage.getItem('pi-runner.workspaces')
    const roots: unknown = JSON.parse(current ?? legacy ?? '[]')
    const projects = Array.isArray(roots) ? roots.filter((root): root is string => typeof root === 'string' && root.length > 0) : []
    if (current === null && legacy !== null) {
      localStorage.setItem('pi-runner.projects', JSON.stringify(projects))
      localStorage.removeItem('pi-runner.workspaces')
    }
    return projects
  } catch {
    return []
  }
}

function createTask(project: string, tasks: Task[]): Task {
  return { id: crypto.randomUUID(), title: '新建对话', preview: '开始一段新的对话', project, updatedAt: Date.now(), permissionMode: defaultConversationPermission(project, tasks) }
}

export function useProjectWorkspace() {
  const [project, setCurrentProject] = useState<string | null>(null)
  const [readyProjects, setReadyProjects] = useState<Set<string>>(() => new Set())
  const setProject = (root: string | null): void => {
    setCurrentProject(root)
    if (root) setReadyProjects(current => new Set([...current, root]))
  }
  const [savedProjects, setSavedProjects] = useState(readProjectList)
  const [projectMeta, setProjectMeta] = useState<ProjectMetaMap>(readProjectMetaMap)
  const [snapshotsByProject, setSnapshotsByProject] = useState<Record<string, ProjectSnapshotState>>({})
  const [isBusy, setIsBusy] = useState(true)
  const [error, setError] = useState('')
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [pendingProjectRemoval, setPendingProjectRemoval] = useState<string | null>(null)
  const [busyTasks, setBusyTasks] = useState<string[]>([])
  const [pendingProjectDirectories, setPendingProjectDirectories] = useState<Record<string, string>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('pi-runner.pending-project-directories') ?? '{}')
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim())))
    }
    catch { return {} }
  })
  const failedProjectDirectories = useRef<Record<string, string>>({})
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composerFocusTaskId, setComposerFocusTaskId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([])
  const [searchOpen, setSearchOpen] = useState(false)

  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void window.piRunner.loadConversations().then(state => {
      if (!active) return
      setTasks(state.tasks)
      const restored: Record<string, ProjectSnapshotState> = {}
      const checkpointsByProject = new Map<string, Map<string, Checkpoint>>()
      for (const task of state.tasks) for (const round of task.agentSnapshots ?? []) {
        let checkpoints = checkpointsByProject.get(round.project)
        if (!checkpoints) { checkpoints = new Map(); checkpointsByProject.set(round.project, checkpoints) }
        for (const checkpoint of [round.before, round.after]) if (!checkpoints.has(checkpoint.hash)) checkpoints.set(checkpoint.hash, checkpoint)
      }
      // 一次去重、一次排序，避免每恢复一轮都扫描并重建项目的全部快照。
      for (const [root, checkpoints] of checkpointsByProject) {
        restored[root] = { ...emptySnapshotState, checkpoints: [...checkpoints.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt)) }
      }
      setSnapshotsByProject(restored)
      setSelectedId(state.selectedId)
      setLoaded(true)
      const root = (state.tasks.find(task => task.id === state.selectedId) ?? state.tasks[0])?.project
      if (root) {
        void window.piRunner.openProject(root).then(opened => { if (active) setProject(opened) })
          .catch(error => { if (active) setError(`会话已恢复，但项目打开失败：${error instanceof Error ? error.message : String(error)}`) })
          .finally(() => { if (active) setIsBusy(false) })
      } else setIsBusy(false)
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : '无法读取本地会话，请重启应用后重试。')
    })
    return () => { active = false }
  }, [])

  useEffect(() => window.piRunner.onAgentEvent?.(event => {
    if (event.type !== 'snapshot' || !event.snapshot) return
    const round = event.snapshot
    setTasks(items => items.map(task => task.id === event.conversationId ? { ...task, agentSnapshots: [...task.agentSnapshots ?? [], round] } : task))
    setSnapshotsByProject(current => ({ ...current, [round.project]: {
      checkpoints: [...current[round.project]?.checkpoints ?? [], round.before, round.after], changes: [], diff: null
    } }))
    void window.piRunner.getChanges(round.before.hash, round.after.hash, round.project).then(changes => {
      setSnapshotsByProject(current => current[round.project]?.checkpoints.at(-1)?.hash === round.after.hash ? {
        ...current, [round.project]: { ...current[round.project], changes }
      } : current)
    }).catch(() => setError('代理快照已保存，文件差异读取失败，请重新选择项目后重试'))
  }), [])

  useConversationPersistence(loaded, tasks, selectedId, setError)

  const currentTask = tasks.find(item => item.id === selectedId) ?? tasks[0]
  const snapshotKey = currentTask?.project ?? project ?? 'unlinked'
  const projectSnapshot = snapshotsByProject[snapshotKey] ?? emptySnapshotState
  const isChatBusy = busyTasks.length > 0

  const beforeHash = projectSnapshot.checkpoints.at(-2)?.hash
  const afterHash = projectSnapshot.checkpoints.at(-1)?.hash
  useEffect(() => {
    if (!beforeHash || !afterHash || snapshotKey === 'unlinked' || !window.piRunner.getChanges) return
    let active = true
    void window.piRunner.getChanges(beforeHash, afterHash, snapshotKey).then(changes => {
      if (active) setSnapshotsByProject(current => ({ ...current, [snapshotKey]: { ...current[snapshotKey], changes } }))
    }).catch(() => { if (active) setError('快照差异读取失败，请检查项目目录和快照数据') })
    return () => { active = false }
  }, [snapshotKey, beforeHash, afterHash])

  const updateProjectSnapshot = (update: Partial<ProjectSnapshotState>): void => {
    setSnapshotsByProject(current => ({ ...current, [snapshotKey]: { ...(current[snapshotKey] ?? emptySnapshotState), ...update } }))
  }

  const persistProjects = (projects: string[]): void => {
    try {
      localStorage.setItem('pi-runner.projects', JSON.stringify(projects))
    } catch {
      setError('项目列表未能保存到本地。')
    }
  }

  const rememberProject = (root: string): void => {
    setSavedProjects(current => {
      const next = [root, ...current.filter(item => item !== root)]
      persistProjects(next)
      return next
    })
  }

  const runAction = async (action: () => Promise<void>): Promise<boolean> => {
    setIsBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setIsBusy(false)
    }
  }

  const addTask = (root: string): void => {
    const task = createTask(root, tasks)
    setTasks(items => [task, ...items])
    setSelectedId(task.id)
    setComposerFocusTaskId(task.id)
    // 新建对话时自动展开所属项目
    setCollapsedProjects(items => items.includes(root) ? items.filter(item => item !== root) : items)
    setQuery('')
    setError('')
  }

  const createProjectTask = (): void => {
    if (!loaded || isBusy) return
    void runAction(async () => {
      const root = await window.piRunner.selectProject()
      if (!root) return
      rememberProject(root)
      setProject(root)
      setProjectPickerOpen(false)
      addTask(root)
    })
  }

  const chooseExistingProject = (root: string): void => {
    if (!loaded || isBusy) return
    void runAction(async () => {
      const opened = root === project ? root : await window.piRunner.openProject(root)
      setProject(opened)
      rememberProject(opened)
      setProjectPickerOpen(false)
      addTask(opened)
    })
  }

  const selectTask = (task: Task): void => {
    if (!task.project || task.project === project) {
      setSelectedId(task.id)
      return
    }

    void runAction(async () => {
      const opened = await window.piRunner.openProject(task.project!)
      setProject(opened)
      rememberProject(opened)
      setSelectedId(task.id)
    })
  }

  const removeTask = (task: Task): void => {
    if (isBusy || busyTasks.includes(task.id)) return
    const isCurrent = currentTask?.id === task.id
    const remaining = tasks.filter(item => item.id !== task.id)
    const fallback = remaining.find(item => item.project === task.project) ?? remaining[0]
    const finishRemoval = (): void => {
      setTasks(items => items.filter(item => item.id !== task.id))
      if (isCurrent) {
        setSelectedId(fallback?.id ?? null)
        setQuery('')
        if (fallback?.project) setCollapsedProjects(items => items.filter(root => root !== fallback.project))
      }
    }
    if (isCurrent && fallback?.project && fallback.project !== project) {
      void runAction(async () => {
        const opened = await window.piRunner.openProject(fallback.project!)
        setProject(opened)
        finishRemoval()
      })
    } else {
      finishRemoval()
    }
  }

  const removeProject = (root: string): void => {
    // 仅当被移除项目自身仍有会话正在执行时禁止；其他项目的执行不影响。
    if (busyTasks.some(id => tasks.some(task => task.id === id && task.project === root))) return
    void runAction(async () => {
      await window.piRunner.removeProject(root)
      setReadyProjects(current => new Set([...current].filter(item => item !== root)))
      const remainingProjects = readProjectList().filter(item => item !== root)
      setSavedProjects(remainingProjects)
      persistProjects(remainingProjects)

      const remainingTasks = tasks.filter(item => item.project !== root)
      setTasks(current => current.filter(item => item.project !== root))
      setSnapshotsByProject(current => {
        const next = { ...current }
        delete next[root]
        return next
      })

      if (currentTask?.project === root) {
        const fallback = remainingTasks[0]
        if (fallback?.project) {
          const opened = await window.piRunner.openProject(fallback.project)
          setProject(opened)
          setSelectedId(fallback.id)
        } else {
          setProject(null)
          setSelectedId(null)
        }
      } else if (project === root) {
        setProject(null)
      }
      setPendingProjectRemoval(null)
    })
  }

  const saveProjectEdit = (root: string, next: { name: string; directory: string; prompt: string }): Promise<boolean> => {
    if (!loaded || isBusy) return Promise.resolve(false)
    delete failedProjectDirectories.current[root]
    return runAction(async () => {
      let target = root
      const directory = next.directory.trim()
      if (isChatBusy) {
        // 先保存信息；当前轮次继续使用原目录，队列等待目录切换后再发送。
        const pending = { ...pendingProjectDirectories }
        if (directory && directory !== root) pending[root] = directory
        else delete pending[root]
        localStorage.setItem('pi-runner.pending-project-directories', JSON.stringify(pending))
        setPendingProjectDirectories(pending)
      } else if (directory && directory !== root) {
        // 目录迁移期间，已经打开的后台会话也必须停止启动新一轮。
        setReadyProjects(current => new Set([...current].filter(item => item !== root)))
        try { target = await window.piRunner.rebindProject(root, directory) }
        catch (error) {
          setReadyProjects(current => new Set([...current, root]))
          throw error
        }
        if (project && project !== root) await window.piRunner.openProject(project)
      }
      const projects = readProjectList().map(item => item === root ? target : item)
      setSavedProjects(projects)
      persistProjects(projects)

      const name = next.name.trim()
      const prompt = next.prompt.trim()
      const fallbackName = defaultProjectName(root)
      setProjectMeta(current => {
        const updated: ProjectMetaMap = { ...current }
        if (target !== root) delete updated[root]
        const meta = { ...(updated[target] ?? {}) }
        if (name && name !== fallbackName) meta.name = name
        else delete meta.name
        if (prompt) meta.prompt = prompt
        else delete meta.prompt
        if (meta.name || meta.prompt) updated[target] = meta
        else delete updated[target]
        if (!writeProjectMetaMap(updated)) setError('项目信息未能保存到本地，重启后将丢失。')
        return updated
      })

      if (target !== root) {
        setReadyProjects(current => new Set([...current].filter(item => item !== root).concat(target)))
        setTasks(items => items.map(item => item.project === root ? { ...item, project: target } : item))
        setSnapshotsByProject(current => {
          if (!current[root]) return current
          const nextSnapshots = { ...current, [target]: current[root] }
          delete nextSnapshots[root]
          return nextSnapshots
        })
        setCollapsedProjects(items => items.map(item => item === root ? target : item))
      }
      if (project === root) setProject(target)
      if (!isChatBusy && pendingProjectDirectories[root]) {
        const pending = { ...pendingProjectDirectories }
        delete pending[root]
        localStorage.setItem('pi-runner.pending-project-directories', JSON.stringify(pending))
        setPendingProjectDirectories(pending)
      }
    })
  }

  useEffect(() => {
    if (!loaded || isBusy || isChatBusy) return
    const entry = Object.entries(pendingProjectDirectories).find(([root, directory]) => failedProjectDirectories.current[root] !== directory)
    if (!entry) return
    const [root, directory] = entry
    const meta = projectMeta[root]
    void saveProjectEdit(root, { directory, name: meta?.name ?? '', prompt: meta?.prompt ?? '' }).then(saved => {
      // 失败时保留待切换目录，允许用户修正后重试，不继续发送到旧目录。
      if (!saved) failedProjectDirectories.current[root] = directory
    })
  }, [loaded, isBusy, isChatBusy, pendingProjectDirectories])

  const captureCheckpoint = (): void => {
    void runAction(async () => {
      const next = await window.piRunner.createCheckpoint(`手动快照 ${projectSnapshot.checkpoints.length + 1}`)
      const previous = projectSnapshot.checkpoints.at(-1)
      updateProjectSnapshot({ checkpoints: [...projectSnapshot.checkpoints, next], changes: [], diff: null })
      updateProjectSnapshot({ changes: previous ? await window.piRunner.getChanges(previous.hash, next.hash) : [] })
    })
  }

  const rollbackCheckpoint = (): void => {
    const before = projectSnapshot.checkpoints.at(-2), after = projectSnapshot.checkpoints.at(-1)
    if (!before || !after || isChatBusy || isBusy) return
    void runAction(async () => {
      const restored = await window.piRunner.rollbackCheckpoint(before.hash, after.hash)
      updateProjectSnapshot({ checkpoints: [...projectSnapshot.checkpoints, restored], changes: [], diff: null })
    })
  }

  return {
    project,
    readyProjects,
    savedProjects,
    projectMeta,
    isBusy,
    error,
    setError,
    projectPickerOpen,
    setProjectPickerOpen,
    pendingProjectRemoval,
    setPendingProjectRemoval,
    busyTasks,
    pendingProjectDirectories,
    setBusyTasks,
    tasks,
    setTasks,
    currentTask,
    composerFocusTaskId,
    setComposerFocusTaskId,
    query,
    setQuery,
    collapsedProjects,
    setCollapsedProjects,
    searchOpen,
    setSearchOpen,
    projectSnapshot,
    isChatBusy,
    updateProjectSnapshot,
    runAction,
    createProjectTask,
    chooseExistingProject,
    saveProjectEdit,
    selectTask,
    removeTask,
    removeProject,
    captureCheckpoint,
    rollbackCheckpoint,
  }
}
