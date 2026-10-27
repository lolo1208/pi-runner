// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TooltipProvider } from './components/ui/tooltip'
import App from './App'
import type { Conversation } from '../../shared/conversations'

Object.assign(globalThis, { React })
vi.mock('./hooks/useConversationPersistence', () => ({ useConversationPersistence: vi.fn() }))
vi.mock('./SettingsPage', () => ({ default: () => null }))
vi.mock('./components/WindowTitleBar', () => ({ WindowTitleBar: () => null }))
vi.mock('./ModelChat', () => ({ default: ({ projectReady, project, onPermissionChange }: { projectReady: boolean; project: string | null; onPermissionChange: (mode: string) => void }) =>
  <div data-testid="chat" data-project={project ?? 'none'}><button disabled={!projectReady}>发送消息</button><button disabled={!projectReady} onClick={() => onPermissionChange('auto')}>切换项目自审</button></div>
}))
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, row: unknown) => React.ReactNode }) =>
  <div data-testid="sidebar-list">{data.map((row, index) => <div key={index}>{itemContent(index, row)}</div>)}</div>
}))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
Element.prototype.scrollIntoView = vi.fn()
const projectTask: Conversation = { id: 'project', title: '项目中的对话', preview: '', project: 'D:/project', updatedAt: 100 }
const ordinary: Conversation = { id: 'ordinary', title: '普通对话历史', preview: '', project: null, updatedAt: 1 }
const api = {
  loadConversations: vi.fn(), openProject: vi.fn(async (root: string) => root),
  getModelSettings: vi.fn(async () => ({ ok: true, value: { profiles: [], providers: [], activeProfileId: null } })),
  listCheckpoints: vi.fn(async () => []), onAgentEvent: vi.fn(() => () => {})
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  Object.assign(window, { piRunner: api, matchMedia: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) })
  api.loadConversations.mockResolvedValue({ version: 1, tasks: [projectTask, ordinary], selectedId: ordinary.id })
})
afterEach(cleanup)
function showApp() { return render(<TooltipProvider><App /></TooltipProvider>) }

describe('ordinary conversation entry points', () => {
  it('pins the conversation group above projects and allows sending and switching permissions', async () => {
    showApp()
    await screen.findByRole('button', { name: /^普通对话历史/ })
    const list = screen.getByTestId('sidebar-list')
    expect(within(list).getAllByRole('button')[0].textContent).toBe('对话')
    expect(screen.queryByRole('button', { name: '编辑项目 对话' })).toBeNull()
    expect(screen.queryByRole('button', { name: '移除项目 对话' })).toBeNull()
    expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '切换项目自审' }))
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(screen.queryByRole('button', { name: /^普通对话历史/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(screen.getByRole('button', { name: /^普通对话历史/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开工具栏' }))
    expect(screen.getByText('打开项目后查看快照。')).toBeTruthy()
    expect(api.listCheckpoints).not.toHaveBeenCalled()
  })

  it('keeps an empty conversation group and creates directly from its heading', async () => {
    api.loadConversations.mockResolvedValue({ version: 1, tasks: [projectTask], selectedId: projectTask.id })
    showApp()
    await screen.findByRole('button', { name: /^项目中的对话/ })
    await waitFor(() => expect((screen.getByRole('button', { name: '新建普通对话' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '新建普通对话' }))
    expect(screen.getByRole('button', { name: '发送消息' }).closest('[data-project]')?.getAttribute('data-project')).toBe('none')
    expect(screen.getByRole('button', { name: '对话' })).toBeTruthy()
  })

  it('creates an ordinary conversation from the new conversation dialog', async () => {
    api.loadConversations.mockResolvedValue({ version: 1, tasks: [], selectedId: null })
    showApp()
    await waitFor(() => expect((screen.getByRole('button', { name: '新建普通对话' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getAllByRole('button', { name: '新建对话' })[0])
    fireEvent.click(await screen.findByRole('button', { name: /普通对话.*无需选择项目目录/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(false)
    expect(api.openProject).not.toHaveBeenCalled()
  })
})
