import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { removeSandboxTemporaryDirectory } from './sandbox-temporary-directory'

interface CleanupRecord { moniker: string; project: string; scratch: string; identity: string; scratchIdentity?: string }
const identity = async (directory: string): Promise<string> => {
  const info = await stat(directory, { bigint: true })
  if (!info.isDirectory()) throw new Error(`权限清理目标必须是目录：${directory}`)
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`
}

/** 在授权前落盘；只回收本应用登记的随机身份，不重置项目的原有 ACL。 */
export class AppContainerCleanupStore {
  private active = new Set<string>()
  constructor(private readonly dataDirectory: string) {}
  private get directory(): string { return path.join(this.dataDirectory, 'appcontainer-cleanup') }
  private file(moniker: string): string { return path.join(this.directory, moniker + '.json') }
  async begin(moniker: string, project: string, scratch: string): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    this.active.add(moniker)
    const temporary = this.file(moniker) + '.' + randomUUID() + '.tmp'
    try {
      const record: CleanupRecord = { moniker, project, scratch, identity: await identity(project), scratchIdentity: await identity(scratch) }
      await writeFile(temporary, JSON.stringify(record), { flag: 'wx', flush: true })
      await rename(temporary, this.file(moniker))
    } catch (error) { this.release(moniker); throw error }
    finally { await rm(temporary, { force: true }).catch(() => {}) }
  }
  async validate(moniker: string): Promise<CleanupRecord> {
    const file = this.file(moniker)
    if ((await lstat(file)).isSymbolicLink()) throw new Error('清理记录不能是链接')
    const record: CleanupRecord = JSON.parse(await readFile(file, 'utf8'))
    if (!record || record.moniker !== moniker || ![record.project, record.scratch].every(value => typeof value === 'string' && path.isAbsolute(value) && path.parse(value).root !== value) || typeof record.identity !== 'string' || !path.basename(record.scratch).startsWith('pi-runner-ac-')) throw new Error('清理记录格式无效')
    const directories: Array<[string, string | undefined]> = [[record.project, record.identity], [record.scratch, record.scratchIdentity]]
    for (const [directory, expected] of directories) {
      const actual = await realpath(directory).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
      if (!actual) continue
      if (actual !== directory) throw new Error(`清理路径发生重定向：${directory}`)
      if (!expected || await identity(actual) !== expected) throw new Error(`待清理目录身份已变化或未经登记：${directory}`)
    }
    return record
  }
  release(moniker: string): void { this.active.delete(moniker) }
  async complete(moniker: string): Promise<void> {
    await rm(this.file(moniker), { force: true })
    this.release(moniker)
  }
  async recover(cleanup: (record: CleanupRecord) => Promise<void>, signal?: AbortSignal): Promise<string[]> {
    const warnings: string[] = []
    const entries = await readdir(this.directory).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    for (const name of entries) {
      signal?.throwIfAborted()
      if (!/^pi-runner\.[a-f0-9]{32}\.json$/.test(name)) continue
      const moniker = name.slice(0, -5)
      if (this.active.has(moniker)) continue
      const file = this.file(moniker)
      try {
        const record = await this.validate(moniker)
        await cleanup(record)
        await removeSandboxTemporaryDirectory(record.scratch, 'pi-runner-ac-')
        await this.complete(moniker)
      } catch (error) {
        signal?.throwIfAborted()
        warnings.push(`无法恢复 AppContainer 权限清理，记录保留在 ${file}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return warnings
  }
}
