import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SandboxBackend } from '../../shared/sandbox'
import { ModelError } from './model-validation'

interface VerificationRecord { backend: SandboxBackend; identity?: string; fingerprint?: string; verifiedAt: string; developerNetwork?: boolean; warning?: string }
interface VerificationCache { version: 3; backend?: SandboxBackend; projects: Record<string, VerificationRecord> }
const verifiedBackends = ['mxc', 'appcontainer', 'seatbelt']

/** 所有系统共用记录格式、原子写入、旧记录迁移和目录身份恢复；通过证明仍对应实际后端。 */
export class SandboxVerificationStore {
  private writes: Promise<unknown> = Promise.resolve()
  constructor(private readonly dataDirectory: string) {}
  private get file(): string { return path.join(this.dataDirectory, 'safe-execution.json') }
  private async read(): Promise<VerificationCache> {
    try {
      const record = JSON.parse(await readFile(this.file, 'utf8'))
      const projects: VerificationCache['projects'] = {}
      if ([2, 3].includes(record.version) && record.projects && typeof record.projects === 'object') {
        for (const [root, entry] of Object.entries(record.projects) as [string, VerificationRecord][]) {
          if (entry && verifiedBackends.includes(entry.backend) && Number.isFinite(Date.parse(entry.verifiedAt)) && (typeof entry.identity === 'string' || typeof entry.fingerprint === 'string')) projects[root] = entry
        }
      }
      return { version: 3, backend: record.backend, projects }
    } catch { return { version: 3, projects: {} } }
  }
  private async identity(project: string): Promise<string> {
    const directory = await stat(project, { bigint: true })
    if (!directory.isDirectory()) throw new ModelError('项目路径必须是目录')
    return `${directory.dev}:${directory.ino}:${directory.birthtimeNs}`
  }
  private update(update: (cache: VerificationCache) => void | false): Promise<void> {
    const pending = this.writes.then(async () => {
      const cache = await this.read()
      if (update(cache) === false) return
      await mkdir(this.dataDirectory, { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(cache) + '\n', 'utf8')
      await rename(temporary, this.file)
    })
    this.writes = pending.catch(() => {})
    return pending
  }
  async restore(project: string, compatible: (backend: unknown) => boolean): Promise<{ record?: VerificationRecord; backend?: SandboxBackend }> {
    const identity = await this.identity(project), cache = await this.read()
    let record: VerificationRecord | undefined = cache.projects[project], previous = project
    if (record && (!compatible(record.backend) || record.identity && record.identity !== identity)) record = undefined
    if (!record) {
      const moved = Object.entries(cache.projects).find(([, entry]) => compatible(entry.backend) && entry.identity === identity)
      if (moved) [previous, record] = moved
    }
    if (record && (previous !== project || !record.identity)) {
      const restored = record
      await this.update(cache => {
        // 异步恢复不能重新写入已撤销或已被其他检查更新的证明。
        if (cache.projects[previous]?.verifiedAt !== restored.verifiedAt) { record = undefined; return false }
        cache.projects[project] = { ...restored, identity }
        if (previous !== project) delete cache.projects[previous]
      })
    }
    // 新项目独立探测，不继承其他项目曾经选中的后端。
    return { record, backend: record?.backend }
  }
  async save(project: string, backend: SandboxBackend, signal?: AbortSignal, capabilities: { developerNetwork?: boolean; warning?: string; fingerprint?: string } = {}): Promise<void> {
    const identity = await this.identity(project)
    await this.update(cache => { signal?.throwIfAborted(); delete cache.backend; cache.projects[project] = { backend, identity, verifiedAt: new Date().toISOString(), ...capabilities } })
  }
  revoke(project: string): Promise<void> {
    return this.update(cache => { if (!cache.projects[project]) return false; delete cache.projects[project] })
  }
  async rebind(previous: string, project: string): Promise<void> {
    previous = await realpath(previous).catch(() => path.resolve(previous))
    project = await realpath(project)
    const identity = await this.identity(project)
    await this.update(cache => {
      const entry = cache.projects[previous]
      if (!entry || previous === project) return false
      // 只有同一目录的移动才允许迁移配置，不能给另一个目录签发旧证明。
      if (entry.identity === identity) cache.projects[project] = { ...entry }
      else delete cache.projects[project]
      delete cache.projects[previous]
    })
  }
}
