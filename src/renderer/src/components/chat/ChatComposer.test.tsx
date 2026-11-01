// @vitest-environment jsdom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from './ChatComposer'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ModelProfileView } from '../../../../shared/models'

const renderModelPicker = vi.hoisted(() => vi.fn())
vi.mock('./ConversationModelPicker', async importOriginal => {
  const original = await importOriginal<typeof import('./ConversationModelPicker')>()
  return { ...original, ConversationModelPicker: (props: React.ComponentProps<typeof original.ConversationModelPicker>) => {
    renderModelPicker()
    return <original.ConversationModelPicker {...props} />
  } }
})
Object.assign(globalThis, { React })
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
const profile = { id: 'test', name: '测试', provider: 'openai', model: 'test', baseUrl: 'https://example.com', hasApiKey: true } as ModelProfileView
const images: [] = []
const skillIds: string[] = []
function Harness({ onSend = () => {}, onPromptChange = () => {} }: { onSend?: () => void; onPromptChange?: (value: string) => void }) {
  const [prompt, setPrompt] = useState('测试')
  return <TooltipProvider><ChatComposer profile={profile} prompt={prompt} images={images} skillIds={skillIds} isBusy={false} hasMessages={false} sendWithCtrlEnter={false}
    onPromptChange={value => { setPrompt(value); onPromptChange(value) }} onImagesChange={() => {}} onOpenSettings={() => {}} onSend={onSend} onCancel={() => {}} /></TooltipProvider>
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers() })

describe('消息输入响应与输入法保护', () => {
  it('连续输入不重渲染模型选择器，清空后仍即时禁用发送', () => {
    render(<Harness />)
    renderModelPicker.mockClear()
    const input = screen.getByRole('textbox', { name: '消息' })
    for (const value of ['测试a', '测试ab', '测试abc']) fireEvent.change(input, { target: { value } })
    expect(renderModelPicker).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '' } })
    expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '重新输入' } })
    expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('组合输入中阻止表单提交，失焦后不会遗留组合输入锁', () => {
    const send = vi.fn()
    render(<Harness onSend={send} />)
    const input = screen.getByRole('textbox', { name: '消息' })
    fireEvent.compositionStart(input)
    fireEvent.submit(input.closest('form')!)
    expect(send).not.toHaveBeenCalled()
    fireEvent.blur(input)
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    expect(send).toHaveBeenCalledOnce()
  })

  it('组合输入替换已关闭的斜杠后，同位置的新斜杠可以再次打开技能菜单', () => {
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement
    input.focus()
    fireEvent.change(input, { target: { value: '/' } })
    expect(input.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.getAttribute('aria-expanded')).toBe('false')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '你' } })
    fireEvent.compositionEnd(input, { data: '你' })
    fireEvent.change(input, { target: { value: '/' } })
    expect(input.getAttribute('aria-expanded')).toBe('true')
  })

  it('输入时不通过 JavaScript 读取滚动高度或重写输入框高度', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(26)
    render(<Harness />)
    act(() => vi.advanceTimersByTime(32))
    height.mockClear()
    const input = screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement
    for (const value of ['测试n', '测试ni', '测试你', '测试你好\n第二行']) {
      fireEvent.change(input, { target: { value } })
      act(() => vi.advanceTimersByTime(32))
    }
    expect(height).not.toHaveBeenCalled()
    expect(input.style.height).toBe('')
    expect(input.value).toBe('测试你好\n第二行')
  })

  it('组合输入期间即使键盘事件缺少 isComposing，也不会把选词回车当作发送', () => {
    const send = vi.fn()
    const change = vi.fn()
    render(<Harness onSend={send} onPromptChange={change} />)
    const input = screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '测试ni' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, isComposing: false })
    expect(send).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '测试你' } })
    fireEvent.compositionEnd(input, { data: '你' })
    expect(input.value).toBe('测试你')
    expect(change).toHaveBeenLastCalledWith('测试你')
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(send).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, isComposing: false })
    expect(send).toHaveBeenCalledOnce()
  })
})
