import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDownloadToolDefinition } from './download-tool'
import { piProjectTools } from './pi-tools'
import { commandRisk } from './tool-permissions'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDZkAAAAASUVORK5CYII=', 'base64')
const digest = createHash('sha256').update(png).digest('hex')
describe('dedicated download tool', () => {
  let root: string, base: string, server: Server, hits: number
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'download-tool-')); hits = 0
    server = createServer((request, response) => {
      hits++
      if (request.url === '/redirect') { response.writeHead(302, { location: '/image' }); response.end(); return }
      if (request.url === '/loop') { response.writeHead(302, { location: '/loop' }); response.end(); return }
      if (request.url === '/bad-redirect') { response.writeHead(302, { location: 'file:///etc/passwd' }); response.end(); return }
      if (request.url === '/missing') { response.writeHead(404); response.end('missing'); return }
      if (request.url === '/partial') { response.writeHead(206); response.end(png); return }
      if (request.url === '/empty') { response.end(); return }
      if (request.url === '/html') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<html>error</html>'); return }
      if (request.url === '/fake-image') { response.writeHead(200, { 'content-type': 'image/png' }); response.end('not an image'); return }
      if (request.url === '/huge-header') { response.writeHead(200, { 'content-length': 64 * 1024 * 1024 + 1 }); response.flushHeaders(); return }
      if (request.url === '/stream') { response.writeHead(200, { 'content-type': 'image/png' }); response.write(png.subarray(0, 8)); return }
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length }); response.end(png)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterEach(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })
  const execute = (args: Record<string, unknown>, options: Parameters<typeof createDownloadToolDefinition>[1] = {}, signal?: AbortSignal) => createDownloadToolDefinition(async () => {}, options).execute('download', args as never, signal, undefined, undefined as never)

  it('downloads exact binary bytes, verifies SHA-256, and replaces only after validation', async () => {
    const target = path.join(root, 'image.png'); await writeFile(target, 'old')
    const result = await execute({ url: `${base}/image`, path: target, sha256: digest })
    expect(await readFile(target)).toEqual(png)
    expect(result.details).toMatchObject({ bytes: png.length, contentType: 'image/png', sha256: digest })
    expect(await readdir(root)).toEqual(['image.png'])
  })
  it('follows relative redirects and creates parent directories', async () => {
    const target = path.join(root, 'nested', 'image.png')
    await execute({ url: `${base}/redirect`, path: target })
    expect(await readFile(target)).toEqual(png); expect(hits).toBe(2)
  })
  it('preserves binary bytes across multiple stream chunks', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(png.subarray(0, 5)); controller.enqueue(png.subarray(5, 12)); controller.enqueue(png.subarray(12)); controller.close()
    } })
    const fetchRequest = vi.fn(async () => new Response(body)) as unknown as typeof fetch
    const target = path.join(root, 'image.png')
    await execute({ url: `${base}/image`, path: target, sha256: digest }, { fetchRequest })
    expect(await readFile(target)).toEqual(png)
  })
  it.each(['/missing', '/partial', '/empty', '/html', '/fake-image', '/huge-header', '/loop', '/bad-redirect'])('preserves existing files and cleans temporary files after %s', async route => {
    const target = path.join(root, 'image.png'); await writeFile(target, 'old')
    await expect(execute({ url: base + route, path: target })).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('old')
    expect(await readdir(root)).toEqual(['image.png'])
  })
  it('rejects an incorrect checksum and leaves no new file', async () => {
    await expect(execute({ url: `${base}/image`, path: path.join(root, 'new.png'), sha256: '0'.repeat(64) })).rejects.toThrow('SHA-256')
    expect(await readdir(root)).toEqual([])
  })
  it('caps streamed bytes even without Content-Length', async () => {
    const fetchRequest = vi.fn(async () => new Response(png)) as unknown as typeof fetch
    await expect(execute({ url: `${base}/image`, path: path.join(root, 'new.png') }, { fetchRequest, maxBytes: 16 })).rejects.toThrow('大小上限')
    expect(await readdir(root)).toEqual([])
  })
  it('rejects a mismatched Content-Length', async () => {
    const fetchRequest = vi.fn(async () => new Response(png, { headers: { 'content-length': String(png.length + 1) } })) as unknown as typeof fetch
    await expect(execute({ url: `${base}/image`, path: path.join(root, 'new.png') }, { fetchRequest })).rejects.toThrow('长度')
    expect(await readdir(root)).toEqual([])
  })
  it.each(['file:///etc/passwd', 'ftp://example.com/file', 'https://user:password@example.com/file', 'not-a-url'])('rejects unsupported URL %s before network access', async url => {
    await expect(execute({ url, path: path.join(root, 'new.png') })).rejects.toThrow()
    expect(hits).toBe(0)
  })
  it('cancels a pending stream without replacing the original', async () => {
    const target = path.join(root, 'image.png'); await writeFile(target, 'old')
    const controller = new AbortController()
    const fetchRequest: typeof fetch = async (url, init) => {
      const response = await fetch(url, init); setTimeout(() => controller.abort(), 15); return response
    }
    await expect(execute({ url: `${base}/stream`, path: target }, { fetchRequest }, controller.signal)).rejects.toThrow('取消')
    expect(await readFile(target, 'utf8')).toBe('old'); expect(await readdir(root)).toEqual(['image.png'])
  })
  it('times out a pending stream and removes its partial download', async () => {
    await expect(execute({ url: `${base}/stream`, path: path.join(root, 'new.png') }, { timeoutMs: 40 })).rejects.toThrow('时间限制')
    expect(await readdir(root)).toEqual([])
  })
  it('rechecks the target after downloading and before replacement', async () => {
    const target = path.join(root, 'image.png'); await writeFile(target, 'old')
    let checks = 0
    const tool = createDownloadToolDefinition(async () => { if (++checks === 3) throw new Error('path changed') })
    await expect(tool.execute('t', { url: `${base}/image`, path: target } as never, undefined, undefined, undefined as never)).rejects.toThrow()
    expect(checks).toBe(3); expect(await readFile(target, 'utf8')).toBe('old'); expect(await readdir(root)).toEqual(['image.png'])
  })
  it.each(['default', 'auto', 'full'] as const)('uses existing permission and snapshot routing in %s', async mode => {
    const approve = vi.fn(async () => { throw new Error('approval requested') })
    const snapshot = vi.fn(async () => {})
    const tool = piProjectTools(root, snapshot, { mode, project: root, protectedDirectories: [], approve }).find(item => item.name === 'download')!
    const operation = tool.execute('t', { url: `${base}/image`, path: 'image.png' } as never, undefined, undefined, undefined as never)
    if (mode === 'default') {
      await expect(operation).rejects.toThrow('approval requested'); expect(hits).toBe(0); expect(snapshot).not.toHaveBeenCalled()
    } else {
      await operation; expect(approve).not.toHaveBeenCalled(); expect(snapshot).toHaveBeenCalledOnce(); expect(await readFile(path.join(root, 'image.png'))).toEqual(png)
    }
  })
  it('reviews project-external destinations before sending a request', async () => {
    const target = path.join(process.cwd(), '.tmp', 'download-review-target.png')
    const approve = vi.fn(async () => { throw new Error('approval requested') })
    const tool = piProjectTools(root, async () => {}, { mode: 'auto', project: root, protectedDirectories: [], approve }).find(item => item.name === 'download')!
    await expect(tool.execute('t', { url: `${base}/image`, path: target } as never, undefined, undefined, undefined as never)).rejects.toThrow('approval requested')
    expect(hits).toBe(0)
  })
  it('blocks protected metadata and junction destinations before network access', async () => {
    const outside = path.join(root, 'outside'); await mkdir(outside)
    await symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    const tool = piProjectTools(root, async () => {}, { mode: 'full', project: root, protectedDirectories: [], approve: async () => {} }).find(item => item.name === 'download')!
    for (const target of ['.git/image.png', 'link/image.png']) await expect(tool.execute('t', { url: `${base}/image`, path: target } as never, undefined, undefined, undefined as never)).rejects.toThrow()
    expect(hits).toBe(0)
  })
})

describe('terminal download file mutation routing', () => {
  it.each([
    'Invoke-WebRequest -Uri "https://picsum.photos/200/300" -OutFile "image4.jpg"',
    'cd C:\\Users\\LOLO\\Downloads\\aa\\tmp; Invoke-WebRequest -Uri "https://picsum.photos/200/300" -OutFile "image4.jpg"; Invoke-WebRequest -Uri "https://picsum.photos/300/200" -OutFile "image5.jpg"; Write-Host "下载完成"',
    'iwr https://example.com/image -outfile:image.jpg',
    'IWR -OutF image.jpg -Uri https://example.com/image',
    'Invoke-WebRequest -Uri $url -OutFile $target',
    'Invoke-RestMethod https://example.com/image -OutFile image.jpg',
    '& "Invoke-WebRequest" -Uri $url -OutFile $target'
  ])('blocks %s', command => expect(commandRisk(command).risk).toBe('block'))
  it.each(['Invoke-WebRequest -Uri "https://example.com"', 'Write-Host "Invoke-WebRequest -OutFile image.jpg"', 'Write-Host "-OutFile"'])('does not misidentify %s as writing', command => expect(commandRisk(command).risk).not.toBe('block'))
})
