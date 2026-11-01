import { describe, expect, it, vi } from 'vitest'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { requestPiStream } from './pi-stream'

const message: AssistantMessage = {
  role: 'assistant', api: 'openai-completions', provider: 'test', model: 'test', content: [], timestamp: 0,
  stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

describe('模型流空闲计时', () => {
  it('收到事件时重置计时，结束后停止计时', async () => {
    vi.useFakeTimers()
    try {
      const source = createAssistantMessageEventStream()
      const expired = vi.fn()
      let timer: number | undefined
      const output = requestPiStream(() => source, '', () => {}, active => {
        if (timer) clearTimeout(timer)
        timer = active ? setTimeout(expired, 1000) : undefined
      })
      await vi.advanceTimersByTimeAsync(900)
      source.push({ type: 'start', partial: message })
      await vi.advanceTimersByTimeAsync(900)
      expect(expired).not.toHaveBeenCalled()
      source.push({ type: 'done', reason: 'stop', message })
      await output.result()
      await vi.advanceTimersByTimeAsync(1000)
      expect(expired).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('启动失败时停止计时', () => {
    const active = vi.fn()
    expect(() => requestPiStream(() => { throw new Error('失败') }, '', () => {}, active)).toThrow()
    expect(active.mock.calls).toEqual([[true], [false]])
  })
})
