import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'

const schema = (properties: Record<string, unknown>, required: string[]): ToolDefinition['parameters'] => ({ type: 'object', properties, required, additionalProperties: false }) as ToolDefinition['parameters']
const targetPath = { type: 'string', minLength: 1, description: '确切的相对或绝对路径，不展开通配符' }
const result = (text: string, details: unknown = {}) => ({ content: [{ type: 'text' as const, text }], details })

/** 逐层检查实际路径；允许创建目标尚不存在，但不接受链接和特殊文件。 */
export async function validateOrdinaryPath(target: string, mustExist = false): Promise<void> {
  let current = target
  while (true) {
    const info = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !(mustExist && current === target)) return undefined
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ModelError('目标不存在，请先查找并确认具体路径')
      throw error
    })
    if (info?.isSymbolicLink()) throw new ModelError('文件和目录工具不能访问符号链接或目录联接')
    if (info && !info.isFile() && !info.isDirectory()) throw new ModelError('文件和目录工具不能访问特殊文件')
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

/** 操作整棵目录前检查每个子项；禁止跳过受保护项后再修改剩余部分。 */
export async function validateOrdinaryTree(target: string, check: (target: string) => Promise<void>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await validateOrdinaryPath(target, true)
  await check(target)
  if ((await lstat(target)).isDirectory()) {
    for (const entry of await readdir(target)) await validateOrdinaryTree(path.join(target, entry), check, signal)
  }
}

type PathGuard = (target: string) => Promise<void>

async function removeDirectory(target: string, recursive: boolean, check: PathGuard, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await validateOrdinaryPath(target, true)
  await check(target)
  if (!(await lstat(target)).isDirectory()) throw new ModelError('rmdir 只允许删除目录，删除文件请使用 delete')
  if (recursive) {
    for (const entry of await readdir(target)) {
      const child = path.join(target, entry)
      await validateOrdinaryPath(child, true)
      await check(child)
      if ((await lstat(child)).isDirectory()) await removeDirectory(child, true, check, signal)
      else { signal?.throwIfAborted(); await unlink(child) }
    }
  }
  signal?.throwIfAborted()
  await rmdir(target)
}

async function copyOrdinary(source: string, destination: string, check: PathGuard, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await validateOrdinaryPath(source, true)
  await validateOrdinaryPath(destination)
  await check(source)
  await check(destination)
  if ((await lstat(source)).isDirectory()) {
    await mkdir(destination)
    for (const entry of await readdir(source)) await copyOrdinary(path.join(source, entry), path.join(destination, entry), check, signal)
  } else await copyFile(source, destination, constants.COPYFILE_EXCL)
}

export function filesystemToolDefinitions(check: PathGuard): ToolDefinition[] {
  const tools: ToolDefinition[] = [{
    name: 'mkdir', label: '创建目录', executionMode: 'sequential',
    description: '创建目录及缺少的父目录，已有目录无需重复创建。项目自审模式下，项目内操作自动允许；优先使用此工具，不要用终端命令创建目录。',
    parameters: schema({ path: targetPath }, ['path']),
    execute: async (_id, args, signal) => {
      const target = (args as { path: string }).path
      await validateOrdinaryPath(target)
      await check(target)
      signal?.throwIfAborted()
      await mkdir(target, { recursive: true })
      return result(`已创建目录：${target}`, { path: target })
    }
  }, {
    name: 'rmdir', label: '删除目录', executionMode: 'sequential',
    description: '删除确切路径的目录；非空目录必须显式设置 recursive=true，删除整个目录及其内容。不会删除项目根目录、内部数据、Git 元数据、链接或特殊文件。项目自审模式下，项目内操作自动允许；删除目录优先使用此工具，不要用终端命令。',
    parameters: schema({ path: targetPath, recursive: { type: 'boolean', description: '是否删除目录及其全部内容，默认 false' } }, ['path']),
    execute: async (_id, args, signal) => {
      const { path: target, recursive } = args as { path: string; recursive?: boolean }
      await removeDirectory(target, recursive === true, check, signal)
      return result(`已删除目录：${target}`, { path: target })
    }
  }, {
    name: 'stat', label: '查看文件或目录信息',
    description: '查看文件或目录的类型、字节大小和修改时间。查看目录内容用 ls，查找文件或目录用 find，读取文件内容用 read。',
    parameters: schema({ path: targetPath }, ['path']),
    execute: async (_id, args, signal) => {
      const target = (args as { path: string }).path
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
    description: `${name === 'move' ? '移动或重命名' : '复制'}普通文件或整个目录，path 是源路径，destination 是确切的新路径。目标必须不存在，不会覆盖或合并已有内容。项目自审模式下，项目内操作自动允许；优先使用此工具，不要使用终端命令。`,
    parameters: schema({ path: targetPath, destination: targetPath }, ['path', 'destination']),
    execute: async (_id, args, signal) => {
      const { path: source, destination } = args as { path: string; destination: string }
      await validateOrdinaryPath(source, true)
      await validateOrdinaryPath(destination)
      await check(source)
      await check(destination)
      const existing = await lstat(destination).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
      if (existing) throw new ModelError('目标已存在，请选择新的路径，工具不会覆盖已有内容')
      signal?.throwIfAborted()
      await mkdir(path.dirname(destination), { recursive: true })
      signal?.throwIfAborted()
      if (name === 'move') await rename(source, destination)
      else await copyOrdinary(source, destination, check, signal)
      return result(`已${name === 'move' ? '移动' : '复制'}：${source} → ${destination}`, { path: source, destination })
    }
  })
  return tools
}
