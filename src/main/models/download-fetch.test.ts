import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('electron', () => ({ net: { request: mocks.request } }))
import { anonymousDownloadFetch } from './download-fetch'

describe('anonymous Electron download transport', () => {
  let request: EventEmitter & { end: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> }
  beforeEach(() => {
    mocks.request.mockReset()
    request = Object.assign(new EventEmitter(), { end: vi.fn(), abort: vi.fn() })
    mocks.request.mockReturnValue(request)
  })
  const response = (statusCode = 200) => Object.assign(new EventEmitter(), { statusCode, headers: { 'content-type': 'application/octet-stream', 'content-length': '3' } })

  it('discards supplied authentication, cookies and method options', async () => {
    const pending = anonymousDownloadFetch('https://example.com/file', { method: 'POST', credentials: 'include', headers: { Authorization: 'fixture', Cookie: 'fixture' } })
    request.emit('response', response(404))
    await pending
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', headers: {}, credentials: 'omit', useSessionCookies: false, redirect: 'manual', referrerPolicy: 'no-referrer' }))
  })
  it('returns a redirect without following it, so the download tool checks the next URL', async () => {
    const pending = anonymousDownloadFetch('https://example.com/image')
    request.emit('redirect', 302, 'GET', 'https://cdn.example.com/image', {})
    const result = await pending
    expect(result.status).toBe(302); expect(result.headers.get('location')).toBe('https://cdn.example.com/image')
    expect(request.abort).toHaveBeenCalledOnce()
    request.emit('error', new Error('Redirect was cancelled'))
  })
  it('streams the exact response bytes and headers', async () => {
    const pending = anonymousDownloadFetch('https://example.com/file')
    const message = response(); request.emit('response', message)
    message.emit('data', Buffer.from([0, 255])); message.emit('data', Buffer.from([2])); message.emit('end')
    const result = await pending
    expect(result.headers.get('content-length')).toBe('3')
    expect(Buffer.from(await result.arrayBuffer())).toEqual(Buffer.from([0, 255, 2]))
  })
  it('propagates failures before response headers', async () => {
    const pending = anonymousDownloadFetch('https://example.com/file')
    const rejected = expect(pending).rejects.toThrow('offline')
    request.emit('error', new Error('offline')); await rejected
  })
  it('aborts a response stream when the caller cancels', async () => {
    const controller = new AbortController()
    const pending = anonymousDownloadFetch('https://example.com/file', { signal: controller.signal })
    request.emit('response', response())
    const result = await pending
    const rejected = expect(result.arrayBuffer()).rejects.toThrow()
    controller.abort(); await rejected
    expect(request.abort).toHaveBeenCalledOnce()
  })
  it('never starts a request when already cancelled', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(anonymousDownloadFetch('https://example.com/file', { signal: controller.signal })).rejects.toThrow()
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
