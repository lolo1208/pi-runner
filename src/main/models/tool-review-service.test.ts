import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { ToolReviewService } from './tool-review-service'
import { ModelClient } from './model-client'
import type { ModelSettingsStore } from './model-settings-store'
import type { ModelProfile, ModelReply, ToolReviewRequest } from '../../shared/models'

const profile = { provider: 'openai' } as ModelProfile
const store = (value: unknown = { profile, apiKey: 'test' }) => ({ reviewProfile: vi.fn(async () => value) }) as unknown as ModelSettingsStore
const request = (overrides: Partial<ToolReviewRequest> = {}): ToolReviewRequest => ({
  tool: 'write', args: { path: path.join(os.tmpdir(), 'review-target', 'a.txt'), content: 'hello' },
  cwd: os.tmpdir(), mode: 'auto', project: os.tmpdir(), userPrompt: '处理这个任务', reason: '需要审核', signal: new AbortController().signal, ...overrides
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('tool review decisions', () => {
  it('uses AI review even when no project is bound', async () => {
    const complete = vi.spyOn(ModelClient.prototype, 'complete').mockResolvedValue({ text: '{"decision":"allow"}' } as ModelReply)
    expect(await new ToolReviewService(store()).review(request({ project: undefined }))).toBe('allow')
    expect(complete.mock.calls[0]?.[2]?.[0]?.content).toContain('当前项目：未绑定')
  })
  it.each(['allow', 'ask', 'deny'] as const)('accepts strict JSON decision %s', async decision => {
    vi.spyOn(ModelClient.prototype, 'complete').mockResolvedValue({ text: JSON.stringify({ decision, reason: '评估结果' }) } as ModelReply)
    expect(await new ToolReviewService(store()).review(request())).toBe(decision)
  })
  it.each(['allow', 'do not allow', '{"decision":"allow"', 'prefix {"decision":"allow"}', 'null', '{"decision":"ALLOW"}', '{"reason":"allow"}', '```json\n{"decision":"allow"}\n```'])('falls back for malformed output %s', async text => {
    vi.spyOn(ModelClient.prototype, 'complete').mockResolvedValue({ text } as ModelReply)
    expect(await new ToolReviewService(store()).review(request())).toBe('ask')
  })
  it('allows an explicit edit of a named target without a model', async () => {
    const data = store(null)
    const target = path.join(os.tmpdir(), 'review-target', 'a.txt')
    expect(await new ToolReviewService(data).review(request({ userPrompt: `请修改 "${target}"`, args: { path: target } }))).toBe('allow')
    expect(data.reviewProfile).not.toHaveBeenCalled()
  })
  it.each(['请查看', '不要修改', '请修改但不要写入', '能否修改'])('does not infer authorization from %s', async prefix => {
    const target = path.join(os.tmpdir(), 'review-target', 'a.txt')
    expect(await new ToolReviewService(store(null)).review(request({ userPrompt: `${prefix} "${target}"` }))).toBe('ask')
  })
  it('does not infer source authorization from a copy destination', async () => {
    const target = path.join(os.tmpdir(), 'review-target')
    expect(await new ToolReviewService(store(null)).review(request({ tool: 'copy', userPrompt: `请创建 "${target}"`, args: { path: '/unrelated', destination: target } }))).toBe('ask')
  })
  it('canonicalizes parent traversal before matching a named directory', async () => {
    const target = path.join(os.tmpdir(), 'review-target')
    expect(await new ToolReviewService(store(null)).review(request({ userPrompt: `请修改 "${target}"`, args: { path: path.join(target, '..', 'other.txt') } }))).toBe('ask')
  })
  it('falls back when settings cannot be read', async () => {
    const data = store(); vi.mocked(data.reviewProfile).mockRejectedValue(new Error('unreadable'))
    expect(await new ToolReviewService(data).review(request())).toBe('ask')
  })
  it.each([null, { profile: { provider: 'chatgpt' }, apiKey: '' }])('falls back for unavailable review clients', async selected => {
    const complete = vi.spyOn(ModelClient.prototype, 'complete')
    expect(await new ToolReviewService(store(selected)).review(request())).toBe('ask')
    expect(complete).not.toHaveBeenCalled()
  })
  it('does not send oversized instructions or operation arguments', async () => {
    const complete = vi.spyOn(ModelClient.prototype, 'complete')
    const service = new ToolReviewService(store())
    expect(await service.review(request({ userPrompt: 'x'.repeat(2001) }))).toBe('ask')
    expect(await service.review(request({ args: { content: 'x'.repeat(2001) } }))).toBe('ask')
    expect(complete).not.toHaveBeenCalled()
  })
  it('falls back after provider failure', async () => {
    vi.spyOn(ModelClient.prototype, 'complete').mockRejectedValue(new Error('offline'))
    expect(await new ToolReviewService(store()).review(request())).toBe('ask')
  })
  it('rejects a late allow after cancellation', async () => {
    const controller = new AbortController()
    vi.spyOn(ModelClient.prototype, 'complete').mockImplementation(async () => { controller.abort(); return { text: '{"decision":"allow"}' } as ModelReply })
    expect(await new ToolReviewService(store()).review(request({ signal: controller.signal }))).toBe('ask')
  })
  it('gives the model request a bounded deadline', async () => {
    const complete = vi.spyOn(ModelClient.prototype, 'complete').mockResolvedValue({ text: '{"decision":"ask"}' } as ModelReply)
    const input = request()
    await new ToolReviewService(store()).review(input)
    const signal = complete.mock.calls[0][3]
    expect(signal).not.toBe(input.signal)
    expect(signal.aborted).toBe(false)
  })
  it('falls back when the review deadline expires', async () => {
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => nativeTimeout(5))
    vi.spyOn(ModelClient.prototype, 'complete').mockImplementation(async (_profile, _key, _messages, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    expect(await new ToolReviewService(store()).review(request())).toBe('ask')
    expect(timeout).toHaveBeenCalledWith(30000)
  })
})
