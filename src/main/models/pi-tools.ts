import { lstat, realpath, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition, createLsToolDefinition, createFindToolDefinition, createGrepToolDefinition, createPowerShellToolDefinition, createBashToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'
import { DEFAULT_COMMAND_APPROVAL_REASON, type PermissionMode } from '../../shared/models'
import { commandRisk, highRiskFileMutation, readOnlyCommand } from './tool-permissions'
import { createDeleteToolDefinition, validateDeleteFile } from './delete-tool'
import { filesystemToolDefinitions, validateOrdinaryPath, validateOrdinaryTree } from './filesystem-tools'
import { createDownloadToolDefinition, validateDownloadArgs } from './download-tool'
import { canonicalToolPath, credentialBlacklist, hiddenProjectData, within } from './security-paths'

const fileMutations = new Set(['edit', 'write', 'download', 'delete', 'mkdir', 'rmdir', 'move', 'copy'])
const treeOperations = new Set(['rmdir', 'move', 'copy'])

function hiddenPath(target: string, workspace?: string): boolean {
  const relative = workspace && within(workspace, target) ? path.relative(workspace, target) : undefined
  return (relative ?? target).split(path.sep).some(hiddenProjectData)
}

export interface ToolPermissionContext {
  mode: PermissionMode
  project?: string
  /** The current conversation is the only tool-accessible subtree inside app data. */
  workspace?: string
  protectedDirectories: string[]
  downloadFetch?: typeof fetch
  approve(id: string, tool: string, args: Record<string, unknown>, reason: string, signal?: AbortSignal, mustConfirm?: boolean): Promise<void>
}

/** 搜索逐项检查边界，不跟随链接，也不扫描应用内部数据。 */
async function* ordinaryFiles(target: string, protectedDirectories: string[], signal?: AbortSignal, includeDirectories = false, workspace?: string): AsyncGenerator<string> {
  signal?.throwIfAborted()
  const info = await lstat(target)
  const inWorkspace = Boolean(workspace && within(workspace, target))
  if (info.isSymbolicLink() || hiddenProjectData(path.basename(target)) || protectedDirectories.some(directory => within(directory, target)) && !inWorkspace) return
  if (info.isFile()) { yield target; return }
  if (!info.isDirectory()) return
  if (includeDirectories) yield target
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.isSymbolicLink()) continue
    yield* ordinaryFiles(path.join(target, entry.name), protectedDirectories, signal, includeDirectories, workspace)
  }
}

async function restrictedSearch(tool: string, args: Record<string, unknown>, protectedDirectories: string[], signal?: AbortSignal, workspace?: string) {
  const target = String(args.path)
  const limit = Math.max(1, Math.min(1000, Number(args.limit) || 100))
  const lines: string[] = []
  let visited = 0
  let matcher: RegExp | undefined
  if (tool === 'grep' && args.literal !== true) {
    try { matcher = new RegExp(String(args.pattern), args.ignoreCase ? 'i' : '') }
    catch { throw new ModelError('搜索正则表达式无效') }
  }
  for await (const file of ordinaryFiles(target, protectedDirectories, signal, tool === 'find', workspace)) {
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
  if (!within(root, target) || relative.split(path.sep).some(part => hiddenProjectData(part))) throw new ModelError('工具只能访问当前项目内的普通文件')
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
  const protectPath = async (target: string): Promise<void> => {
    if (await canonicalToolPath(target) !== target) throw new ModelError('操作期间目标路径发生变化，请重新请求操作')
    const inWorkspace = Boolean(permissions?.workspace && within(permissions.workspace, target))
    for (const directory of permissions?.protectedDirectories ?? []) {
      if (within(await canonicalToolPath(directory), target) && !inWorkspace) throw new ModelError('工具不能访问应用内部会话、凭据或快照数据')
    }
    for (const directory of credentialBlacklist()) {
      if (within(await canonicalToolPath(directory), target)) throw new ModelError('工具不能访问敏感凭据目录')
    }
    if (hiddenPath(target, permissions?.workspace)) throw new ModelError('文件工具不能访问 Git 元数据或应用内部数据')
  }
  // 本机执行在启动前指定系统临时目录。
  const localShellOptions = { spawnHook: (context: { command: string; cwd: string; env: NodeJS.ProcessEnv }) => ({ ...context, env: {
    ...Object.fromEntries(Object.entries(context.env).filter(([key]) => !['psmoduleanalysiscachepath', 'pythonpycacheprefix', 'pip_cache_dir', 'tmpdir', 'tmp', 'temp'].includes(key.toLowerCase()))),
    TMPDIR: os.tmpdir(), TMP: os.tmpdir(), TEMP: os.tmpdir(), PSModuleAnalysisCachePath: path.join(os.tmpdir(), 'pi-runner-ModuleAnalysisCache'),
    PYTHONPYCACHEPREFIX: path.join(os.tmpdir(), 'pi-runner-python-cache'), PIP_CACHE_DIR: path.join(os.tmpdir(), 'pi-runner-pip-cache')
  } }) }
  const definitions: ToolDefinition<any, any>[] = [createReadToolDefinition(root), createEditToolDefinition(root), createWriteToolDefinition(root), createDownloadToolDefinition(protectPath, { fetchRequest: permissions?.downloadFetch }), createDeleteToolDefinition(), ...filesystemToolDefinitions(protectPath), createLsToolDefinition(root), createFindToolDefinition(root), createGrepToolDefinition(root), process.platform === 'win32' ? createPowerShellToolDefinition(root, localShellOptions) : createBashToolDefinition(root, localShellOptions)]
  const terminalOptions = (tool: ToolDefinition<any, any>) => ({
    parameters: tool.parameters,
    description: [tool.description,
      permissions?.mode === 'auto' ? '项目自审：只读命令和常见开发命令（安装、构建、测试、Git 等）直接执行；其余命令先由应用自动审核，无法确定时询问你。禁止通过终端写文件，修改文件请使用专用文件工具，下载落盘请使用 download。网络请求无需单独审批，下载文件仍遵循写入审核。' : '',
      'partial-or-unknown 时先核对结果，只补做剩余步骤；denied 或 awaiting-approval 时不要重复申请相同授权。'
    ].filter(Boolean).join(' ')
  })
  return definitions.map(tool => ({ ...tool,
    ...(['bash', 'powershell'].includes(tool.name) ? terminalOptions(tool) : {}),
    ...(['find', 'grep'].includes(tool.name) ? { description: `${tool.name === 'find' ? '按 glob 查找普通文件和目录' : '按模式搜索普通文件内容'}；不跟随链接，排除 Git 元数据、应用内部数据和 node_modules。` } : {}),
    execute: async (id, args, signal, update, context) => {
    signal?.throwIfAborted()
    // 固定批准的参数，调用方后续修改原对象不能改变实际执行内容。
    const input = structuredClone(args) as Record<string, unknown>
    let revalidate: (() => Promise<void>) | undefined
    let forceApproval = false
    if (!permissions) {
      // 未提供权限上下文时不允许具有副作用的工具悄悄执行。
      if (fileMutations.has(tool.name) || ['bash', 'powershell'].includes(tool.name)) throw new ModelError('工具执行缺少权限上下文')
      input.path = await projectToolPath(root, typeof input.path === 'string' ? input.path : '.')
    } else if (['bash', 'powershell'].includes(tool.name)) {
      const command = String(input.command ?? '')
      const risk = commandRisk(command, root)
      if (risk.risk === 'block') throw new ModelError(risk.reason ?? '终端命令被安全策略拦截')
      if (permissions.mode === 'default') {
        await permissions.approve(id, tool.name, input, DEFAULT_COMMAND_APPROVAL_REASON, signal)
      } else if (permissions.mode === 'auto' && risk.risk === 'approve') {
        await permissions.approve(id, tool.name, input, risk.reason ?? DEFAULT_COMMAND_APPROVAL_REASON, signal, risk.mustConfirm)
      }
      signal?.throwIfAborted()
    } else {
      if (tool.name === 'download') validateDownloadArgs(input)
      const requestedPath = path.resolve(root, typeof input.path === 'string' ? input.path : '.')
      if (tool.name === 'download') await validateOrdinaryPath(requestedPath)
      if (['read', 'write', 'edit', 'ls', 'find', 'grep'].includes(tool.name)) await validateOrdinaryPath(requestedPath, tool.name !== 'write')
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
      const workspace = permissions.workspace ? await canonicalToolPath(permissions.workspace) : undefined
      const inWorkspace = (value: string): boolean => Boolean(workspace && within(workspace, value))
      const project = permissions.project ? await canonicalToolPath(permissions.project) : undefined
      const protectedDirectories = await Promise.all(permissions.protectedDirectories.map(canonicalToolPath))
      const credentialDirectories = await Promise.all(credentialBlacklist().map(canonicalToolPath))
      const writableRoots = [project, workspace, await canonicalToolPath(os.tmpdir())].filter((value): value is string => Boolean(value))
      let reason = mutation && permissions.mode === 'default' ? '“每次询问”模式下，文件和目录修改需要逐次确认' : undefined
      const checkPath = async (value: string, writing = mutation && tool.name !== 'copy'): Promise<void> => {
        const canonical = await canonicalToolPath(value)
        if (canonical !== value) throw new ModelError('操作期间目标路径发生变化，请重新请求操作')
        if (protectedDirectories.some(directory => within(directory, value)) && !inWorkspace(value)) throw new ModelError('工具不能访问应用内部会话、凭据或快照数据')
        if (hiddenPath(value, workspace)) throw new ModelError('文件工具不能访问 Git 元数据或应用内部数据')
        if (credentialDirectories.some(entry => within(entry, value) || value === entry)) throw new ModelError('工具不能访问敏感凭据目录')
        if (treeOperations.has(tool.name) && (value === path.parse(value).root || project && within(value, project) || value === workspace)) throw new ModelError('工具不能删除、移动或复制项目根目录、其父目录或系统根目录')
        if (writing && [...protectedDirectories, ...credentialDirectories].some(directory => within(value, directory))) throw new ModelError('工具不能修改包含应用数据或敏感凭据的父目录')
        const insideProject = project ? within(project, value) : inWorkspace(value)
        const writable = writableRoots.some(directory => within(directory, value))
        if (writing) {
          if (permissions.mode === 'auto' && !writable) {
            reason = '目标位于项目目录和系统临时目录之外。批准仅授权这次完整文件操作。'
          }
          if (permissions.mode === 'default') {
            if (!insideProject) reason = '目标文件或目录位于当前项目外，需要确认本次访问'
            if (highRiskFileMutation(value)) reason = '该路径涉及系统、登录或自动启动配置，需要确认本次修改'
          }
          if (permissions.mode === 'auto' && highRiskFileMutation(value)) {
            reason = '该路径涉及系统、登录或自动启动配置，需要人工确认本次修改'
            forceApproval = true
          }
        } else if (permissions.mode === 'default' && !insideProject) {
          reason = '目标文件或目录位于当前项目外，需要确认本次访问'
        }
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
        if (tool.name === 'download') await validateOrdinaryPath(target)
        if (['read', 'write', 'edit', 'ls', 'find', 'grep'].includes(tool.name)) await validateOrdinaryPath(target, tool.name !== 'write')
        if (tool.name === 'delete') await validateDeleteFile(target)
        if (structured) await validateOrdinaryPath(target, tool.name !== 'mkdir')
        await checkPath(target)
        if (treeOperations.has(tool.name)) await validateOrdinaryTree(target, async child => {
          await checkPath(child)
          if (destination) await checkPath(path.join(destination, path.relative(target, child)), true)
        }, signal)
        if (destination) { await validateOrdinaryPath(destination); await checkPath(destination, true) }
      }
      await revalidate()
      if (reason) await permissions.approve(id, tool.name, { ...input, path: target }, reason, signal, forceApproval)
      signal?.throwIfAborted()
      if (await canonicalToolPath(target) !== target) throw new ModelError('审批期间目标路径发生变化，请重新请求操作')
      // 固定已校验的规范路径，不再使用原始链接路径。
      input.path = target
      if (['find', 'grep'].includes(tool.name)) return restrictedSearch(tool.name, input, [...protectedDirectories, ...credentialDirectories], signal, workspace)
      if (tool.name === 'ls') {
        const entries: string[] = []
        for (const entry of await readdir(target, { withFileTypes: true })) {
          signal?.throwIfAborted()
          const child = path.join(target, entry.name)
          if (entry.isSymbolicLink() || hiddenProjectData(entry.name) || [...protectedDirectories, ...credentialDirectories].some(directory => within(directory, child) && !inWorkspace(child))) continue
          entries.push(entry.name + (entry.isDirectory() ? '/' : ''))
        }
        return { content: [{ type: 'text' as const, text: entries.sort().join('\n') || '目录为空。' }], details: {} }
      }
    }
    if (fileMutations.has(tool.name) || (['bash', 'powershell'].includes(tool.name) && !readOnlyCommand(String(input.command ?? '')))) await beforeMutation()
    signal?.throwIfAborted()
    if (revalidate) await revalidate()
    return tool.execute(id, input, signal, update, context)
  } }))
}
