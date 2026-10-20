import { rm, rmdir, readFile, writeFile, mkdir, lstat } from 'node:fs/promises'
import { projectToolPath } from '../models/pi-tools'
import path from 'node:path'
import type { SimpleGit } from 'simple-git'
import { openSnapshotStorage, removeSnapshotStorage, type SnapshotStorage } from './snapshot-storage'
import { copyProjectFiles, invalidateProjectFileCapture } from './project-file-capture'
import { SnapshotFileRules } from './project-ignores'
import type { ChangedFile, Checkpoint, FileDiff } from '../../shared/api'
import { SnapshotReadCache } from './snapshot-read-cache'
import { randomUUID } from 'node:crypto'

/** 未发布的执行前恢复基线，通过独立引用保护，防止任务期间被 Git 回收。 */
export interface PendingCheckpoint extends Checkpoint { reference: string }

// 跨管理器实例复用缓存，包含存储路径，避免不同数据目录的项目相互串用。
const changesCache = new SnapshotReadCache<ChangedFile[]>(128, 4 * 1024 * 1024, value => JSON.stringify(value).length * 2)
const diffCache = new SnapshotReadCache<FileDiff>(64, 32 * 1024 * 1024, value => (value.before.length + value.after.length + (value.hunks?.join('').length ?? 0)) * 2)
const projectCachePrefix = (root: string): string => `${process.platform === 'win32' ? root.toLowerCase() : root}\0`

export class ShadowGitManager {
  private constructor(private readonly root: string, private readonly staging: string, private readonly git: SimpleGit, private readonly serialized: SnapshotStorage['serialized']) {}

  static async open(project: string, dataRoot: string): Promise<ShadowGitManager> {
    const storage = await openSnapshotStorage(project, dataRoot)
    return new ShadowGitManager(storage.root, storage.staging, storage.git, storage.serialized)
  }

  getRoot(): string { return this.root }

  static async removeProjectStorage(project: string, dataRoot: string): Promise<string> {
    const root = await removeSnapshotStorage(project, dataRoot)
    changesCache.clearPrefix(projectCachePrefix(root))
    diffCache.clearPrefix(projectCachePrefix(root))
    return root
  }

  createCheckpoint(label: string): Promise<Checkpoint> {
    return this.serialized(() => this.captureCheckpoint(label))
  }

  /** 只为可能写文件的操作保留基线，不向项目快照历史添加空轮次。 */
  prepareCheckpoint(): Promise<PendingCheckpoint> {
    return this.serialized(async () => {
      await this.stageProjectFiles()
      const tree = (await this.git.raw(['write-tree'])).trim()
      const label = '代理修改前'
      const hash = (await this.git.raw(['commit-tree', tree, '-m', label])).trim()
      const reference = `refs/pi-runner/pending/${randomUUID()}`
      await this.git.raw(['update-ref', reference, hash, '0'.repeat(40)])
      return { hash, reference, label, createdAt: new Date().toISOString() }
    })
  }

  /** 内容确有变化时才发布前后快照；无变化则释放本轮私有基线。失败时保留基线。 */
  completeCheckpoint(pending: PendingCheckpoint): Promise<{ before: Checkpoint; after: Checkpoint } | undefined> {
    return this.serialized(async () => {
      if (!/^refs\/pi-runner\/pending\/[a-f0-9-]{36}$/.test(pending.reference)) throw new Error('无效的任务快照基线')
      await this.validateCommit(pending.hash)
      if ((await this.git.revparse([pending.reference])).trim() !== pending.hash) throw new Error('任务快照基线已失效')
      await this.stageProjectFiles()
      const tree = (await this.git.raw(['write-tree'])).trim()
      const beforeTree = (await this.git.revparse([`${pending.hash}^{tree}`])).trim()
      if (tree === beforeTree) {
        await this.git.raw(['update-ref', '-d', pending.reference, pending.hash])
        return undefined
      }
      // 直接提交已采集的树，不重新扫描；并发产生的手动快照继续保留在父链中。
      const head = (await this.git.raw(['rev-parse', '--revs-only', 'HEAD'])).trim()
      const beforeHash = (await this.git.raw(['commit-tree', beforeTree, ...(head ? ['-p', head] : []), '-m', '代理修改前'])).trim()
      const afterHash = (await this.git.raw(['commit-tree', tree, '-p', beforeHash, '-m', '代理修改后'])).trim()
      await this.git.raw(['update-ref', 'HEAD', afterHash, head || '0'.repeat(40)])
      // 前后版本现已进入正式历史；清理失败不把已成功保存的改动误报为失败。
      try { await this.git.raw(['update-ref', '-d', pending.reference, pending.hash]) }
      catch { console.warn('任务快照已保存，临时基线引用清理失败') }
      return {
        before: { hash: beforeHash, label: '代理修改前', createdAt: pending.createdAt },
        after: { hash: afterHash, label: '代理修改后', createdAt: new Date().toISOString() }
      }
    })
  }

  /** 读取影子仓库的完整历史，包含手动快照与恢复前的保护快照。 */
  listCheckpoints(): Promise<Checkpoint[]> {
    return this.serialized(async () => {
      const history = await this.git.raw(['log', '--exclude=refs/pi-runner/pending/*', '--all', '-z', '--format=%H%x00%cI%x00%B'])
      const fields = history.split('\0')
      const checkpoints: Checkpoint[] = []
      for (let index = 0; index + 2 < fields.length; index += 3) {
        checkpoints.push({ hash: fields[index], createdAt: fields[index + 1], label: fields[index + 2].trim() })
      }
      return checkpoints
    })
  }

  private async captureCheckpoint(label: string): Promise<Checkpoint> {
    if (!label.trim() || label.length > 200) throw new Error('快照名称须为 1–200 个字符')
    await this.stageProjectFiles()
    await this.git.raw(['commit', '--quiet', '--allow-empty', '-m', label])
    return { hash: (await this.git.revparse(['HEAD'])).trim(), label, createdAt: new Date().toISOString() }
  }

  private async stageProjectFiles(): Promise<void> {
    try {
      await copyProjectFiles(this.root, this.staging)
      await this.git.raw(['add', '--all', '--force', '--', '.'])
    } catch (error) {
      invalidateProjectFileCapture(this.staging)
      throw error
    }
  }

  /** 按文件内容比较当前项目与各轮结果，不创建提交，也不修改项目文件。 */
  getMatchingCheckpoints(hashes: string[]): Promise<string[]> {
    return this.serialized(async () => {
      for (const hash of hashes) await this.validateCommit(hash)
      await this.stageProjectFiles()
      const currentTree = (await this.git.raw(['write-tree'])).trim()
      const matches: string[] = []
      for (const hash of hashes) {
        if ((await this.git.revparse([`${hash}^{tree}`])).trim() === currentTree) matches.push(hash)
      }
      return matches
    })
  }

  /** 将快照覆盖范围内的整个项目恢复到目标轮次，保留恢复前的保护快照。 */
  restoreCheckpoint(targetHash: string): Promise<Checkpoint> {
    return this.serialized(async () => {
      await this.validateCommit(targetHash)
      const safety = await this.captureCheckpoint('恢复到此轮结果前的保护快照')
      const changes = await new SnapshotFileRules(this.root).filter(await this.readChanges(safety.hash, targetHash))
      const targets = await Promise.all(changes.map(file => projectToolPath(this.root, file.path)))
      // 先读取全部目标内容，再触碰项目文件。所有 Git 操作仅针对影子仓库。
      invalidateProjectFileCapture(this.staging)
      await this.git.raw(['restore', `--source=${targetHash}`, '--worktree', '--', '.'])
      const contents = await Promise.all(changes.map(file => file.status === 'D' ? null : readFile(path.join(this.staging, file.path))))
      for (let index = 0; index < changes.length; index++) {
        if (contents[index] !== null) continue
        const target = targets[index]
        if (!(await lstat(target)).isFile()) throw new Error('恢复目标不是普通文件')
        await rm(target)
        // 只清理由后来新增文件留下的空目录，不移除未纳入快照的内容。
        let directory = path.dirname(target)
        while (directory !== this.root) {
          try { await rmdir(directory) }
          catch (error) {
            if (['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) break
            throw error
          }
          directory = path.dirname(directory)
        }
      }
      for (let index = 0; index < changes.length; index++) {
        if (contents[index] === null) continue
        await mkdir(path.dirname(targets[index]), { recursive: true })
        await writeFile(targets[index], contents[index]!)
      }
      return this.captureCheckpoint('已恢复到此轮对话结果')
    })
  }

  private async validateCommit(hash: string): Promise<void> {
    if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error('无效快照标识')
    await this.git.raw(['cat-file', '-e', `${hash}^{commit}`])
  }

  private cacheKey(base: string, current: string): string {
    return `${projectCachePrefix(this.root)}${this.staging}\0${base}\0${current}`
  }

  getChanges(base: string, current: string): Promise<ChangedFile[]> {
    return changesCache.get(this.cacheKey(base, current), () => this.serialized(() => this.readChanges(base, current))).then(value => structuredClone(value))
  }

  private async readChanges(base: string, current: string): Promise<ChangedFile[]> {
    // 验证失败时不能留下尚未结束的 Git 进程，让存储队列提前释放。
    await this.validateCommit(base)
    await this.validateCommit(current)
    const [raw, statusRaw] = await Promise.all([
      this.git.raw(['diff', '--numstat', '-z', '--no-renames', base, current, '--']),
      this.git.raw(['diff', '--name-status', '-z', '--no-renames', base, current, '--'])
    ])
    const parts = statusRaw.split('\0')
    const statuses = new Map<string, 'A' | 'M' | 'D'>()
    for (let i = 0; i + 1 < parts.length; i += 2) statuses.set(parts[i + 1], parts[i] as 'A' | 'M' | 'D')
    return raw.split('\0').filter(Boolean).map(record => {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record)
      if (!match) throw new Error('无法解析 Git 差异')
      const [, added, deleted, file] = match
      return { path: file, status: statuses.get(file) ?? 'M', additions: Number(added) || 0, deletions: Number(deleted) || 0, binary: added === '-' }
    })
  }

  getDiff(base: string, current: string, file: string): Promise<FileDiff> {
    return diffCache.get(`${this.cacheKey(base, current)}\0${file}`, () => this.readDiff(base, current, file)).then(value => structuredClone(value))
  }

  private async readDiff(base: string, current: string, file: string): Promise<FileDiff> {
    const changes = await this.getChanges(base, current)
    const change = changes.find(item => item.path === file)
    if (!change) throw new Error('文件不在此轮改动列表中')
    if (change.binary) return { path: file, before: '', after: '', binary: true }
    return this.serialized(async () => {
      // 保留全文以支持默认的上下文展开；直接传 Git 片段，界面无需再计算差异。
      const [before, after, patch] = await Promise.all([
        change.status === 'A' ? Promise.resolve('') : this.git.show([`${base}:${file}`]),
        change.status === 'D' ? Promise.resolve('') : this.git.show([`${current}:${file}`]),
        this.git.raw(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--unified=3', base, current, '--', `:(literal)${file}`])
      ])
      // 库解析器需要 --- / +++ 文件头，不能只截取 @@ 后的正文。
      return { path: file, binary: false, before, after, hunks: patch ? [patch] : [] }
    })
  }

  /** 保存回滚前快照；只恢复本轮改动，并拒绝覆盖本轮之后的手动修改。 */
  rollback(base: string, current: string): Promise<Checkpoint> {
    return this.serialized(async () => {
      const changes = await new SnapshotFileRules(this.root).filter(await this.readChanges(base, current))
      if (!changes.length) throw new Error('此轮没有需要回滚的文件改动')
      const safety = await this.captureCheckpoint('回滚前保护快照')
      const subsequent = await this.readChanges(current, safety.hash)
      if (subsequent.some(file => changes.some(change => change.path === file.path))) throw new Error('本轮文件已有后续改动，已保留保护快照；请先查看差异，避免覆盖手动修改')
      // 先验证所有路径，再恢复暂存区；Git 始终指向影子仓库。
      const targets = await Promise.all(changes.map(file => projectToolPath(this.root, file.path)))
      invalidateProjectFileCapture(this.staging)
      await this.git.raw(['restore', `--source=${base}`, '--worktree', '--', '.'])
      const contents = await Promise.all(changes.map(file => file.status === 'A' ? null : readFile(path.join(this.staging, file.path))))
      for (let index = 0; index < changes.length; index++) {
        const target = targets[index]
        if (contents[index] === null) {
          try { if (!(await lstat(target)).isFile()) throw new Error('回滚目标不是普通文件') }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          await rm(target, { force: true })
        } else {
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, contents[index]!)
        }
      }
      return this.captureCheckpoint('代理改动已回滚')
    })
  }
}
