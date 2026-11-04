import { constants } from 'node:fs'
import { lstat, open, opendir } from 'node:fs/promises'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { ModelError } from './model-validation'
import { hiddenProjectData, within } from './security-paths'
import { validateOrdinaryPath } from './filesystem-tools'

const OUTPUT_CHARS = 50000
const SCAN_ITEMS = 20000
const FILE_BYTES = 1024 * 1024
interface Scope {
  protectedDirectories: string[]
  workspace?: string
  check(target: string): Promise<void>
  signal?: AbortSignal
}
interface ScanState { visited: number; scanLimitReached: boolean; skipped: number }

function excluded(target: string, scope: Scope): boolean {
  const name = path.basename(target)
  return name === 'node_modules' || hiddenProjectData(name) || scope.protectedDirectories.some(directory => within(directory, target)) && !(scope.workspace && within(scope.workspace, target))
}

/** 枚举也计入扫描预算，避免空目录树绕过原先只按文件计数的上限。 */
async function* ordinaryEntries(target: string, scope: Scope, state: ScanState, directories: boolean, depth = 0): AsyncGenerator<string> {
  scope.signal?.throwIfAborted()
  if (++state.visited > SCAN_ITEMS || depth > 128) { state.scanLimitReached = true; return }
  if (excluded(target, scope)) return
  try {
    await validateOrdinaryPath(target, true)
    await scope.check(target)
    const info = await lstat(target)
    if (info.isFile()) { yield target; return }
    if (!info.isDirectory()) return
    if (directories) yield target
    for await (const entry of await opendir(target)) {
      if (state.visited >= SCAN_ITEMS) { state.scanLimitReached = true; break }
      if (entry.isSymbolicLink()) continue
      yield* ordinaryEntries(path.join(target, entry.name), scope, state, directories, depth + 1)
    }
  } catch (error) {
    scope.signal?.throwIfAborted()
    if (depth === 0) throw error
    state.skipped++
  }
}

/** 有界读取并核验实际打开的文件，不因读取期间文件增长而无限分配内存。 */
async function searchText(target: string, scope: Scope): Promise<string | undefined> {
  await validateOrdinaryPath(target, true)
  await scope.check(target)
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > FILE_BYTES) return undefined
    const buffer = Buffer.allocUnsafe(Math.min(FILE_BYTES + 1, info.size + 1))
    let bytes = 0
    while (bytes < buffer.length) {
      scope.signal?.throwIfAborted()
      const read = await file.read(buffer, bytes, buffer.length - bytes, bytes)
      if (!read.bytesRead) break
      bytes += read.bytesRead
    }
    if (bytes > info.size || bytes > FILE_BYTES) return undefined
    const content = buffer.subarray(0, bytes)
    return content.includes(0) ? undefined : content.toString('utf8')
  } finally { await file.close() }
}

/** 只执行固定代码，模式作为数据传入；超时可中断灾难性正则回溯。 */
function matchingLines(lines: string[], pattern: string, ignoreCase: boolean, literal: boolean, limit: number): number[] {
  if (literal) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern
    const found: number[] = []
    for (let index = 0; index < lines.length && found.length < limit; index++) if ((ignoreCase ? lines[index].toLowerCase() : lines[index]).includes(needle)) found.push(index)
    return found
  }
  try {
    return runInNewContext('const matcher = new RegExp(pattern, flags); const matches = []; for (let i = 0; i < lines.length && matches.length < limit; i++) { if (matcher.test(lines[i])) matches.push(i); } matches',
      { pattern, flags: ignoreCase ? 'i' : '', lines, limit }, { timeout: 100 }) as number[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new ModelError('搜索正则执行超时，请简化模式或改用 literal=true；不要原样重试')
    throw new ModelError('搜索正则表达式无效，请修正 pattern')
  }
}

function safeHead(text: string, limit: number): string {
  let output = text.slice(0, limit)
  if (output.length < text.length && /[\uD800-\uDBFF]$/.test(output)) output = output.slice(0, -1)
  return output
}

export async function restrictedSearch(tool: string, args: Record<string, unknown>, scope: Scope) {
  const target = String(args.path)
  const limit = Number(args.limit ?? (tool === 'find' ? 1000 : 100))
  const blocks: string[] = []
  let chars = 0, matches = 0, outputTruncated = false, lineTruncated = false, skippedFiles = 0
  const state: ScanState = { visited: 0, scanLimitReached: false, skipped: 0 }
  if (tool === 'grep' && args.literal !== true) matchingLines([], String(args.pattern), Boolean(args.ignoreCase), false, limit)
  const append = (text: string): void => {
    const available = Math.max(0, OUTPUT_CHARS - 256 - chars - (blocks.length ? 1 : 0))
    const head = safeHead(text, available)
    if (head) { chars += head.length + (blocks.length ? 1 : 0); blocks.push(head) }
    if (head.length !== text.length) outputTruncated = true
    matches++
  }
  for await (const file of ordinaryEntries(target, scope, state, tool === 'find')) {
    scope.signal?.throwIfAborted()
    if (matches >= limit || outputTruncated) break
    const relative = path.relative(target, file).split(path.sep).join('/') || path.basename(file)
    if (tool === 'find') {
      if (path.matchesGlob(relative, String(args.pattern)) || path.matchesGlob(path.basename(file), String(args.pattern))) append(relative)
      continue
    }
    if (args.glob && !path.matchesGlob(relative, String(args.glob)) && !path.matchesGlob(path.basename(file), String(args.glob))) continue
    let text: string | undefined
    try { text = await searchText(file, scope) }
    catch { scope.signal?.throwIfAborted(); skippedFiles++; continue }
    if (text === undefined) { skippedFiles++; continue }
    const lines = text.split(/\r\n|\r|\n/)
    const found = matchingLines(lines, String(args.pattern), Boolean(args.ignoreCase), args.literal === true, limit - matches)
    const context = Number(args.context ?? 0)
    for (const index of found) {
      scope.signal?.throwIfAborted()
      const start = Math.max(0, index - context), end = Math.min(lines.length, index + context + 1)
      append(lines.slice(start, end).map((line, offset) => {
        if (line.length > 500) lineTruncated = true
        return `${relative}:${start + offset + 1}: ${safeHead(line, 500)}`
      }).join('\n'))
      if (outputTruncated) break
    }
  }
  const details = { resultLimitReached: matches >= limit || state.scanLimitReached || outputTruncated, outputTruncated, lineTruncated, scanLimitReached: state.scanLimitReached, skippedFiles: skippedFiles + state.skipped, visited: state.visited }
  const incomplete = details.resultLimitReached || lineTruncated || details.skippedFiles > 0
  const note = incomplete ? '\n[结果可能不完整：达到数量/输出/扫描上限、长行被截断，或跳过了不可读、二进制及超过 1 MiB 的文件。请缩小 path/glob/pattern，命中文件用 read 分段读取。]' : ''
  return { content: [{ type: 'text' as const, text: (blocks.join('\n') || '未找到匹配结果。') + note }], details }
}

export async function restrictedLs(args: Record<string, unknown>, scope: Scope) {
  const target = String(args.path), limit = Number(args.limit ?? 500)
  const entries: string[] = []
  let visited = 0, skipped = 0, scanLimitReached = false
  for await (const entry of await opendir(target)) {
    scope.signal?.throwIfAborted()
    if (++visited > SCAN_ITEMS) { scanLimitReached = true; break }
    const child = path.join(target, entry.name)
    // ls 可以列出 node_modules，但不跟随链接或展示被保护的路径。
    if (entry.isSymbolicLink() || hiddenProjectData(entry.name)) continue
    try { await scope.check(child) } catch { scope.signal?.throwIfAborted(); skipped++; continue }
    entries.push(entry.name + (entry.isDirectory() ? '/' : ''))
  }
  entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const selected = entries.slice(0, limit).join('\n')
  const output = safeHead(selected, OUTPUT_CHARS - 160)
  const truncated = scanLimitReached || entries.length > limit || output.length !== selected.length || skipped > 0
  const note = truncated ? '\n[目录列表不完整：达到条目/输出/扫描上限或部分项目不可访问。请用 find 缩小范围。]' : ''
  return { content: [{ type: 'text' as const, text: (output || '目录为空。') + note }], details: { resultLimitReached: truncated, scanLimitReached, skipped, returned: Math.min(entries.length, limit) } }
}
