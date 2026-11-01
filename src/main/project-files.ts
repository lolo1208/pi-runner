import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectFileEntry } from '../shared/api'

/** 按需读取单层目录，不跟随符号链接，避免循环和访问项目外的目录。 */
export async function listProjectFiles(project: string, directory: string): Promise<ProjectFileEntry[]> {
  if (!path.isAbsolute(project) || directory.includes('\0') || path.isAbsolute(directory)) throw new Error('目录路径无效')
  const root = await realpath(project)
  const target = path.resolve(root, directory)
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('目录必须位于项目内')
  const actual = await realpath(target)
  const actualRelative = path.relative(root, actual)
  if (actualRelative === '..' || actualRelative.startsWith(`..${path.sep}`) || path.isAbsolute(actualRelative)) throw new Error('目录必须位于项目内')
  const entries = await readdir(actual, { withFileTypes: true })
  return entries.filter(entry => entry.isFile() || entry.isDirectory()).map(entry => ({
    name: entry.name, path: directory ? `${directory}/${entry.name}` : entry.name, isDirectory: entry.isDirectory()
  })).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
}
