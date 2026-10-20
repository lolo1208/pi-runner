import { lstat, realpath, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition, createLsToolDefinition, createFindToolDefinition, createGrepToolDefinition, createPowerShellToolDefinition, createBashToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'
import type { PermissionMode } from '../../shared/models'
import { commandApprovalReason, highRiskFileMutation, readOnlyCommand, safeFileCommand, safeLocationCommand } from './tool-permissions'
import { createDeleteToolDefinition, validateDeleteFile } from './delete-tool'
import { filesystemToolDefinitions, validateOrdinaryPath, validateOrdinaryTree } from './filesystem-tools'
import type { TerminalSandbox } from './terminal-sandbox'
import { WindowsCommandRecovery, withCommandRecovery } from './windows-command-recovery'
import { delegateWindowsFileCommand } from './windows-file-command'
import { developerCommand } from './developer-command-policy'
import { developerToolReads } from './developer-tool-access'

const fileMutations = new Set(['edit', 'write', 'delete', 'mkdir', 'rmdir', 'move', 'copy'])
const treeOperations = new Set(['rmdir', 'move', 'copy'])

export interface ToolPermissionContext {
  mode: PermissionMode
  project?: string
  protectedDirectories: string[]
  sandbox?: TerminalSandbox
  onRecovery?(message: string): void
  approve(id: string, tool: string, args: Record<string, unknown>, reason: string, signal?: AbortSignal): Promise<void>
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** 对不存在的文件也解析最近的已有父目录，防止通过链接目标绕过审批。 */
export async function canonicalToolPath(target: string): Promise<string> {
  try { return await realpath(target) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    if (parent === target) return target
    return path.join(await canonicalToolPath(parent), path.basename(target))
  }
}

const hiddenData = new Set(['.git', '.pi-runner'])
const hiddenProjectData = (name: string): boolean => hiddenData.has(name.toLowerCase()) || name.startsWith('.pi-runner-check-')

/** 搜索逐项检查边界，不跟随链接，也不扫描应用内部数据。 */
async function* ordinaryFiles(target: string, protectedDirectories: string[], signal?: AbortSignal, includeDirectories = false): AsyncGenerator<string> {
  signal?.throwIfAborted()
  const info = await lstat(target)
  if (info.isSymbolicLink() || hiddenData.has(path.basename(target).toLowerCase()) || path.basename(target).startsWith('.pi-runner-check-') || protectedDirectories.some(directory => within(directory, target))) return
  if (info.isFile()) { yield target; return }
  if (!info.isDirectory()) return
  if (includeDirectories) yield target
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.isSymbolicLink()) continue
    yield* ordinaryFiles(path.join(target, entry.name), protectedDirectories, signal, includeDirectories)
  }
}

async function restrictedSearch(tool: string, args: Record<string, unknown>, protectedDirectories: string[], signal?: AbortSignal) {
  const target = String(args.path)
  const limit = Math.max(1, Math.min(1000, Number(args.limit) || 100))
  const lines: string[] = []
  let visited = 0
  let matcher: RegExp | undefined
  if (tool === 'grep' && args.literal !== true) {
    try { matcher = new RegExp(String(args.pattern), args.ignoreCase ? 'i' : '') }
    catch { throw new ModelError('搜索正则表达式无效') }
  }
  for await (const file of ordinaryFiles(target, protectedDirectories, signal, tool === 'find')) {
    if (++visited > 20000 || lines.length >= limit) break
    const relative = path.relative(target, file).split(path.sep).join('/') || path.basename(file)
    if (tool === 'find') {
      if (path.matchesGlob(relative, String(args.pattern)) || path.matchesGlob(path.basename(file), String(args.pattern))) lines.push(relative)
      continue
    }
    if (args.glob && !path.matchesGlob(relative, String(args.glob)) && !path.matchesGlob(path.basename(file), String(args.glob))) continue
    if ((await lstat(file)).size > 1024 * 1024) continue
    const text = await readFile(file, 'utf8')
    if (text.includes('\0')) continue
    const contents = text.split(/\r?\n/)
    const pattern = args.ignoreCase ? String(args.pattern).toLowerCase() : String(args.pattern)
    const context = Math.max(0, Math.min(10, Number(args.context) || 0))
    for (let index = 0; index < contents.length && lines.length < limit; index++) {
      signal?.throwIfAborted()
      if (matcher ? matcher.test(contents[index]) : (args.ignoreCase ? contents[index].toLowerCase() : contents[index]).includes(pattern)) {
        lines.push(contents.slice(Math.max(0, index - context), index + context + 1).map((line, offset) => `${relative}:${Math.max(0, index - context) + offset + 1}: ${line.slice(0, 500)}`).join('\n'))
      }
    }
  }
  return { content: [{ type: 'text' as const, text: lines.join('\n').slice(0, 50000) || '未找到匹配结果。' }], details: { resultLimitReached: lines.length >= limit || visited > 20000 } }
}

/** 解析父目录与联接点，禁止文件工具越出当前项目或修改 Git 元数据。 */
export async function projectToolPath(root: string, value: string): Promise<string> {
  const target = path.resolve(root, value)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(part => hiddenProjectData(part))) throw new ModelError('工具只能访问当前项目内的普通文件')
  let current = root
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || path.relative(root, await realpath(current)).startsWith('..')) throw new ModelError('工具不能访问符号链接或项目外的目录')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return target
}

export function piProjectTools(root: string, beforeMutation: () => Promise<void>, permissions?: ToolPermissionContext): ToolDefinition[] {
  const recovery = new WindowsCommandRecovery()
  const recoveryPath = async (value: string): Promise<string> => {
    const target = await projectToolPath(root, value)
    if (path.relative(root, target).split(path.sep).some(part => ['.agents', '.codex', '.aws'].includes(part.toLowerCase()))) throw new ModelError('自动修复不能访问项目内的凭据或 Agent 配置目录')
    await protectPath(target)
    return target
  }
  const protectPath = async (target: string): Promise<void> => {
    if (await canonicalToolPath(target) !== target) throw new ModelError('操作期间目标路径发生变化，请重新请求操作')
    for (const directory of permissions?.protectedDirectories ?? []) {
      if (within(await canonicalToolPath(directory), target)) throw new ModelError('工具不能访问应用内部会话、凭据或快照数据')
    }
    if (target.split(path.sep).some(part => hiddenProjectData(part))) throw new ModelError('文件工具不能访问 Git 元数据或应用内部数据')
  }
  const definitions: ToolDefinition<any, any>[] = [createReadToolDefinition(root), createEditToolDefinition(root), createWriteToolDefinition(root), createDeleteToolDefinition(), ...filesystemToolDefinitions(protectPath), createLsToolDefinition(root), createFindToolDefinition(root), createGrepToolDefinition(root), process.platform === 'win32' ? createPowerShellToolDefinition(root) : createBashToolDefinition(root)]
  return definitions.map(tool => ({ ...tool,
    ...(['bash', 'powershell'].includes(tool.name) ? {
      description: `${tool.description} 项目自审模式在系统沙箱内运行项目命令，调用已安装的全局开发工具、测试子进程和联网无需审批；项目外普通文件的读写仍需批准。不要仅因绝对工具路径、复合命令、测试或联网设置 outsideSandbox=true。只有确需项目外普通文件访问时才同时设置 externalFileAccess=true 和 outsideSandbox=true。全局工具的安装文件只读，用户配置和缓存使用独立临时区；缺少依赖、普通程序错误或沙箱兼容性错误不等于模型授权故障，也不自动申请完整本机权限。项目内文件操作优先使用 copy、move、delete、mkdir、rmdir 专用工具。Windows PowerShell 5 的路径命令可能探测项目祖先，简单文件操作会自动转交专用工具。partial-or-unknown 表示可能已部分执行，先核对结果，只完成剩余操作，不重放整段脚本；denied/awaiting-approval 不得重复申请相同授权。`,
      parameters: { ...tool.parameters, properties: { ...tool.parameters.properties, outsideSandbox: { type: 'boolean', description: '申请沙箱外执行。开发工具调用、测试子进程和联网应在沙箱内免审批执行；项目外普通文件访问须同时明确 externalFileAccess。' }, externalFileAccess: { type: 'boolean', description: '本次命令确需读取或写入项目外普通文件时设为 true，项目自审模式需要批准。全局工具及其安装依赖不属于普通文件访问。' } } }
    } : {}),
    ...(['find', 'grep'].includes(tool.name) ? { description: `${tool.name === 'find' ? '按 glob 查找普通文件和目录' : '按模式搜索普通文件内容'}；不跟随链接，排除 Git 元数据、应用内部数据和 node_modules。` } : {}),
    execute: async (id, args, signal, update, context) => {
    signal?.throwIfAborted()
    // 固定批准的参数，调用方后续修改原对象不能改变实际执行内容。
    const input = structuredClone(args) as Record<string, unknown>
    let revalidate: (() => Promise<void>) | undefined
    let executionTool = tool
    if (!permissions) {
      // 未提供权限上下文时不允许具有副作用的工具悄悄执行。
      if (fileMutations.has(tool.name) || ['bash', 'powershell'].includes(tool.name)) throw new ModelError('工具执行缺少权限上下文')
      input.path = await projectToolPath(root, typeof input.path === 'string' ? input.path : '.')
    } else if (['bash', 'powershell'].includes(tool.name)) {
      const command = String(input.command ?? '')
      const development = permissions.mode === 'auto' && !!permissions.project && await developerCommand(command, signal)
      // 模型不得仅因工具位于项目外、测试或联网而升级整条命令的权限。
      if (development && input.externalFileAccess !== true) input.outsideSandbox = false
      if (input.externalFileAccess === true) input.outsideSandbox = true
      if (permissions.mode === 'auto' && input.externalFileAccess !== true) {
        const previous = recovery.previous(command)
        if (previous) return previous
      }
      if (process.platform === 'win32' && permissions.mode === 'auto' && permissions.project && input.outsideSandbox !== true) {
        const fileOperation = await delegateWindowsFileCommand(command, recoveryPath, signal)
        if (fileOperation) {
          permissions.onRecovery?.('已自动改用项目文件工具，正在继续执行')
          const delegated = piProjectTools(root, beforeMutation, {
            ...permissions,
            // 文件工具的执行前复查也必须沿用沙箱的凭据与 Agent 目录边界。
            protectedDirectories: [...permissions.protectedDirectories, ...['.agents', '.codex', '.aws'].map(name => path.join(root, name))]
          }).find(definition => definition.name === fileOperation.tool)!
          let result: Awaited<ReturnType<ToolDefinition['execute']>>
          try { result = await delegated.execute(id, fileOperation.args as never, signal, update, context) }
          catch (error) {
            signal?.throwIfAborted()
            result = { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], details: {}, isError: true }
          }
          if (result.isError) {
            const failed = withCommandRecovery(result, { kind: 'file-operation', state: 'unresolved', execution: 'partial-or-unknown', attempts: 1, message: `文件工具 ${fileOperation.tool} 未完成；先核对已有文件和目录，仅完成剩余操作，不自动重放原命令或申请扩权。` })
            recovery.remember(command, failed)
            permissions.onRecovery?.('文件操作未完成，已保留原始错误；请先核对已完成部分')
            return failed
          }
          return withCommandRecovery(result, { kind: 'file-operation', state: 'recovered', execution: 'completed', attempts: 1, message: `已自动使用 ${fileOperation.tool} 完成同一文件操作，未启动原终端命令。` })
        }
      }
      let sandboxed = false
      let reason = commandApprovalReason(permissions.mode, command)
      if (input.outsideSandbox === true && permissions.mode !== 'full') reason = '本次命令申请脱离系统沙箱，将获得当前用户的本机权限，需要确认'
      else if (permissions.mode === 'auto' && permissions.project && !safeLocationCommand(command) && !safeFileCommand(command) && permissions.sandbox) {
        try {
          await permissions.sandbox.prepare(root, signal)
          executionTool = process.platform === 'win32' ? createPowerShellToolDefinition(root, { operations: permissions.sandbox, exposeSessionEnvironment: false }) : createBashToolDefinition(root, { operations: permissions.sandbox, exposeSessionEnvironment: false })
          reason = undefined
          sandboxed = true
        } catch (error) {
          signal?.throwIfAborted()
          if (permissions.sandbox.failClosed) throw error
          reason = `${error instanceof Error ? error.message : '终端系统沙箱不可用'}。如批准，将脱离沙箱执行本次命令`
        }
      }
      if (reason) await permissions.approve(id, tool.name, input, reason, signal)
      signal?.throwIfAborted()
      if (safeLocationCommand(command)) return { content: [{ type: 'text' as const, text: root }], details: {} }
      const fileCommand = safeFileCommand(command)
      if (fileCommand) {
        const delegated = piProjectTools(root, beforeMutation, {
          ...permissions,
          // 默认模式已批准完整命令；规范路径与内部数据保护仍在文件工具中执行。
          ...(reason ? { approve: async () => {} } : {})
        }).find(definition => definition.name === fileCommand.tool)!
        return delegated.execute(id, { path: fileCommand.path } as never, signal, update, context)
      }
      if (sandboxed && process.platform === 'win32') {
        return recovery.run({ root, command, sandbox: permissions.sandbox!, signal, localPath: recoveryPath, onRecovery: permissions.onRecovery,
          approve: (actualCommand, runtime, explanation) => permissions.approve(id, tool.name, { ...input, command: actualCommand, originalCommand: command, runtime, outsideSandbox: true }, explanation, signal),
          execute: async (actualCommand, outside) => {
            signal?.throwIfAborted()
            // 只读命令不修改项目文件，不需要为回滚保存修改前快照。
            if (!readOnlyCommand(command)) await beforeMutation()
            signal?.throwIfAborted()
            return (outside ? tool : executionTool).execute(id, { ...input, command: actualCommand }, signal, update, context)
          }
        })
      }
    } else {
      const requestedPath = path.resolve(root, typeof input.path === 'string' ? input.path : '.')
      if (tool.name === 'delete') {
        if (typeof input.path !== 'string' || !input.path.trim()) throw new ModelError('请提供待删除文件的确切路径')
        await validateDeleteFile(requestedPath)
      }
      const mutation = fileMutations.has(tool.name)
      const structured = ['mkdir', 'rmdir', 'move', 'copy', 'stat'].includes(tool.name)
      if (structured) {
        if (typeof input.path !== 'string' || !input.path.trim()) throw new ModelError('请提供确切的文件或目录路径')
        await validateOrdinaryPath(requestedPath, tool.name !== 'mkdir')
      }
      const target = await canonicalToolPath(requestedPath)
      const project = permissions.project ? await canonicalToolPath(permissions.project) : undefined
      const protectedDirectories = await Promise.all(permissions.protectedDirectories.map(canonicalToolPath))
      const toolReads = !mutation && permissions.mode === 'auto' && project && ['read', 'stat'].includes(tool.name) ? await developerToolReads(project, protectedDirectories) : []
      let reason = mutation && permissions.mode === 'default' ? '“每次询问”模式下，文件和目录修改需要逐次确认' : undefined
      const checkPath = async (value: string): Promise<void> => {
        const canonical = await canonicalToolPath(value)
        if (canonical !== value) throw new ModelError('操作期间目标路径发生变化，请重新请求操作')
        if (protectedDirectories.some(directory => within(directory, value))) throw new ModelError('工具不能访问应用内部会话、凭据或快照数据')
        if (value.split(path.sep).some(part => hiddenProjectData(part))) throw new ModelError('文件工具不能访问 Git 元数据或应用内部数据')
        if (treeOperations.has(tool.name) && (value === project || value === path.parse(value).root)) throw new ModelError('工具不能删除、移动或复制项目根目录或系统根目录')
        if (!(project && within(project, value)) && !toolReads.some(directory => within(directory, value)) && permissions.mode !== 'full') reason = '目标文件或目录位于当前项目外，需要确认本次访问'
        if (mutation && permissions.mode !== 'full' && highRiskFileMutation(value)) reason = '该路径涉及系统、登录或自动启动配置，需要确认本次修改'
      }
      let destination: string | undefined
      if (['move', 'copy'].includes(tool.name)) {
        if (typeof input.destination !== 'string' || !input.destination.trim()) throw new ModelError('请提供确切的目标路径')
        const requestedDestination = path.resolve(root, input.destination)
        await validateOrdinaryPath(requestedDestination)
        destination = await canonicalToolPath(requestedDestination)
        if (within(target, destination) || within(destination, target)) throw new ModelError('源路径和目标路径不能相同或互相包含')
        input.destination = destination
      }
      revalidate = async () => {
        if (tool.name === 'delete') await validateDeleteFile(target)
        if (structured) await validateOrdinaryPath(target, tool.name !== 'mkdir')
        await checkPath(target)
        if (treeOperations.has(tool.name)) await validateOrdinaryTree(target, async child => {
          await checkPath(child)
          if (destination) await checkPath(path.join(destination, path.relative(target, child)))
        }, signal)
        if (destination) { await validateOrdinaryPath(destination); await checkPath(destination) }
      }
      await revalidate()
      if (reason) await permissions.approve(id, tool.name, { ...input, path: target }, reason, signal)
      signal?.throwIfAborted()
      if (await canonicalToolPath(target) !== target) throw new ModelError('审批期间目标路径发生变化，请重新请求操作')
      // 固定已校验的规范路径，不再使用原始链接路径。
      input.path = target
      if (['find', 'grep'].includes(tool.name)) return restrictedSearch(tool.name, input, await Promise.all(permissions.protectedDirectories.map(canonicalToolPath)), signal)
    }
    if (fileMutations.has(tool.name) || (['bash', 'powershell'].includes(tool.name) && !readOnlyCommand(String(input.command ?? '')))) await beforeMutation()
    signal?.throwIfAborted()
    if (revalidate) await revalidate()
    return executionTool.execute(id, input, signal, update, context)
  } }))
}
