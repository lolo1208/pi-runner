import { cp, lstat, mkdir, rename, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { profileId } from './model-validation'

/** Per-conversation workspaces live beside app data, separate from durable history. */
export class ConversationWorkspace {
  private readonly root: string
  private readonly legacyRoot: string

  constructor(dataDirectory: string) {
    const normalizedDataDirectory = path.resolve(dataDirectory)
    this.root = path.join(normalizedDataDirectory, 'ordinary-workspaces')
    const appId = createHash('sha256').update(normalizedDataDirectory).digest('hex')
    this.legacyRoot = path.resolve(os.tmpdir(), 'pi-runner-conversations', appId)
  }

  private directory(id: string): string {
    const target = path.resolve(this.root, createHash('sha256').update(profileId(id)).digest('hex'))
    if (path.dirname(target) !== this.root) throw new Error('普通对话工作目录超出应用数据目录')
    return target
  }

  async ensure(id: string): Promise<string> {
    const target = this.directory(id)
    await mkdir(this.root, { recursive: true })
    try {
      await lstat(target)
      return target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const legacy = path.join(this.legacyRoot, createHash('sha256').update(profileId(id)).digest('hex'))
    try {
      await rename(legacy, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        try { await cp(legacy, target, { recursive: true, errorOnExist: true, force: false }) }
        catch (copyError) {
          await rm(target, { recursive: true, force: true })
          throw copyError
        }
        await rm(legacy, { recursive: true, force: true })
      } else if ((error as NodeJS.ErrnoException).code === 'EEXIST' || (error as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
        return target
      } else if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await mkdir(target, { recursive: true })
      } else throw error
    }
    return target
  }

  async remove(id: string): Promise<void> {
    await rm(this.directory(id), { recursive: true, force: true })
  }
}
