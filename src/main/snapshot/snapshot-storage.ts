import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { invalidateProjectFileCapture } from './project-file-capture'

export interface SnapshotStorage {
  root: string
  staging: string
  git: SimpleGit
  serialized<T>(operation: () => Promise<T>): Promise<T>
}

// 同一影子仓库的初始化和文件操作共用队列，跨管理器实例也不会争用 Git 锁。
const storageQueues = new Map<string, Promise<unknown>>()
function serializeStorage<T>(metadata: string, operation: () => Promise<T>): Promise<T> {
  const key = canonicalPath(metadata)
  const result = (storageQueues.get(key) ?? Promise.resolve()).then(operation)
  const settled = result.then(() => undefined, () => undefined)
  storageQueues.set(key, settled)
  void settled.then(() => { if (storageQueues.get(key) === settled) storageQueues.delete(key) })
  return result
}

async function ensureSafeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  const info = await lstat(directory)
  const actual = await realpath(directory)
  const expectedPath = process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory)
  const actualPath = process.platform === 'win32' ? actual.toLowerCase() : actual
  if (!info.isDirectory() || info.isSymbolicLink() || actualPath !== expectedPath) {
    throw new Error('Pi Runner 数据目录不能是符号链接或联接点')
  }
}

function projectStoragePath(root: string, dataRoot: string): string {
  const identity = process.platform === 'win32' ? root.toLowerCase() : root
  const hash = createHash('sha256').update(identity).digest('hex')
  return path.join(dataRoot, 'projects', hash)
}

function canonicalPath(directory: string): string {
  return process.platform === 'win32' ? directory.toLowerCase() : directory
}

async function migrateLegacyProjectStorage(metadata: string, dataRoot: string): Promise<void> {
  try {
    await lstat(metadata)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const legacyProjects = path.join(dataRoot, 'workspaces')
    try {
      const legacyParentInfo = await lstat(legacyProjects)
      const legacyParentReal = await realpath(legacyProjects)
      if (!legacyParentInfo.isDirectory() || legacyParentInfo.isSymbolicLink() || canonicalPath(legacyParentReal) !== canonicalPath(legacyProjects)) {
        throw new Error('旧项目数据目录不安全，无法迁移')
      }
      const legacyMetadata = path.join(legacyProjects, path.basename(metadata))
      const legacyInfo = await lstat(legacyMetadata)
      const legacyReal = await realpath(legacyMetadata)
      if (!legacyInfo.isDirectory() || legacyInfo.isSymbolicLink() || canonicalPath(legacyReal) !== canonicalPath(legacyMetadata)) {
        throw new Error('旧项目数据目录不安全，无法迁移')
      }
      await rename(legacyMetadata, metadata)
    } catch (legacyError) {
      if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError
    }
  }
}

function createSnapshotGit(root: string, repository: string, staging: string): SimpleGit {
  const allowedEnvironment = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'])
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => allowedEnvironment.has(key.toUpperCase()) && value !== undefined)) as Record<string, string>
  return simpleGit({
    baseDir: root,
    maxConcurrentProcesses: 1,
    trimmed: false,
    // Fixed null path disables hooks, including on Git for Windows. Never accept a caller-supplied path.
    unsafe: { allowUnsafeHooksPath: true, allowUnsafeConfigPaths: true },
    config: ['core.autocrlf=false', 'core.safecrlf=false', 'core.hooksPath=/dev/null', 'commit.gpgsign=false', 'user.name=Pi Runner', 'user.email=snapshot@pi-runner.local'],
  }).env({
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_DIR: repository,
    GIT_WORK_TREE: staging,
  })
}

export async function openSnapshotStorage(project: string, dataRoot: string): Promise<SnapshotStorage> {
  const root = await realpath(project)
  if (!(await lstat(root)).isDirectory()) throw new Error('项目必须是目录')

  const base = path.resolve(dataRoot)
  await ensureSafeDirectory(base)
  await ensureSafeDirectory(path.join(base, 'projects'))

  const metadata = projectStoragePath(root, base)
  return serializeStorage(metadata, async () => {
    await migrateLegacyProjectStorage(metadata, base)
    await ensureSafeDirectory(metadata)

    const repository = path.join(metadata, 'shadow-git')
    const staging = path.join(metadata, 'staging')
    await ensureSafeDirectory(repository)
    await ensureSafeDirectory(staging)

    const git = createSnapshotGit(root, repository, staging)
    await git.raw(['init', '--quiet'])
    // 影子仓库属性优先于项目复制过来的 .gitattributes。
    await writeFile(path.join(repository, 'info', 'attributes'), '* -text -filter -ident -working-tree-encoding\n')
    return { root, staging, git, serialized: <T>(operation: () => Promise<T>) => serializeStorage(metadata, operation) }
  })
}

async function removeStorageDirectory(target: string, errorMessage: string): Promise<void> {
  try {
    const info = await lstat(target)
    const actual = await realpath(target)
    if (!info.isDirectory() || info.isSymbolicLink() || canonicalPath(actual) !== canonicalPath(target)) throw new Error(errorMessage)
    await rm(target, { recursive: true, force: false })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function removeLegacyProjectStorage(target: string, dataRoot: string): Promise<void> {
  const legacyProjects = path.join(dataRoot, 'workspaces')
  try {
    const legacyParentInfo = await lstat(legacyProjects)
    const legacyParentReal = await realpath(legacyProjects)
    if (!legacyParentInfo.isDirectory() || legacyParentInfo.isSymbolicLink() || canonicalPath(legacyParentReal) !== canonicalPath(legacyProjects)) {
      throw new Error('旧项目数据目录不安全，无法移除')
    }
    await removeStorageDirectory(path.join(legacyProjects, path.basename(target)), '旧项目数据目录不安全，无法移除')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function removeSnapshotStorage(project: string, dataRoot: string): Promise<string> {
  let root: string
  try {
    root = await realpath(project)
    if (!(await lstat(root)).isDirectory()) throw new Error('项目必须是目录')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    root = path.resolve(project)
  }

  const base = path.resolve(dataRoot)
  await ensureSafeDirectory(base)
  const projects = path.join(base, 'projects')
  try {
    await ensureSafeDirectory(projects)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return root
    throw error
  }

  const target = projectStoragePath(root, base)
  await serializeStorage(target, async () => {
    invalidateProjectFileCapture(path.join(target, 'staging'))
    await removeStorageDirectory(target, 'Pi Runner 项目数据目录不能是符号链接或联接点')
    await removeLegacyProjectStorage(target, base)
  })
  return root
}
