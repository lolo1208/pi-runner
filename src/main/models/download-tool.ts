import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { validateOrdinaryPath } from './filesystem-tools'
import { ModelError } from './model-validation'

const MAX_BYTES = 64 * 1024 * 1024
const TIMEOUT_MS = 60000
const imageTypes: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }

function downloadUrl(value: unknown): URL {
  let url: URL
  try { url = new URL(String(value)) } catch { throw new ModelError('下载 URL 无效，请提供完整的 HTTP 或 HTTPS 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ModelError('下载仅支持不含用户名和密码的 HTTP/HTTPS URL')
  return url
}

export function validateDownloadArgs(args: Record<string, unknown>): void {
  if (typeof args.url !== 'string' || !args.url.trim()) throw new ModelError('请提供下载 URL')
  downloadUrl(args.url)
  if (typeof args.path !== 'string' || !args.path.trim()) throw new ModelError('请提供保存文件的确切路径')
  if (args.sha256 !== undefined && (typeof args.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(args.sha256))) throw new ModelError('SHA-256 必须为 64 位十六进制字符串')
}

function validateImage(header: Buffer, contentType: string, target: string): void {
  const expected = imageTypes[path.extname(target).toLowerCase()]
  const actual = contentType === 'image/jpg' ? 'image/jpeg' : contentType
  if (expected && actual && actual !== 'application/octet-stream' && actual !== expected) throw new ModelError('下载响应类型与目标图片扩展名不一致，未保存文件')
  const type = expected ?? actual
  const valid = type === 'image/jpeg' ? header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    : type === 'image/png' ? header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : type === 'image/gif' ? /^GIF8[79]a$/.test(header.toString('ascii', 0, 6))
        : type === 'image/webp' ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP' : true
  if (!valid) throw new ModelError('下载内容未通过图片文件头校验，未保存文件')
}

/** 下载在目标旁的独占临时文件中完成；校验成功且重新检查路径后才替换目标。 */
export function createDownloadToolDefinition(check: (target: string) => Promise<void>, options: { fetchRequest?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {}): ToolDefinition {
  const fetchRequest = options.fetchRequest ?? fetch
  const maxBytes = options.maxBytes ?? MAX_BYTES
  return {
    name: 'download', label: '下载文件', executionMode: 'sequential',
    description: '从 HTTP/HTTPS URL 下载图片或其他二进制文件到 path，Windows/macOS/Linux 均使用此工具。最多跟随 5 次重定向，60 秒超时，上限 64 MiB；校验状态、非空内容、长度及常见图片文件头，可提供 sha256 验证完整性。完整校验成功后才保存；目标已存在时会替换。失败或取消保留原文件。不要用 write 写图片字节，也不要用 Invoke-WebRequest -OutFile、BITS、certutil、curl -o/-O、wget 或 aria2c 下载落盘。',
    parameters: { type: 'object', properties: {
      url: { type: 'string', minLength: 1, description: '完整 HTTP/HTTPS 下载地址' },
      path: { type: 'string', minLength: 1, description: '保存文件的确切相对或绝对路径' },
      sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$', description: '可选：可信来源提供的预期 SHA-256，不要猜测' }
    }, required: ['url', 'path'], additionalProperties: false } as ToolDefinition['parameters'],
    execute: async (_id, args, signal) => {
      const input = args as Record<string, unknown>
      validateDownloadArgs(input)
      const target = String(input.path)
      const downloadSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)])
      let temporary: string | undefined
      let response: Response | undefined
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        downloadSignal.throwIfAborted()
        await validateOrdinaryPath(target)
        await check(target)
        let url = downloadUrl(input.url)
        for (let redirects = 0; ; redirects++) {
          response = await fetchRequest(url.href, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: downloadSignal })
          if (![301, 302, 303, 307, 308].includes(response.status)) break
          const location = response.headers.get('location')
          await response.body?.cancel()
          if (!location || redirects >= 5) throw new ModelError('下载重定向缺少目标或超过 5 次，未保存文件')
          url = downloadUrl(new URL(location, url).href)
        }
        // 不接受局部内容或其他非完整成功响应。
        if (response.status !== 200 || !response.body) throw new ModelError(`下载失败：HTTP ${response.status}，未保存文件`)
        const lengthText = response.headers.get('content-length')
        const expectedLength = lengthText === null ? undefined : Number(lengthText)
        if (expectedLength !== undefined && (!/^\d+$/.test(lengthText!) || !Number.isSafeInteger(expectedLength) || expectedLength <= 0 || expectedLength > maxBytes)) throw new ModelError('下载响应长度无效、为空或超过大小上限，未保存文件')
        await validateOrdinaryPath(target)
        await check(target)
        await mkdir(path.dirname(target), { recursive: true })
        const candidate = path.join(path.dirname(target), `.pi-runner-download-${randomUUID()}.tmp`)
        const file = await open(candidate, 'wx', 0o600)
        temporary = candidate
        let bytes = 0
        let header = Buffer.alloc(0)
        const hash = createHash('sha256')
        try {
          reader = response.body.getReader()
          while (true) {
            downloadSignal.throwIfAborted()
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > maxBytes) throw new ModelError('下载内容超过大小上限，未保存文件')
            const buffer = Buffer.from(chunk.value)
            if (header.length < 16) header = Buffer.concat([header, buffer.subarray(0, 16 - header.length)])
            hash.update(buffer)
            await file.writeFile(buffer)
          }
          if (!bytes) throw new ModelError('下载内容为空，未保存文件')
          const encoding = response.headers.get('content-encoding')?.toLowerCase()
          if ((!encoding || encoding === 'identity') && expectedLength !== undefined && bytes !== expectedLength) throw new ModelError('下载内容长度与响应声明不一致，未保存文件')
          const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
          validateImage(header, contentType, target)
          const sha256 = hash.digest('hex')
          if (input.sha256 && sha256 !== String(input.sha256).toLowerCase()) throw new ModelError('下载内容 SHA-256 校验失败，未保存文件')
          await file.sync()
          await file.close()
          await validateOrdinaryPath(target)
          await check(target)
          const info = await lstat(target).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
          if (info && !info.isFile()) throw new ModelError('下载目标必须是普通文件路径')
          downloadSignal.throwIfAborted()
          await rename(temporary, target)
          temporary = undefined
          return { content: [{ type: 'text', text: `下载完成并通过校验：${target}（${bytes} 字节，SHA-256: ${sha256}）` }], details: { path: target, url: url.href, bytes, contentType, sha256 } }
        } finally { await file.close().catch(() => {}) }
      } catch (error) {
        if (downloadSignal.aborted) throw new ModelError('下载已取消或超过时间限制，未保存文件')
        if (error instanceof ModelError) throw error
        throw new ModelError('下载失败，请检查网络、URL 和目标路径；未保存文件')
      } finally {
        if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
        else await response?.body?.cancel().catch(() => {})
        if (temporary) await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
      }
    }
  }
}
