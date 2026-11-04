import { constants, type Stats } from 'node:fs'
import { copyFile, lstat, mkdir, opendir, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'
import { validateToolPathSyntax, within } from './security-paths'
import { validateToolInput } from './tool-inputs'
import { FileMutationUncertain } from './tool-execution-errors'

const schema = (properties: Record<string, unknown>, required: string[]): ToolDefinition['parameters'] => ({ type: 'object', properties, required, additionalProperties: false }) as ToolDefinition['parameters']
const targetPath = { type: 'string', minLength: 1, description: '确切的相对或绝对路径，不展开通配符' }
const result = (text: string, details: unknown = {}) => ({ content: [{ type: 'text' as const, text }], details })
type PathGuard = (target: string) => Promise<void>
interface Progress { started: boolean; completed: number; stage: string }
interface CopiedEntry { source: string; info: Stats }

/** 逐层检查实际路径；允许创建目标尚不存在，但不接受链接和特殊文件。 */
export async function validateOrdinaryPath(target: string, mustExist = false): Promise<void> {
  validateToolPathSyntax(target)
  target = path.resolve(target)
  let current = target
  while (true) {
    const info = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !(mustExist && current === target)) return undefined
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ModelError('目标不存在，请先查找并确认具体路径')
      throw error
    })
    if (info?.isSymbolicLink()) throw new ModelError('文件和目录工具不能访问符号链接或目录联接')
    if (info && !info.isFile() && !info.isDirectory()) throw new ModelError('文件和目录工具不能访问特殊文件')
    if (info && current !== target && !info.isDirectory()) throw new ModelError('目标的父路径不是目录')
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

/** 修改前检查完整目录树；深度和数量上限也在产生副作用前检查。 */
export async function validateOrdinaryTree(target: string, check: PathGuard, signal?: AbortSignal): Promise<void> {
  let count = 0
  const visit = async (current: string, depth: number): Promise<void> => {
    signal?.throwIfAborted()
    if (++count > 100000 || depth > 128) throw new ModelError('目录树超过 100000 项或 128 层，请缩小操作范围')
    await validateOrdinaryPath(current, true)
    await check(current)
    if ((await lstat(current)).isDirectory()) {
      for await (const entry of await opendir(current)) await visit(path.join(current, entry.name), depth + 1)
    }
  }
  await visit(target, 0)
}

async function removeDirectory(target: string, recursive: boolean, check: PathGuard, progress: Progress, signal?: AbortSignal, depth = 0): Promise<void> {
  signal?.throwIfAborted()
  if (progress.completed >= 100000 || depth > 128) throw new ModelError('操作期间目录树超过数量或深度上限，已停止删除')
  await validateOrdinaryPath(target, true)
  await check(target)
  if (!(await lstat(target)).isDirectory()) throw new ModelError('rmdir 只允许删除目录，删除文件请使用 delete')
  if (recursive) {
    for await (const entry of await opendir(target)) {
      const child = path.join(target, entry.name)
      await validateOrdinaryPath(child, true)
      await check(child)
      if ((await lstat(child)).isDirectory()) await removeDirectory(child, true, check, progress, signal, depth + 1)
      else {
        signal?.throwIfAborted()
        if (progress.completed >= 100000) throw new ModelError('操作期间目录树超过数量上限，已停止删除')
        progress.started = true
        await unlink(child)
        progress.completed++
      }
    }
  }
  signal?.throwIfAborted()
  progress.started = true
  await rmdir(target)
  progress.completed++
}

/** 每个目标均使用独占创建，不使用可能覆盖竞争目标的 rename。 */
async function copyOrdinary(source: string, destination: string, check: PathGuard, progress: Progress, manifest: CopiedEntry[], signal?: AbortSignal, depth = 0): Promise<void> {
  signal?.throwIfAborted()
  if (manifest.length >= 100000 || depth > 128) throw new ModelError('操作期间目录树超过数量或深度上限，已停止复制')
  await validateOrdinaryPath(source, true)
  await validateOrdinaryPath(destination)
  await check(source)
  await check(destination)
  const info = await lstat(source)
  progress.started = true
  if (info.isDirectory()) {
    await mkdir(destination, { mode: info.mode & 0o777 })
    progress.completed++
    manifest.push({ source, info })
    for await (const entry of await opendir(source)) await copyOrdinary(path.join(source, entry.name), path.join(destination, entry.name), check, progress, manifest, signal, depth + 1)
  } else {
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    progress.completed++
    manifest.push({ source, info })
  }
}

function sameSource(before: Stats, after: Stats, identityOnly = false): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.isDirectory() === after.isDirectory()
    && (identityOnly || before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.mode === after.mode)
}

/** 移动只删除已复制且未改变的源项目，不递归删除后来新增的文件。 */
async function removeCopiedSource(manifest: CopiedEntry[], check: PathGuard, progress: Progress, signal?: AbortSignal): Promise<void> {
  for (const entry of manifest) {
    signal?.throwIfAborted()
    await validateOrdinaryPath(entry.source, true)
    await check(entry.source)
    if (!sameSource(entry.info, await lstat(entry.source))) throw new ModelError('复制期间源内容发生变化，已保留源路径和目标副本，请核对后处理')
  }
  progress.stage = 'remove_source'
  for (const entry of [...manifest].reverse()) {
    signal?.throwIfAborted()
    await validateOrdinaryPath(entry.source, true)
    await check(entry.source)
    if (!sameSource(entry.info, await lstat(entry.source), entry.info.isDirectory())) throw new ModelError('删除源项目之前发现路径或内容变化，已停止移动，请核对两端')
    if (entry.info.isDirectory()) await rmdir(entry.source)
    else await unlink(entry.source)
    progress.completed++
  }
}

export function filesystemToolDefinitions(check: PathGuard): ToolDefinition[] {
  const tools: ToolDefinition[] = [{
    name: 'mkdir', label: '创建目录', executionMode: 'sequential',
    description: '创建目录及缺少的父目录，已有目录无需重复创建；失败可能已创建部分父目录，应先用 stat 核对。',
    parameters: schema({ path: targetPath }, ['path']),
    execute: async (_id, args, signal) => {
      const { path: target } = validateToolInput('mkdir', args) as { path: string }
      await validateOrdinaryPath(target)
      await check(target)
      signal?.throwIfAborted()
      try { await mkdir(target, { recursive: true }) }
      catch (error) { throw new FileMutationUncertain(`创建目录失败，可能已创建部分父目录；先用 stat 核对，不要原样重试：${error instanceof Error ? error.message : String(error)}`) }
      return result(`已创建目录：${target}`, { path: target })
    }
  }, {
    name: 'rmdir', label: '删除目录', executionMode: 'sequential',
    description: '删除确切路径的目录；非空目录必须显式设置 recursive=true。不会删除项目根目录、内部数据、Git 元数据、链接或特殊文件。递归删除不是事务，失败或取消可能已删除部分内容，应先核对，不能假定已回滚。',
    parameters: schema({ path: targetPath, recursive: { type: 'boolean', description: '是否删除目录及其全部内容，默认 false' } }, ['path']),
    execute: async (_id, args, signal) => {
      const { path: target, recursive } = validateToolInput('rmdir', args) as { path: string; recursive?: boolean }
      await validateOrdinaryTree(target, check, signal)
      const progress: Progress = { started: false, completed: 0, stage: 'remove' }
      try { await removeDirectory(target, recursive === true, check, progress, signal) }
      catch (error) {
        if (progress.started) throw new FileMutationUncertain(`删除可能已部分完成（已删除 ${progress.completed} 项）：${target}；${error instanceof Error ? error.message : String(error)}。先用 stat/find 核对，不要原样重试。`)
        throw error
      }
      return result(`已删除目录：${target}`, { path: target, removed: progress.completed })
    }
  }, {
    name: 'stat', label: '查看文件或目录信息',
    description: '查看文件或目录的类型、字节大小和修改时间。查看目录内容用 ls，查找文件或目录用 find，读取文件内容用 read。',
    parameters: schema({ path: targetPath }, ['path']),
    execute: async (_id, args, signal) => {
      const { path: target } = validateToolInput('stat', args) as { path: string }
      await validateOrdinaryPath(target, true)
      await check(target)
      signal?.throwIfAborted()
      const info = await lstat(target)
      const details = { path: target, type: info.isDirectory() ? 'directory' : 'file', size: info.size, modifiedAt: info.mtime.toISOString() }
      return result(JSON.stringify(details), details)
    }
  }]
  for (const name of ['move', 'copy'] as const) tools.push({
    name, label: name === 'move' ? '移动或重命名' : '复制文件或目录', executionMode: 'sequential',
    description: `${name === 'move' ? '移动' : '复制'}普通文件或整个目录，path 是源路径，destination 是确切的新路径。目标必须不存在，独占创建，不覆盖或合并已有内容。${name === 'move' ? '移动通过复制、核对源内容后删除已复制源项目完成，支持跨文件系统，但不是原子重命名。' : ''}失败或取消可能留下部分目标，移动也可能保留两份或部分源内容；先用 stat/find 核对，不要原样重试或自动删除残留。`,
    parameters: schema({ path: targetPath, destination: targetPath }, ['path', 'destination']),
    execute: async (_id, args, signal) => {
      const { path: source, destination } = validateToolInput(name, args) as { path: string; destination: string }
      if (within(path.resolve(source), path.resolve(destination)) || within(path.resolve(destination), path.resolve(source))) throw new ModelError('源路径和目标路径不能相同或互相包含')
      await validateOrdinaryTree(source, check, signal)
      await validateOrdinaryPath(destination)
      await check(destination)
      const existing = await lstat(destination).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
      if (existing) throw new ModelError('目标已存在，请选择新的路径，工具不会覆盖已有内容')
      signal?.throwIfAborted()
      const progress: Progress = { started: false, completed: 0, stage: 'create_parents' }
      try {
        progress.started = true
        await mkdir(path.dirname(destination), { recursive: true })
        progress.stage = 'copy'
        const manifest: CopiedEntry[] = []
        await copyOrdinary(source, destination, check, progress, manifest, signal)
        if (name === 'move') await removeCopiedSource(manifest, check, progress, signal)
      } catch (error) {
        if (progress.started) throw new FileMutationUncertain(`操作可能已部分完成：${JSON.stringify({ operation: name, path: source, destination, stage: progress.stage, completed: progress.completed })}；${error instanceof Error ? error.message : String(error)}。先核对两端，不要原样重试或自动删除残留。`)
        throw error
      }
      return result(`已${name === 'move' ? '移动' : '复制'}：${source} → ${destination}`, { path: source, destination, completed: progress.completed })
    }
  })
  return tools
}
