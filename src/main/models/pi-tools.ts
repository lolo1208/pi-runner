import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createReadToolDefinition, createLsToolDefinition, createFindToolDefinition, createGrepToolDefinition, createPowerShellToolDefinition, createBashToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'
import { DEFAULT_COMMAND_APPROVAL_REASON, type PermissionMode } from '../../shared/models'
import { commandRisk, highRiskFileMutation, readOnlyCommand } from './tool-permissions'
import { createDeleteToolDefinition, validateDeleteFile } from './delete-tool'
import { filesystemToolDefinitions, validateOrdinaryPath, validateOrdinaryTree } from './filesystem-tools'
import { createDownloadToolDefinition, validateDownloadArgs } from './download-tool'
import { canonicalToolPath, credentialBlacklist, hiddenProjectData, within, validateToolPathSyntax } from './security-paths'
import { restrictedSearch, restrictedLs } from './restricted-search'
import { validateToolInput } from './tool-inputs'
import { dependencyReadPath } from './dependency-read-path'
import { batchToolDefinitions, ToolApprovalStopped } from './batch-tools'
import { literalCommand } from './windows-command-parser'
import { validateReadArgs } from './read-tool-input'
import { textMutationToolDefinitions, validateTextMutationInput, validateTextMutationTarget } from './text-mutation-tools'
import { FileSnapshotStopped } from './tool-execution-errors'
import { skillScriptExtension, skillInterpreterScript } from './skill-script-policy'
import { pick, type PromptLang } from '../../shared/prompt-lang'

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
  trustedSkillScript?(script: string): Promise<boolean>
  approve(id: string, tool: string, args: Record<string, unknown>, reason: string, signal?: AbortSignal, mustConfirm?: boolean): Promise<void>
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

export function piProjectTools(root: string, beforeMutation: () => Promise<void>, permissions?: ToolPermissionContext, lang: PromptLang = 'zh'): ToolDefinition[] {
  const protectPath = async (target: string): Promise<void> => {
    validateToolPathSyntax(target)
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
  const definitions: ToolDefinition<any, any>[] = [createReadToolDefinition(root), ...textMutationToolDefinitions(root, protectPath, lang), createDownloadToolDefinition(protectPath, { fetchRequest: permissions?.downloadFetch }, lang), createDeleteToolDefinition(lang), ...filesystemToolDefinitions(protectPath, lang), createLsToolDefinition(root), createFindToolDefinition(root), createGrepToolDefinition(root), process.platform === 'win32' ? createPowerShellToolDefinition(root, localShellOptions) : createBashToolDefinition(root, localShellOptions)]
  const terminalOptions = (tool: ToolDefinition<any, any>) => ({
    parameters: tool.parameters,
    description: [tool.description,
      permissions?.mode === 'auto' ? pick(lang, '项目自审：命令由应用规则或审核模型判断，必要时请求用户确认；常见开发命令并非无条件放行。直接文件操作和下载落盘须用专用工具，不得以脚本绕过。', 'Project self-review: commands are decided by app rules or a review model, asking the user when necessary; common dev commands are not unconditionally allowed. Direct file operations and downloads to disk must use dedicated tools, not scripts.') : '',
      pick(lang, 'partial-or-unknown 时先核对结果，只补做剩余步骤；denied 或 awaiting-approval 时不要重复申请相同授权。', 'On partial-or-unknown, verify results first and only redo remaining steps; on denied or awaiting-approval, do not re-request the same authorization.')
    ].filter(Boolean).join(' ')
  })
  const approve: ToolPermissionContext['approve'] = async (...args) => {
    try { await permissions!.approve(...args) }
    catch (error) { throw new ToolApprovalStopped(error instanceof Error ? error.message : String(error)) }
  }
  const wrapped: ToolDefinition<any, any>[] = definitions.map(tool => ({ ...tool,
    ...(['bash', 'powershell'].includes(tool.name) ? terminalOptions(tool) : {}),
    ...(tool.name === 'ls' ? { description: pick(lang, '列出目录，默认最多 500 项，可用 limit 指定 1–1000 项；输出最多 50000 字符，扫描最多 20000 项。按名称排序，目录带 / 后缀，过滤链接和受保护内容；结果不完整时明确提示，请用 find 缩小范围。', 'List a directory, up to 500 items by default (limit 1–1000); output up to 50000 characters, scan up to 20000 items. Sorted by name, directories end with /; links and protected content are filtered; when results are incomplete it says so explicitly — use find to narrow the scope.') } : {}),
    ...(tool.name === 'read' ? { description: pick(lang, `${tool.description} 允许读取项目 node_modules 内、解析后仍位于该目录内的依赖链接文件（如 pnpm）；其他链接和链接写入仍禁止。`, `${tool.description} Reading dependency-linked files inside the project's node_modules (e.g., pnpm) whose resolved target stays within that directory is allowed; other links and link writes remain forbidden.`) } : {}),
    ...(['find', 'grep'].includes(tool.name) ? { description: [
      tool.name === 'find' ? pick(lang, '按 glob 查找普通文件和目录，默认及最多返回 1000 项。', 'Find ordinary files and directories by glob; returns up to 1000 items by default and maximum.') : pick(lang, '搜索普通文件内容，默认返回 100 项，最多 1000 项。跳过二进制和大于 1 MiB 的文件，匹配行最多展示 500 字符；正则单文件限时 100 毫秒，字面搜索用 literal=true。', 'Search ordinary file contents; returns 100 items by default, 1000 max. Skips binaries and files over 1 MiB; matched lines show up to 500 characters; regex per file is limited to 100 ms; use literal=true for literal search.'),
      pick(lang, '不跟随链接，排除 Git 元数据、应用内部数据和 node_modules；输出最多 50000 字符、扫描最多 20000 项。截断或跳过时缩小范围，不能据此断言无匹配。', 'Does not follow links; excludes Git metadata, app internal data, and node_modules; output up to 50000 characters, scan up to 20000 items. When truncated or skipped, narrow the scope; do not conclude "no matches".')
    ].join(' ') } : {}),
    execute: async (id, args, signal, update, context) => {
    signal?.throwIfAborted()
    // 固定批准的参数，调用方后续修改原对象不能改变实际执行内容。
    const input = validateToolInput(tool.name, structuredClone(args))
    if (tool.name === 'read') validateReadArgs(input)
    let revalidate: (() => Promise<void>) | undefined
    let forceApproval = false
    if (!permissions) {
      // 未提供权限上下文时不允许具有副作用的工具悄悄执行。
      if (fileMutations.has(tool.name) || ['bash', 'powershell'].includes(tool.name)) throw new ModelError('工具执行缺少权限上下文')
      input.path = await projectToolPath(root, String(input.path))
      await protectPath(String(input.path))
      const scope = { protectedDirectories: credentialBlacklist(), check: protectPath, signal }
      if (['find', 'grep'].includes(tool.name)) return restrictedSearch(tool.name, input, scope)
      if (tool.name === 'ls') return restrictedLs(input, scope)
    } else if (['bash', 'powershell'].includes(tool.name)) {
      const command = String(input.command ?? '')
      let risk = commandRisk(command, root)
      // 仅信任本轮已加载技能的单条字面量调用；禁止规则和强制人工确认优先。
      if (permissions.mode === 'auto' && risk.risk === 'approve' && !risk.mustConfirm && permissions.trustedSkillScript) {
        const words = literalCommand(command)
        const plainArguments = words?.every(word => !/[&|<>^%!\r\n"`$]/.test(word))
        const interpretedScript = words && plainArguments && (process.platform === 'win32'
          ? tool.name === 'powershell' : tool.name === 'bash' && !/[\\`$*?\[\]{}~\r\n]/.test(command) && !/^\s*&/.test(command))
          ? skillInterpreterScript(words) : undefined
        // CMD 会再次解释参数，连引号内的元字符、环境变量和转义符也不能信任。
        const cmdScript = process.platform === 'win32' && tool.name === 'powershell' && words?.length
          && /^(?:|\.(?:cmd|bat|ps1))$/i.test(path.extname(words[0])) && plainArguments
          ? words[0] : undefined
        // POSIX 不使用 PowerShell 的 & 调用符，也不接受转义、展开或通配符。
        // literalCommand 负责检查引号外的命令连接、管道与重定向。
        const posixScript = process.platform !== 'win32' && tool.name === 'bash' && words?.length
          && !/[\\`$*?\[\]{}~\r\n]/.test(command) && !/^\s*&/.test(command)
          && skillScriptExtension(words[0]) ? words[0] : undefined
        const script = interpretedScript ?? cmdScript ?? posixScript
        if (script && path.isAbsolute(script) && await permissions.trustedSkillScript(script)) risk = { risk: 'safe' }
      }
      if (risk.risk === 'block') throw new ModelError(risk.reason ?? '终端命令被安全策略拦截')
      if (permissions.mode === 'default') {
        await approve(id, tool.name, input, DEFAULT_COMMAND_APPROVAL_REASON, signal)
      } else if (permissions.mode === 'auto' && risk.risk === 'approve') {
        await approve(id, tool.name, input, risk.reason ?? DEFAULT_COMMAND_APPROVAL_REASON, signal, risk.mustConfirm)
      }
      signal?.throwIfAborted()
    } else {
      if (tool.name === 'download') validateDownloadArgs(input)
      if (['write', 'edit'].includes(tool.name)) {
        validateTextMutationInput(tool.name, input)
        await validateTextMutationTarget(path.resolve(root, String(input.path)))
      }
      const originalPath = path.resolve(root, typeof input.path === 'string' ? input.path : '.')
      const requestedPath = tool.name === 'read' ? await dependencyReadPath(root, originalPath) : originalPath
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
        if (tool.name === 'read' && await dependencyReadPath(root, originalPath) !== requestedPath) throw new ModelError('依赖链接目标发生变化，请重新请求读取')
        if (['write', 'edit'].includes(tool.name)) await validateTextMutationTarget(target)
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
      if (reason) await approve(id, tool.name, { ...input, path: target }, reason, signal, forceApproval)
      signal?.throwIfAborted()
      if (await canonicalToolPath(target) !== target) throw new ModelError('审批期间目标路径发生变化，请重新请求操作')
      // 固定已校验的规范路径，不再使用原始链接路径。
      input.path = target
      const scope = { protectedDirectories: [...protectedDirectories, ...credentialDirectories], check: protectPath, signal, workspace }
      if (['find', 'grep'].includes(tool.name)) return restrictedSearch(tool.name, input, scope)
      if (tool.name === 'ls') return restrictedLs(input, scope)
    }
    if (fileMutations.has(tool.name) || (['bash', 'powershell'].includes(tool.name) && !readOnlyCommand(String(input.command ?? '')))) {
      try { await beforeMutation() }
      catch (error) { throw new FileSnapshotStopped(`保存修改前快照失败，已停止后续操作：${error instanceof Error ? error.message : String(error)}`) }
    }
    signal?.throwIfAborted()
    if (revalidate) await revalidate()
    return tool.execute(id, input, signal, update, context)
  } }))
  return [...wrapped, ...batchToolDefinitions(root, wrapped, permissions?.mode === 'default' ? 1 : 4, lang)]
}
