import { withSharedFileLock } from './shared-file-lock'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Credential, CredentialStore, AuthOperationOptions } from '@earendil-works/pi-ai'
import type { CredentialCipher } from './model-settings-store'
import { ModelError } from './model-validation'

/** 订阅凭证仅在主进程解密；续期和退出共用同一写入队列。 */
export class ChatgptCredentials implements CredentialStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string, private readonly cipher: CredentialCipher) {}
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => withSharedFileLock(this.file, action))
    this.queue = result.catch(() => undefined)
    return result
  }
  private async load(): Promise<Credential | undefined> {
    let data: Buffer
    try { data = await readFile(this.file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new ModelError('无法读取 ChatGPT 授权，请检查应用数据目录权限')
    }
    if (!this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法读取 ChatGPT 授权')
    try {
      if (data.length > 128 * 1024) throw new Error()
      const value = JSON.parse(this.cipher.decrypt(data))
      if (value.type !== 'oauth' || typeof value.access !== 'string' || !value.access || typeof value.refresh !== 'string' || !value.refresh || !Number.isFinite(value.expires)) throw new Error()
      return value as Credential
    } catch { throw new ModelError('ChatGPT 授权解密失败，请退出账号后重新授权') }
  }
  read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    return this.serialized(async () => { options?.signal?.throwIfAborted(); return providerId === 'openai-codex' ? this.load() : undefined })
  }
  async list(options?: AuthOperationOptions) { return await this.read('openai-codex', options) ? [{ providerId: 'openai-codex', type: 'oauth' as const }] : [] }
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions): Promise<Credential | undefined> {
    return this.serialized(async () => {
      if (providerId !== 'openai-codex') throw new ModelError('不支持的订阅供应商')
      options?.signal?.throwIfAborted()
      const current = await this.load()
      const next = await fn(current)
      options?.signal?.throwIfAborted()
      if (!next) return current
      if (next.type !== 'oauth' || !this.cipher.isAvailable()) throw new ModelError('系统安全存储不可用，无法保存 ChatGPT 授权；不会以明文保存')
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try {
        const data = this.cipher.encrypt(JSON.stringify(next))
        await mkdir(path.dirname(this.file), { recursive: true })
        await writeFile(temporary, data, { flag: 'wx', mode: 0o600 })
        options?.signal?.throwIfAborted()
        await rename(temporary, this.file)
      } catch { throw new ModelError('ChatGPT 授权保存失败，请检查系统安全存储和数据目录权限') }
      finally { await rm(temporary, { force: true }).catch(() => undefined) }
      return next
    })
  }
  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.serialized(async () => { options?.signal?.throwIfAborted(); if (providerId === 'openai-codex') await rm(this.file, { force: true }) })
  }
}
