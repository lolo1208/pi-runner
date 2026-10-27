// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ModelChat from './ModelChat'
import { TooltipProvider } from './components/ui/tooltip'
import type { ModelProfileView } from '../../shared/models'

Object.assign(globalThis, { React })
vi.mock('./components/chat/ChatTranscript', () => ({ ChatTranscript: () => null }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
afterEach(cleanup)

describe('ordinary conversation messages', () => {
  it('sends from the real composer and continues the queue without a project', async () => {
    const chatWithModel = vi.fn(async () => ({ ok: true, value: { text: '收到', model: 'test', elapsedMs: 10, truncated: false } }))
    Object.assign(window, { piRunner: { chatWithModel } })
    const onMessagesChange = vi.fn()
    const profile = { id: 'test', name: '测试模型', provider: 'openai', baseUrl: 'https://example.com/v1', model: 'test', hasApiKey: true } as ModelProfileView
    render(<TooltipProvider><ModelChat conversationId="ordinary" project={null} projectReady profile={profile} initialDraft="第一条消息" onBusyChange={() => {}} onOpenSettings={() => {}} onMessagesChange={onMessagesChange} /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledOnce())
    expect(chatWithModel.mock.calls[0]).toEqual(expect.arrayContaining([{ conversationId: 'ordinary', project: null }]))
    expect(onMessagesChange.mock.calls[0][0]).toEqual(expect.arrayContaining([{ role: 'user', content: '第一条消息' }]))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第二条消息' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledTimes(2))
    expect(chatWithModel).toHaveBeenCalledTimes(2)
    expect(onMessagesChange.mock.calls[1][0].map((message: { content: string }) => message.content)).toEqual(['第一条消息', '收到', '第二条消息', '收到'])
    expect(screen.getByText('无项目目录')).toBeTruthy()
  })
})
