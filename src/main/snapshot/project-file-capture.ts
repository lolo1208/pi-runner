import { copyFile, mkdir, readdir, lstat, rm } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import path from 'node:path'
import { SnapshotFileRules } from './project-ignores'

interface FileState { source: string; staging: string }
const states = new Map<string, Map<string, FileState>>()
const cacheKey = (root: string): string => process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root)
const signature = (info: BigIntStats): string => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`

export function invalidateProjectFileCapture(stagingRoot: string): void {
  states.delete(cacheKey(stagingRoot))
}

async function existingInfo(file: string): Promise<BigIntStats | undefined> {
  try { return await lstat(file, { bigint: true }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

/** 仅同步快照暂存区；调用方须持有影子存储队列。返回复制数量便于验证采集成本。 */
export async function copyProjectFiles(sourceRoot: string, stagingRoot: string): Promise<number> {
  const key = cacheKey(stagingRoot)
  const previous = states.get(key)
  const next = new Map<string, FileState>()
  const rules = new SnapshotFileRules(sourceRoot)
  let copied = 0

  const copyDirectory = async (relative: string): Promise<void> => {
    const source = path.join(sourceRoot, relative)
    const entries = await readdir(source, { withFileTypes: true })
    await rules.loadDirectory(relative, entries)
    const target = path.join(stagingRoot, relative)
    const retained = new Set<string>()
    for (const entry of entries) {
      const file = relative ? `${relative}/${entry.name}` : entry.name
      if (rules.excludes(file, entry.isDirectory())) continue
      const sourcePath = path.join(sourceRoot, file)
      const targetPath = path.join(stagingRoot, file)
      const sourceInfo = await lstat(sourcePath, { bigint: true })
      if (sourceInfo.isSymbolicLink()) throw new Error(`暂不支持快照符号链接：${file}`)
      if (sourceInfo.isDirectory() && await rules.excludesDirectory(file)) continue
      retained.add(entry.name)
      const targetInfo = await existingInfo(targetPath)
      if (sourceInfo.isDirectory()) {
        if (targetInfo && (!targetInfo.isDirectory() || targetInfo.isSymbolicLink())) await rm(targetPath, { recursive: true, force: true })
        if (!targetInfo || !targetInfo.isDirectory() || targetInfo.isSymbolicLink()) await mkdir(targetPath)
        await copyDirectory(file)
      } else if (sourceInfo.isFile()) {
        const sourceSignature = signature(sourceInfo)
        const cached = previous?.get(file)
        if (targetInfo?.isFile() && cached?.source === sourceSignature && cached.staging === signature(targetInfo)) {
          next.set(file, cached)
          continue
        }
        if (targetInfo && !targetInfo.isFile()) await rm(targetPath, { recursive: true, force: true })
        await copyFile(sourcePath, targetPath)
        if (signature(await lstat(sourcePath, { bigint: true })) !== sourceSignature) throw new Error(`快照采集期间文件发生变化，请重试：${file}`)
        next.set(file, { source: sourceSignature, staging: signature(await lstat(targetPath, { bigint: true })) })
        copied++
      } else {
        throw new Error(`暂不支持特殊文件：${file}`)
      }
    }
    for (const entry of await readdir(target)) {
      if (!retained.has(entry)) await rm(path.join(target, entry), { recursive: true, force: true })
    }
  }

  // 失败时不允许复用上次基线，即使暂存区只完成了部分同步。
  states.delete(key)
  try {
    await copyDirectory('')
    states.set(key, next)
    while (states.size > 32) states.delete(states.keys().next().value!)
    return copied
  } catch (error) {
    states.delete(key)
    throw error
  }
}
