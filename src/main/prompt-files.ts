import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { MAX_CUSTOM_PROMPT_LENGTH } from '../shared/models'

function atomicWrite(file: string, content: string, expected?: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', flush: true })
    if (expected !== undefined) {
      let latest = ''
      try { latest = readFileSync(file, 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (latest !== expected) throw new Error('提示词文件在保存期间发生变化，请重新加载或确认覆盖')
    }
    renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/** 协作实例之间互斥；外部编辑器仍依靠保存前的内容比较检测冲突。 */
function acquireLock(directory: string): () => void {
  mkdirSync(directory, { recursive: true })
  const lock = path.join(directory, 'prompt-files.lock')
  const owner = `${process.pid}:${randomUUID()}`
  try { writeFileSync(lock, owner, { encoding: 'utf8', flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const previous = readFileSync(lock, 'utf8')
    const pid = Number(previous.split(':')[0])
    let stale = false
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0) }
      catch (failure) { stale = (failure as NodeJS.ErrnoException).code === 'ESRCH' }
    } else stale = Date.now() - statSync(lock).mtimeMs > 30_000
    if (!stale || readFileSync(lock, 'utf8') !== previous) throw new Error('另一实例正在同步提示词，请稍后重试')
    unlinkSync(lock)
    writeFileSync(lock, owner, { encoding: 'utf8', flag: 'wx' })
  }
  return () => { if (existsSync(lock) && readFileSync(lock, 'utf8') === owner) unlinkSync(lock) }
}

export class PromptFiles {
  constructor(private readonly dataDirectory: string) {}

  access(project: unknown, legacy: unknown, save?: unknown, expected?: unknown): string {
    if (project !== null && (typeof project !== 'string' || !path.isAbsolute(project))) throw new Error('项目目录无效')
    const validate = (value: unknown): string => {
      if (typeof value !== 'string' || value.length > MAX_CUSTOM_PROMPT_LENGTH) throw new Error(`提示词必须为文本且不能超过 ${MAX_CUSTOM_PROMPT_LENGTH} 个字符`)
      return value
    }
    const file = path.join(project === null ? this.dataDirectory : project as string, 'AGENTS.md')
    const key = process.platform === 'win32' ? file.toLowerCase() : file
    const marker = path.join(this.dataDirectory, 'prompt-file-migrations.json')
    const release = acquireLock(this.dataDirectory)
    try {
      if (project !== null && !statSync(project as string).isDirectory()) throw new Error('项目目录不存在')
      const migrated: string[] = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : []
      if (!Array.isArray(migrated) || !migrated.every(item => typeof item === 'string')) throw new Error('提示词迁移记录无效')
      let content = ''
      let missing = false
      try { content = validate(readFileSync(file, 'utf8')) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        missing = true
      }
      if (project === null) mkdirSync(path.dirname(file), { recursive: true })
      if (save !== undefined) {
        if (typeof expected !== 'string' || content !== expected) throw new Error('提示词文件已变化，请重新加载或确认覆盖')
        content = validate(save)
        atomicWrite(file, content, expected as string)
      } else if (missing && !migrated.includes(key)) {
        content = validate(legacy)
        if (content) atomicWrite(file, content, '')
      }
      if (!migrated.includes(key)) {
        mkdirSync(this.dataDirectory, { recursive: true })
        atomicWrite(marker, JSON.stringify([...migrated, key]))
      }
      return content
    } catch (error) {
      throw new Error(`无法同步提示词文件 ${file}：${error instanceof Error ? error.message : String(error)}`)
    } finally { release() }
  }
}
