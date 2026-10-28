import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import type { AgentEvent, ToolApproval } from '../../shared/models'
import { ModelError } from './model-validation'
import { toolApprovalPreview } from './tool-approval-preview'
import { literalCommand } from './windows-command-parser'
import { knownReadOnlyQuery, readOnlyGitQuery, readOnlyQueryInvocation } from './snapshot-read-only-queries'
import { within } from './security-paths'
import { downloadNeedsReview, shellDownloadWrites } from './download-command-policy'
import { commandReview, statementReview } from './command-review-policy'
import { destructiveCommandReason, shellFileMutationReason } from './blocked-command-policy'
import { developerToolPolicy, developerToolTargets, windowsDeveloperSwitch } from './developer-tool-policy'
import { inspectedShellCommands, shellProgram } from './shell-command-words'
import { powerShellReadOnly } from './powershell-read-only'

/** 审批只授予当前工具调用；停止任务后所有待审批立即失效。 */
export class ToolApprovalManager {
  private pending = new Map<string, { requestId: string; conversationId: string; details: ToolApproval; finish(allow: boolean): void }>()
  constructor(private readonly emit: (event: AgentEvent) => void) {}
  async ask(requestId: string, conversationId: string, details: Omit<ToolApproval, 'id'>, signal: AbortSignal, onWaiting: (waiting: boolean) => void, rejectOnDeny = true): Promise<boolean> {
    signal.throwIfAborted()
    const id = randomUUID()
    const allowed = await new Promise<boolean>((resolve, reject) => {
      const cleanup = (): void => {
        this.pending.delete(id)
        signal.removeEventListener('abort', abort)
        onWaiting(false)
        this.emit({ type: 'approval-end', requestId, conversationId, approvalId: id })
      }
      const abort = (): void => { cleanup(); reject(new ModelError('工具审批已取消')) }
      this.pending.set(id, { requestId, conversationId, details: structuredClone({ ...details, id }), finish: allow => { cleanup(); resolve(allow) } })
      signal.addEventListener('abort', abort, { once: true })
      onWaiting(true)
      this.emit({ type: 'approval', requestId, conversationId, approval: { ...details, id } })
    })
    signal.throwIfAborted()
    if (!allowed && rejectOnDeny) throw new ModelError('用户拒绝了本次工具操作；请调整方案，不要重复尝试相同操作')
    return allowed
  }
  respond(requestId: string, conversationId: string, id: string, allow: boolean): void {
    const pending = this.pending.get(id)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) throw new ModelError('审批请求已失效或不属于当前任务')
    pending.finish(allow)
  }
  async preview(requestId: string, conversationId: string, id: string) {
    const pending = this.pending.get(id)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) throw new ModelError('审批请求已失效或不属于当前任务')
    const preview = await toolApprovalPreview(pending.details)
    if (this.pending.get(id) !== pending) throw new ModelError('审批请求已失效')
    return preview
  }
}

// 这些 Git 子命令只读取仓库状态；reflog 改写、外部 diff 与 --output 等写文件参数另行排除。
const readOnlyGitSubcommands = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'rev-list', 'blame', 'describe', 'cat-file', 'ls-files', 'ls-tree', 'grep', 'shortlog', 'whatchanged', 'reflog', 'count-objects', 'for-each-ref', 'show-ref', 'name-rev', 'merge-base', 'version', 'help'])

/** 只拆分引号外的顺序/条件连接及管道；各阶段均须独立通过分类，拒绝展开和后台运行。 */
/** Windows 下仅规整三类无副作用写法：stderr 合并到 stdout、字符串后拼接 $LASTEXITCODE 的输出语句。 */
function scrubWindowsInertSyntax(command: string): string {
  if (process.platform !== 'win32') return command
  return command
    .replace(/(^|\s)2>&1(?=\s|$|[;|])/g, '$1')
    .replace(/(^|[;|\r\n]\s*)("[^"$`\r\n]*")\s*\+\s*\$LASTEXITCODE(?=\s*(?:$|[;|\r\n]))/gi, '$1$2')
}

function readOnlyStatements(input: string): string[] | undefined {
  const command = scrubWindowsInertSyntax(input)
  if (!command.trim() || command.length > 16000 || /[`$\0]/.test(command)) return undefined
  const statements: string[] = []
  let start = 0, quote = ''
  for (let index = 0; index < command.length; index++) {
    const character = command[index]
    if (quote) {
      if (process.platform !== 'win32' && quote === '"' && character === '\\') return undefined
      if (character === quote) {
        if (quote === "'" && command[index + 1] === "'") { if (process.platform !== 'win32') return undefined; index++ }
        else quote = ''
      }
      continue
    }
    if (character === '"' || character === "'") { quote = character; continue }
    // POSIX 转义和通配符展开可能把看似普通的实参变成 --pre/-o 等选项。
    if (process.platform !== 'win32' && /[\\*?]/.test(character)) return undefined
    if (/[<>(){}#]/.test(character)) return undefined
    if (character === '&' && !command.slice(start, index).trim() && /\s/.test(command[index + 1] ?? '')) continue
    if (character === ';' || character === '\n' || character === '\r' || character === '|' || character === '&' && command[index + 1] === character) {
      const statement = command.slice(start, index).trim()
      if (!statement && character !== '\n' && character !== '\r') return undefined
      if (statement) statements.push(statement)
      if ((character === '&' || character === '|') && command[index + 1] === character) index++
      start = index + 1
      if ((character === '&' || character === '|') && !command.slice(start).trim()) return undefined
    } else if (character === '&' || character === '|') return undefined
  }
  if (quote) return undefined
  const last = command.slice(start).trim()
  if (last) statements.push(last)
  return statements.length ? statements : undefined
}

function readOnlyStatement(command: string): boolean {
  // Windows PowerShell 中单独的字符串字面量只输出文本，不执行命令。
  if (process.platform === 'win32' && /^(?:"[^"$`\r\n]*"|'[^'\r\n]*')$/.test(command.trim())) return true
  const tokens = literalCommand(command)
  if (!tokens) return false
  const program = commandProgram(tokens[0])
  if (!program) return false
  // 显式 .exe 调用不经过 PowerShell 别名解析，不能继承同名别名的只读规则。
  if (/\.exe$/i.test(tokens[0]) && ['compare', 'select', 'measure', 'fl', 'ft', 'fw', 'gc', 'gi', 'gci', 'gps', 'gsv', 'gal', 'gcm', 'gl', 'sls'].includes(program)) return false
  const args = tokens.slice(1)
  if (statementReview(program, args)) return false
  if (['cd', 'chdir', 'set-location', 'sl'].includes(program)) {
    const paths = ['-path', '-literalpath', '/d'].includes(args[0]?.toLowerCase()) ? args.slice(1) : args
    return paths.length === 1 && !paths[0].startsWith('-')
  }
  if (program === 'date') return args.length === 0 || args.every(value => value === '-u' || value === '--utc' || value.startsWith('+'))
  if (program !== 'git') return knownReadOnlyQuery(program, args)
  if (args.length === 1 && args[0] === '--version') return true
  let index = 0
  // 跳过不改变只读语义的 Git 全局选项，例如 git --no-pager status。
  while (index < args.length) {
    const value = args[index]
    if (value === '-c' || value.startsWith('-c')) {
      const setting = value === '-c' ? args[++index] : value.slice(2)
      // 仅识别显示参数及关闭文件系统监视器，其他配置仍按可能执行脚本处理。
      if (!/^(?:core\.quotepath=(?:true|false)|color\.ui=(?:false|never|auto|always)|core\.fsmonitor=false)$/i.test(setting ?? '')) return false
      index++; continue
    }
    if (['--no-pager', '--no-optional-locks', '--literal-pathspecs', '--no-replace-objects'].includes(value)) { index++; continue }
    if (value === '-C') { if (!args[index + 1]) return false; index += 2; continue }
    if (value.startsWith('--git-dir=') || value.startsWith('--work-tree=') || value.startsWith('--namespace=')) { index++; continue }
    break
  }
  const subcommand = args[index]?.toLowerCase()
  if (!subcommand) return false
  const queryArgs = args.slice(index + 1)
  if (queryArgs.some(value => /^--(?:out|ext-diff|textconv)/i.test(value))) return false
  if (subcommand === 'cat-file' && queryArgs.includes('--filters')) return false
  if (subcommand === 'help' && queryArgs.some(value => ['-w', '--web', '-m', '--man', '-i', '--info'].includes(value))) return false
  return readOnlyGitQuery(subcommand, queryArgs)
}

/** 所有语句都能确认为只读时才跳过基线；未知命令仍在执行前保护文件。 */
export function readOnlyCommand(command: string): boolean {
  if (/^\s*\$PSVersionTable(?:\.PSVersion)?\s*$/i.test(command)) return true
  if (readOnlyStatements(command)?.every(readOnlyStatement)) return true
  return process.platform === 'win32' && powerShellReadOnly(command, readOnlyStatement)
}

/** 每次询问或项目自审模式中的敏感路径；完全访问模式不再逐项确认。 */
export function highRiskFileMutation(target: string): boolean {
  const normalized = target.replace(/\\/g, '/').toLowerCase()
  return /^(?:[a-z]:\/(?:windows|program files(?: \(x86\))?|programdata)(?:\/|$)|\/(?:etc|boot|system|library|bin|sbin)(?:\/|$)|\/usr\/(?:bin|sbin|lib)(?:\/|$))/.test(normalized)
    || /\/(?:\.(?:bashrc|bash_profile|zshrc|zshenv|profile|gitconfig)|\.ssh\/(?:config|authorized_keys|known_hosts))$/.test(normalized)
    || /\/(?:\.config\/autostart|start menu\/programs\/startup|library\/(?:launchagents|launchdaemons))(?:\/|$)/.test(normalized)
}

/** 检测明显的整盘抹除/格式化指令。 */
export function isDestructiveCommand(command: string): string | undefined {
  return destructiveCommandReason(command)
}

export function blockShellFileMutation(command: string): string | undefined {
  const mutation = shellFileMutationReason(command)
  if (mutation) return mutation
  if (shellDownloadWrites(command)) return '检测到终端下载命令写入文件。请改用 download 工具，传入 URL 和目标路径。'
  return undefined
}

/** 检测明显的 Everyone 写入授权或 NULL DACL 设置；批准后仍只授权本次调用。 */
export function commandAclPreflight(command: string): string | undefined {
  const broadPrincipal = String.raw`(?:Everyone|\*S-1-1-0|S-1-1-0|WORLD)`
  const broadRights = String.raw`(?:FullControl|Modify|Write|GenericAll|GenericWrite|0x1f01ff|0x1301bf)`
  if (new RegExp(String.raw`\bicacls(?:\.exe)?\b[^\r\n;]*?\/(?:grant|grant:r)\b[^\r\n;]*?${broadPrincipal}\s*:\s*(?:\([OICN,]+\])*\(?[FMW]\)?(?=\s|;|$)`, 'i').test(command) ||
      new RegExp(String.raw`\b(?:FileSystemAccessRule|RegistryAccessRule|AddAccessRule|SetAccessRule)\b[^\r\n;]{0,160}?${broadPrincipal}[^\r\n;]{0,80}?\b${broadRights}\b`, 'i').test(command) ||
      /\b(?:chmod|install)\b[^\r\n;]*?(?:\s|=)(?:0?[0-7]{2}[2367]|[ao]\+[rwx]*w[rwx]*)(?=\s|;|$)/i.test(command)) {
    return '命令明显尝试向 Everyone 或所有用户授予写入权限。执行前需要批准。'
  }
  if (/\b(?:SetNamedSecurityInfo|SetSecurityInfo|SetFileSecurity|SetKernelObjectSecurity)\b/i.test(command) &&
      /(?:\b(?:NULL|nullptr|IntPtr\.Zero|nil)\b|\$null\b)/i.test(command) &&
      /\b(?:DACL|DiscretionaryAcl|DACL_SECURITY_INFORMATION|SE_DACL_PRESENT)\b/i.test(command) ||
      /\bSetSecurityDescriptorDacl\b[^\r\n;]*?(?:\b(?:NULL|nullptr|IntPtr\.Zero)\b|\$null\b)/i.test(command)) {
    return '命令明显尝试设置 NULL DACL，可能向所有用户开放写入权限。执行前需要批准。'
  }
  return undefined
}

/** 可信项目中的常见开发操作；仍需修改前快照，不将构建/测试脚本视为只读。 */
const safeDeveloperPrograms = new Set([
  'npm', 'pnpm', 'yarn', 'npx',
  'pip', 'pip3', 'uv', 'poetry',
  'cargo', 'rustc', 'rustup',
  'go', 'gofmt',
  'dotnet', 'nuget', 'msbuild',
  'make', 'cmake', 'ninja', 'meson', 'gradlew', 'mvnw',
  'gcc', 'g++', 'clang', 'clang++',
  'pytest', 'vitest', 'jest', 'mocha', 'eslint', 'prettier', 'tsc', 'vite', 'webpack', 'rollup', 'esbuild', 'turbo', 'nx', 'lerna',
  'mvn', 'gradle', 'sbt', 'lein', 'cabal', 'stack',
  'dart', 'flutter',
  'curl', 'wget',
  'vue-tsc', 'svelte-check', 'parcel', 'rspack', 'rsbuild', 'swc', 'biome', 'oxlint', 'oxfmt',
  'ruff', 'black', 'mypy', 'isort', 'tox', 'nox', 'hatch', 'pdm',
  'cc', 'c++', 'clang-cl', 'swiftc', 'csc', 'fsc', 'ant', 'bazel', 'bazelisk', 'just', 'task'
])

/** Windows 包管理器、构建器的标准 cmd/bat 启动器；任意脚本扩展名不据此放行。 */
function commandProgram(command: string): string | undefined {
  const executable = command.split(/[\\/]/).at(-1)!.toLowerCase()
  if (/\.(?:cmd|bat)$/.test(executable)) {
    const name = executable.replace(/\.(?:cmd|bat)$/, '')
    const standardLauncher = safeDeveloperPrograms.has(name) && !['curl', 'wget'].includes(name)
      || ['corepack', 'bunx', 'next', 'nuxt', 'nuxi', 'astro', 'composer', 'bundle', 'bundler', 'jupyter', 'tauri', 'tsx', 'ts-node', 'ts-node-esm', 'vcpkg', 'msbuild'].includes(name)
    return standardLauncher ? name : undefined
  }
  if (/\.(?:ps1|sh)$/.test(executable)) return undefined
  return executable.replace(/\.exe$/, '')
}

function additionalDeveloperCommand(program: string, args: string[]): boolean {
  if (program === 'corepack') return ['npm', 'pnpm', 'yarn'].includes(args[0]) && !developerNeedsReview(args[0], args.slice(1))
  if (program === 'bunx') return args.length > 0
  if (['next', 'nuxt', 'nuxi', 'astro'].includes(program)) return ['dev', 'build', 'start', 'preview', 'generate', 'prepare', 'check', 'typecheck', 'typegen', 'lint', 'sync', 'info'].includes(args[0])
  if (program === 'zig') return ['build', 'build-exe', 'build-lib', 'build-obj', 'test', 'fmt', 'cc', 'c++'].includes(args[0])
  if (program === 'swift') return ['build', 'test', 'run'].includes(args[0]) || args[0] === 'package' && ['resolve', 'update', 'describe', 'show-dependencies', 'dump-package'].includes(args[1])
  if (['bundle', 'bundler'].includes(program)) return ['install', 'update', 'exec', 'check', 'lock', 'info', 'show', 'list', 'outdated'].includes(args[0])
  if (program === 'composer') return ['install', 'update', 'dump-autoload', 'validate', 'check-platform-reqs', 'audit', 'show', 'outdated', 'run-script', 'test'].includes(args[0])
  if (program === 'jupyter') return ['lab', 'notebook', 'nbconvert', 'kernelspec', '--paths', '--version'].includes(args[0]) && !(args[0] === 'kernelspec' && args[1] !== 'list')
  return false
}

/** 发布、账户/全局配置及嵌套文件命令不因开发工具的程序名绕过审核。 */
function developerNeedsReview(program: string, args: string[]): boolean {
  if (program === 'mvnw') program = 'mvn'
  if (program === 'gradlew') program = 'gradle'
  if (args.some(value => /^(?:publish|unpublish|login|logout|adduser|token|owner|team|deploy|release)$/i.test(value) || /(?:^|:)deploy(?:$|@)/i.test(value) || /^publish(?:To|All|Plugins)/.test(value))) return true
  if (args.some(value => /^(?:clean|cleanall|distclean|mrproper|clobber|purge|prune|uninstall|remove|uninstall-self|self-uninstall)$/i.test(value) || /^--(?:force|break-system-packages|delete|prune|clear|wipe|reset)(?:=|$)/i.test(value))) return true
  if (program === 'rustup') return true
  if (program === 'cargo' && ['install', 'uninstall'].includes(args[0])) return true
  if (program === 'uv' && ['tool', 'python', 'self'].includes(args[0])) return true
  if (['npm', 'pnpm', 'yarn', 'pip', 'pip3', 'uv', 'poetry', 'pdm', 'hatch', 'bun', 'deno'].includes(program) && args.some(value => /^(?:--(?:global|user|system|prefix|target|root)(?:=|$)|-g$)/.test(value))) return true
  if (['npm', 'pnpm', 'yarn', 'cargo', 'uv', 'poetry', 'pdm', 'hatch', 'dotnet', 'nuget', 'mvn', 'gradle'].includes(program)) {
    if (args[0] === 'config' && ['set', 'delete', 'unset', 'edit'].includes(args[1])) return true
    if (['dotnet', 'nuget'].includes(program) && args.some(value => ['push', 'delete', 'setapikey'].includes(value.toLowerCase()))) return true
  }
  if (program === 'cmake' && args.includes('-E')) return true
  if (['cmake', 'meson'].includes(program) && args.some(value => ['--install', 'install', '--wipe'].includes(value))) return true
  return false
}

/** 内联求值、启动钩子和未知解释器选项均交给审核。 */
function safeInterpreter(program: string, args: string[]): boolean | undefined {
  const python = /^python(?:\d+(?:\.\d+)?)?$/.test(program) || program === 'py'
  if (python && args[0] === '-m') return ['pip', 'pytest', 'unittest', 'venv', 'build', 'compileall', 'ruff', 'black', 'mypy', 'isort', 'tox', 'nox'].includes(args[1]) && !developerNeedsReview(args[1], args.slice(2))
  if (python || ['ruby', 'php'].includes(program)) {
    if (args.length === 1 && ['--version', '-V', '--help', '-h'].includes(args[0])) return true
    if (!args.length || args[0].startsWith('-')) return false
    return /\.(?:[cm]?js|py|rb|php)$/i.test(args[0])
  }
  return undefined
}

function gitSafeSubcommand(args: string[]): boolean {
  let index = 0
  while (index < args.length) {
    const value = args[index]
    if (value === '-C' && args[index + 1]) { index += 2; continue }
    if (['--no-pager', '--no-optional-locks'].includes(value)) { index++; continue }
    if (value.startsWith('-')) return false
    break
  }
  const subcommand = args[index]?.toLowerCase()
  if (!subcommand) return false
  // 此函数仅处理尚未匹配只读规则的调用，查询失败不能再次按 Git 名称放行。
  if (readOnlyGitSubcommands.has(subcommand) || ['check-ignore', 'check-attr', 'diff-files', 'diff-index', 'diff-tree'].includes(subcommand)) return false
  if (['branch', 'tag'].includes(subcommand) && args.slice(index + 1).some(value => value.startsWith('-'))) return false
  if (args.some(value => /^--(?:output|ext-diff|textconv)(?:=|$)/.test(value))) return false
  if (subcommand === 'push' && args.some(value => /^(?:--(?:force(?:-with-lease|-if-includes)?|mirror|delete)(?:=|$)|-[a-z]*[fd]|\+|:)/.test(value))) return false
  if (['checkout', 'restore', 'switch', 'branch', 'tag'].includes(subcommand) && args.some(value => /^(?:--(?:force|delete|discard-changes|force-create)|-[a-z]*[fdDBCM])/.test(value))) return false
  // checkout 的裸参数可能是分支，也可能是丢弃修改的文件路径，无法仅凭词语区分。
  if (subcommand === 'restore' || subcommand === 'checkout') return false
  if (subcommand === 'branch' && args.some(value => ['-m', '--move', '--copy', '-c'].includes(value))) return false
  if (subcommand === 'rebase' && args.some(value => /^(?:--exec(?:=|$)|-x)/.test(value))) return false
  return new Set(['status', 'diff', 'log', 'show', 'add', 'commit', 'fetch', 'pull', 'push', 'clone', 'init', 'branch', 'switch', 'checkout', 'restore', 'merge', 'rebase', 'tag', 'rev-parse', 'ls-files']).has(subcommand)
}

function safeDeveloperStatement(command: string): boolean {
  const tokens = literalCommand(command)
  if (!tokens) return false
  const program = commandProgram(tokens[0])
  if (!program) return false
  const args = tokens.slice(1)
  if (statementReview(program, args)) return false
  if (downloadNeedsReview(program, args)) return false
  if (readOnlyStatement(command)) return true
  if (readOnlyQueryInvocation(program, args)) return false
  if (developerNeedsReview(program, args)) return false
  if (program === 'git') return gitSafeSubcommand(args)
  const toolPolicy = developerToolPolicy(program, args)
  if (toolPolicy) return toolPolicy.kind === 'develop'
  const interpreter = safeInterpreter(program, args)
  if (interpreter !== undefined) return interpreter
  return safeDeveloperPrograms.has(program) || additionalDeveloperCommand(program, args)
}

export function safeDeveloperCommand(command: string): boolean {
  if (readOnlyStatements(command)?.every(safeDeveloperStatement)) return true
  if (process.platform !== 'win32' || command.length > 16000) return false
  // 从末尾逐块检查连续成功条件，不求值条件，也不允许任意脚本或嵌套块。
  let remaining = command
  for (let count = 0; count < 64; count++) {
    const guarded = remaining.match(/^([\s\S]+);\s*if\s*\(\s*(?:\$LASTEXITCODE\s+-eq\s+0|\$\?)\s*\)\s*\{([^{}]+)\}\s*;?\s*$/i)
    if (!guarded || !readOnlyStatements(guarded[2])?.every(safeDeveloperStatement)) return false
    remaining = guarded[1]
    if (readOnlyStatements(remaining)?.every(safeDeveloperStatement)) return true
  }
  return false
}

export interface CommandRisk { risk: 'block' | 'safe' | 'approve'; reason?: string; mustConfirm?: boolean }

/** 显式指定项目/临时目录外目标或全局安装时，常见开发命令也进入审核。 */
function externalDeveloperTarget(command: string, cwd: string): boolean {
  const roots = [path.resolve(cwd), path.resolve(os.tmpdir())]
  return inspectedShellCommands(command).some(words => {
    const program = shellProgram(words[0]).replace(/\.(?:cmd|bat)$/i, '')
    const original = words.slice(1)
    const args = [...original.filter(value => !windowsDeveloperSwitch(program, value)), ...developerToolTargets(program, original)]
    return args.some(argument => {
      if (['npm', 'pnpm', 'yarn', 'pip', 'pip3', 'bun', 'deno', 'corepack', 'npx', 'uv', 'poetry', 'pdm', 'hatch'].includes(program) && ['--global', '-g', 'global'].includes(argument)) return true
      const value = argument.replace(/^--?[\w-]+=/, '').replace(/^-(?:o|I|C)(?=\/|\\|\.\.[\\/])/, '')
      if (/^[a-z][\w+.-]*:\/\//i.test(value)) return false
      if (/^~(?:[\\/]|$)/.test(value)) return true
      if (!path.isAbsolute(value) && !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value)) return false
      const target = path.resolve(cwd, value)
      return !roots.some(root => within(root, target))
    })
  })
}

/** 终端命令统一风险路由：block 直接拒绝，safe 直接执行，approve 请求批准。 */
export function commandRisk(command: string, cwd?: string): CommandRisk {
  const destructive = isDestructiveCommand(command)
  if (destructive) return { risk: 'block', reason: destructive }
  const mutation = blockShellFileMutation(command)
  if (mutation) return { risk: 'block', reason: mutation }
  const acl = commandAclPreflight(command)
  if (acl) return { risk: 'approve', reason: acl, mustConfirm: true }
  const review = commandReview(command)
  if (review) return { risk: 'approve', ...review }
  if (readOnlyCommand(command)) return { risk: 'safe' }
  if (safeDeveloperCommand(command) && !(cwd && externalDeveloperTarget(command, cwd))) return { risk: 'safe' }
  return { risk: 'approve', reason: '命令未满足只读或常见开发操作的直接放行条件，需要审核其副作用、目标路径及用户授权。' }
}
