import { app, net } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { validateOrdinaryPath } from './filesystem-tools'
import { ModelError } from './model-validation'
import { FileMutationUncertain } from './tool-execution-errors'
import { validateToolPathSyntax } from './security-paths'
import { pick, type PromptLang } from '../../shared/prompt-lang'

const MAX_BYTES = 64 * 1024 * 1024
const TIMEOUT_MS = 60000
const imageTypes: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }

export class DownloadFailure extends ModelError {
  constructor(message: string, readonly code: string) { super(message) }
}

/** 即使网络或流未及时响应 signal，也不能让等待永久挂起。 */
function downloadAwait<T>(pending: Promise<T>, signal: AbortSignal, discard?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const abort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new Error('下载已取消'))
    }
    signal.addEventListener('abort', abort, { once: true })
    pending.then(value => {
      if (settled) { try { discard?.(value) } catch { /* 迟到响应只清理资源。 */ } return }
      settled = true
      signal.removeEventListener('abort', abort)
      resolve(value)
    }, error => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    if (signal.aborted) abort()
  })
}

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
  validateToolPathSyntax(args.path)
  if (args.sha256 !== undefined && (typeof args.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(args.sha256))) throw new ModelError('SHA-256 必须为 64 位十六进制字符串')
}

async function validateDownloadTarget(target: string): Promise<void> {
  validateToolPathSyntax(target)
  await validateOrdinaryPath(target)
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return undefined })
  if (info && !info.isFile()) throw new ModelError('下载目标必须是普通文件路径')
}

function validateImage(header: Buffer, contentType: string, target: string): void {
  const expected = imageTypes[path.extname(target).toLowerCase()]
  const actual = contentType === 'image/jpg' ? 'image/jpeg' : ['image/x-bmp', 'image/x-ms-bmp'].includes(contentType) ? 'image/bmp' : contentType
  if (expected && actual && actual !== 'application/octet-stream' && actual !== expected) throw new ModelError('下载响应类型与目标图片扩展名不一致，未保存文件')
  const type = expected ?? actual
  const valid = type === 'image/jpeg' ? header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    : type === 'image/png' ? header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : type === 'image/gif' ? /^GIF8[79]a$/.test(header.toString('ascii', 0, 6))
        : type === 'image/webp' ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
          : type === 'image/bmp' ? header.toString('ascii', 0, 2) === 'BM' : true
  if (!valid) throw new ModelError('下载内容未通过图片文件头校验，未保存文件')
}

/** 临时文件必须与目标同盘以原子替换；完整校验及路径复查通过后才提交。 */
export function createDownloadToolDefinition(check: (target: string) => Promise<void>, options: { maxBytes?: number; timeoutMs?: number } = {}, lang: PromptLang = 'zh'): ToolDefinition {
  const maxBytes = options.maxBytes ?? MAX_BYTES
  return {
    name: 'download', label: pick(lang, '下载文件', 'Download file'), executionMode: 'sequential',
    description: pick(lang, '从 HTTP/HTTPS URL 下载图片或其他二进制文件到 path，Windows/macOS/Linux 均使用此工具。使用 Electron 网络栈及系统代理，自动跟随重定向（次数由 Chromium 限制），60 秒超时，上限 64 MiB；校验状态码、非空内容与长度；图片文件另校验文件头，可提供 sha256 验证完整性。校验通过才保存；目标已存在会替换，替换前失败或取消保留原文件，已替换则返回成功。清理警告不算失败，不要重复下载。不要用 write 写图片字节，也不要用 Invoke-WebRequest -OutFile、BITS、certutil、curl -o/-O、wget 或 aria2c 下载落盘。', 'Download an image or other binary file from an HTTP/HTTPS URL to path; use this tool on Windows/macOS/Linux. Uses Electron networking and system proxy settings; follows redirects within the Chromium redirect limit, 60-second timeout, 64 MiB cap; validates status code, non-empty content, and length, accepts sha256 for integrity, and for image files additionally validates headers. Saves only after validation passes; an existing target is replaced, failure or cancel before replacement keeps the original file, and a completed replacement returns success. Cleanup warnings are not failures — do not re-download. Do not write image bytes with write, and do not download to disk with Invoke-WebRequest -OutFile, BITS, certutil, curl -o/-O, wget, or aria2c.'),
    parameters: { type: 'object', properties: {
      url: { type: 'string', minLength: 1, description: pick(lang, '完整 HTTP/HTTPS 下载地址', 'Full HTTP/HTTPS download URL') },
      path: { type: 'string', minLength: 1, description: pick(lang, '保存文件的确切相对或绝对路径', 'Exact relative or absolute path to save the file') },
      sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$', description: pick(lang, '可选：可信来源提供的预期 SHA-256，不要猜测', 'Optional: expected SHA-256 from a trusted source; do not guess') }
    }, required: ['url', 'path'], additionalProperties: false } as ToolDefinition['parameters'],
    execute: async (_id, args, signal) => {
      const input = structuredClone(args) as Record<string, unknown>
      validateDownloadArgs(input)
      const target = String(input.path)
      const downloadSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)])
      const warnings: string[] = []
      const output: { type: 'text'; text: string }[] = []
      let failure: Error | undefined
      let committed = false
      let temporary: string | undefined
      let response: Response | undefined
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        downloadSignal.throwIfAborted()
        await validateDownloadTarget(target)
        await check(target)
        await downloadAwait(app.whenReady(), downloadSignal)
        const url = downloadUrl(input.url)
        // Electron 的 manual 模式会取消重定向，交由 Chromium 跟随并限制次数。
        // 不使用会话 Cookie、认证凭据、自定义协议处理器或 Referer。
        response = await downloadAwait(net.fetch(url.href, {
          method: 'GET', redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer',
          bypassCustomProtocolHandlers: true, signal: downloadSignal
        }), downloadSignal, late => { void late.body?.cancel().catch(() => {}) })
        const finalUrl = response.url ? downloadUrl(response.url) : url
        if (response.status !== 200 || !response.body) throw new DownloadFailure(`下载失败：HTTP ${response.status}，未保存文件`, 'DOWNLOAD_HTTP_ERROR')
        const lengthText = response.headers.get('content-length')
        const expectedLength = lengthText === null ? undefined : Number(lengthText)
        if (expectedLength !== undefined && (!/^\d+$/.test(lengthText!) || !Number.isSafeInteger(expectedLength) || expectedLength <= 0 || expectedLength > maxBytes)) throw new ModelError('下载响应长度无效、为空或超过大小上限，未保存文件')
        await validateDownloadTarget(target)
        await check(target)
        downloadSignal.throwIfAborted()
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
            const chunk = await downloadAwait(reader.read(), downloadSignal)
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
          await validateDownloadTarget(target)
          await check(target)
          downloadSignal.throwIfAborted()
          await rename(temporary, target)
          committed = true
          temporary = undefined
          output.push({ type: 'text', text: `下载完成并通过校验：${target}（${bytes} 字节，SHA-256: ${sha256}）` })
          return { content: output, details: { path: target, url: finalUrl.href, bytes, contentType, sha256, warnings } }
        } finally { await file.close().catch(() => {}) }
      } catch (error) {
        const timedOut = downloadSignal.reason?.name === 'TimeoutError'
        failure = committed ? new FileMutationUncertain('下载目标已替换，但结果生成失败；请先核对文件，不要直接重试')
          : downloadSignal.aborted ? new DownloadFailure(timedOut ? '下载超过时间限制，未保存文件' : '下载已取消，未保存文件', timedOut ? 'DOWNLOAD_TIMEOUT' : 'DOWNLOAD_CANCELLED')
            : error instanceof ModelError ? error : new DownloadFailure(`下载失败：${error instanceof Error ? error.message : '未知错误'}；请检查网络、URL 和目标路径；未保存文件`, 'DOWNLOAD_FAILED')
        throw failure
      } finally {
        // 清理失败不能覆盖原始错误，也不能把成功替换误报为下载失败。
        try {
          const cancellation = reader ? reader.cancel() : response?.body?.cancel()
          if (cancellation) await downloadAwait(cancellation, AbortSignal.timeout(1000))
        } catch { warnings.push('响应流清理未完成；不要因此重复下载') }
        try { reader?.releaseLock() } catch { warnings.push('响应流锁释放失败') }
        if (temporary) {
          try { await unlink(temporary) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`临时下载文件清理失败：${temporary}`) }
        }
        if (warnings.length) {
          if (failure) failure.message += `；清理警告：${warnings.join('；')}`
          else output.push({ type: 'text', text: `清理警告：${warnings.join('；')}。文件已保存，无需重复下载。` })
        }
      }
    }
  }
}
