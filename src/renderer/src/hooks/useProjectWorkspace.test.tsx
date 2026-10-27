// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../../shared/conversations'
import { useProjectWorkspace } from './useProjectWorkspace'
import { UNLINKED_PROJECT_LABEL } from '../app-types'

vi.mock('./useConversationPersistence', () => ({ useConversationPersistence: vi.fn() }))
const ordinary: Conversation = { id: 'ordinary', title: '普通对话', preview: '', project: null }
const projectTask: Conversation = { id: 'project', title: '项目对话', preview: '', project: 'D:/project', permissionMode: 'full' }
const api = {
  loadConversations: vi.fn(), openProject: vi.fn(async (root: string) => root),
  removeProject: vi.fn(async () => {}), onAgentEvent: vi.fn(() => () => {})
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  Object.assign(window, { piRunner: api })
  api.loadConversations.mockResolvedValue({ version: 1, tasks: [projectTask, ordinary], selectedId: projectTask.id })
})
afterEach(cleanup)

async function loadedWorkspace() {
  const hook = renderHook(() => useProjectWorkspace())
  await waitFor(() => expect(hook.result.current.isBusy).toBe(false))
  return hook
}

describe('ordinary conversations', () => {
  it('creates without opening a project, closes the picker and expands the conversation group', async () => {
    const { result } = await loadedWorkspace()
    act(() => { result.current.setProjectPickerOpen(true); result.current.setCollapsedProjects([UNLINKED_PROJECT_LABEL]) })
    api.openProject.mockClear()
    act(() => result.current.createOrdinaryTask())
    expect(result.current.currentTask?.project).toBeNull()
    expect(result.current.currentTask?.permissionMode).toBe('default')
    expect(result.current.project).toBeNull()
    expect(result.current.projectPickerOpen).toBe(false)
    expect(result.current.collapsedProjects).toEqual([])
    expect(result.current.composerFocusTaskId).toBe(result.current.currentTask?.id)
    expect(api.openProject).not.toHaveBeenCalled()
  })

  it('does not use old project snapshots when selecting an ordinary conversation', async () => {
    const { result } = await loadedWorkspace()
    act(() => result.current.updateProjectSnapshot({ checkpoints: [{ hash: 'old' } as never] }))
    act(() => result.current.selectTask(ordinary))
    expect(result.current.project).toBeNull()
    expect(result.current.projectSnapshot.checkpoints).toEqual([])
  })

  it('selects an ordinary conversation after deleting the current project conversation', async () => {
    const { result } = await loadedWorkspace()
    act(() => result.current.removeTask(projectTask))
    expect(result.current.currentTask?.id).toBe(ordinary.id)
    expect(result.current.project).toBeNull()
  })

  it('selects the remaining ordinary conversation after removing its current project', async () => {
    const { result } = await loadedWorkspace()
    act(() => result.current.removeProject(projectTask.project!))
    await waitFor(() => expect(result.current.isBusy).toBe(false))
    expect(result.current.currentTask?.id).toBe(ordinary.id)
    expect(result.current.project).toBeNull()
  })

  it('restores an ordinary conversation without opening a project', async () => {
    api.loadConversations.mockResolvedValue({ version: 1, tasks: [ordinary, projectTask], selectedId: ordinary.id })
    const { result } = await loadedWorkspace()
    expect(result.current.currentTask?.id).toBe(ordinary.id)
    expect(api.openProject).not.toHaveBeenCalled()
  })
})
