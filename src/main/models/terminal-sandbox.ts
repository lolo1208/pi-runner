import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rename, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { BashOperations } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'
import { checkGitWorkingDirectory, parseGitInspection } from './git-working-directory-check'
import { prepareSandboxConfiguration } from './sandbox-configuration'
import { developerCommand } from './developer-command-policy'
import { developerToolReads, rustToolInvocation } from './developer-tool-access'
import { createSandboxTemporaryDirectory, removeSandboxTemporaryDirectory } from './sandbox-temporary-directory'

interface NativeContext { home: string; scratch: string; profile: string; scratchIdentity: string }
async function directoryIdentity(directory: string): Promise<string> {
  const info = await stat(directory, { bigint: true })
  if (!info.isDirectory()) throw new ModelError(`沙箱目录已被替换为普通文件：${directory}`)
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`
}

export interface TerminalSandbox extends BashOperations {
  prepare(project: string, signal?: AbortSignal): Promise<void>
  checkGitWorkingDirectory?(project: string, signal?: AbortSignal): Promise<void>
  /** 配置或隔离失败必须由用户选择后续方式，不能转成普通命令审批。 */
  failClosed?: boolean
  developerTools?: boolean
}

const runtimeVersion = '0.159.2'
const runtimeChecksum = '52f75c649bebb8001102a1dd129c1ea6d02b0940321e6d7e82ee0526753bd58a'
const environmentKeys = new Set(['path', 'pathext', 'systemroot', 'windir', 'comspec', 'systemdrive', 'programfiles', 'programfiles(x86)', 'programw6432', 'programdata', 'psmodulepath', 'os', 'processor_architecture', 'number_of_processors', 'userprofile', 'homedrive', 'homepath', 'appdata', 'localappdata'])

/** 命令环境只继承运行工具所需的系统信息，不向子进程传递模型密钥或会话凭据。 */
export function sandboxEnvironment(home: string, scratch: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const redirected = new Set(['userprofile', 'appdata', 'localappdata'])
  const env = Object.fromEntries(Object.entries(inherited).filter(([key, value]) => value !== undefined && environmentKeys.has(key.toLowerCase()) && !redirected.has(key.toLowerCase())))
  // 在启动 PowerShell 前固定缓存路径，避免用户目录 API 不可用时退回当前项目。
  Object.assign(env, { PSModuleAnalysisCachePath: path.join(scratch, 'cache', 'ModuleAnalysisCache'), TMPDIR: scratch,
    XDG_DATA_HOME: path.join(scratch, 'data'), XDG_STATE_HOME: path.join(scratch, 'state'),
    PYTHONPYCACHEPREFIX: path.join(scratch, 'python-cache'), PIP_CACHE_DIR: path.join(scratch, 'pip-cache') })
  Object.assign(env, { USERPROFILE: scratch, APPDATA: path.join(scratch, 'appdata'), LOCALAPPDATA: path.join(scratch, 'localappdata') })
  // Rust 用户数据留在临时区；实际工具链安装文件由 developerToolReads 逐项只读授权。
  Object.assign(env, { RUSTUP_HOME: path.join(scratch, 'rustup'), RUSTUP_AUTO_INSTALL: '0', CARGO_HOME: path.join(scratch, 'cargo'), PLAYWRIGHT_BROWSERS_PATH: inherited.PLAYWRIGHT_BROWSERS_PATH ?? path.join(inherited.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright') })
  // Node 默认逐级 realpath 会探测项目外祖先；保留模块路径，链接目标仍由内核检查。
  // Git 不能访问宿主用户配置；使用隔离临时区作为 HOME，避免读取 .gitconfig 时直接失败。
  return { ...env, HOME: scratch, XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_CACHE_HOME: path.join(scratch, 'cache'), GIT_CONFIG_GLOBAL: 'NUL', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', CODEX_HOME: home, TEMP: scratch, TMP: scratch, NODE_OPTIONS: '--preserve-symlinks --preserve-symlinks-main', npm_config_cache: path.join(scratch, 'npm-cache'), npm_config_userconfig: path.join(scratch, 'config', 'npmrc'), npm_config_globalconfig: path.join(scratch, 'config', 'npm-globalrc'), npm_config_store_dir: path.join(scratch, 'pnpm-store'), PNPM_HOME: path.join(scratch, 'pnpm-home'), COREPACK_HOME: path.join(scratch, 'corepack'), COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', NO_COLOR: '1' }
}

export function sandboxProfile(project: string, scratch: string, protectedDirectories: string[], toolReads: string[] = []): string {
  // 独立的受限配置默认拒绝未列出的路径；不继承任何全盘读取权限。
  const filesystem: Record<string, string> = { ':minimal': 'read', [project]: 'write', [scratch]: 'write' }
  for (const entry of toolReads) filesystem[entry] = 'read'
  for (const directory of protectedDirectories) filesystem[directory] = 'deny'
  // 专用临时目录仅用于当前项目，独立于会话、凭据和快照。
  filesystem[scratch] = 'write'
  for (const name of ['.git', '.agents', '.codex', '.aws', '.pi-runner']) filesystem[path.join(project, name)] = name === '.git' ? 'read' : 'deny'
  const entries = Object.entries(filesystem).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',')
  return `permissions.pi-runner={filesystem={${entries}},network={enabled=false}}`
}

/** 原生 MXC 负责文件、网络和子进程隔离；不允许回退到弱隔离或无沙箱执行。 */
export class NativeTerminalSandbox implements TerminalSandbox {
  readonly developerTools = true
  private backend: 'mxc' | 'elevated' = 'mxc'
  setBackend(backend: 'mxc' | 'elevated'): void { this.backend = backend; this.reset() }
  reset(): void { this.contexts.clear(); this.runtimeChecked = undefined }
  resetProject(project: string): void { this.contexts.delete(project) }
  async checkBackend(backend: 'mxc' | 'elevated'): Promise<void> {
    // 固定运行时的兼容后端要求 :root 读取；不能用全盘读取冒充项目隔离。
    // 官方约束：windows-sandbox-rs/src/resolved_permissions.rs 的 validate_elevated_filesystem_policy。
    if (backend === 'elevated') throw new ModelError('当前 Windows 兼容后端无法限制项目外读取，不能启用严格隔离。此问题无法通过重新配置修复；请使用支持原生隔离的 Windows，或明确选择完全访问')
  }
  get legacyHome(): string { return path.join(os.homedir(), '.pi-runner-execution', createHash('sha256').update(path.resolve(this.options.dataDirectory)).digest('hex')) }
  async configureLegacy(signal?: AbortSignal): Promise<void> {
    await this.checkBackend('elevated')
    await this.checkRuntime()
    await this.checkLegacyRuntime()
    signal?.throwIfAborted()
    await mkdir(this.legacyHome, { recursive: true })
    const quote = (value: string): string => "'" + value.replace(/'/g, "''") + "'"
    const identity = [process.env.USERDOMAIN, os.userInfo().username].filter(Boolean).join('\\')
    const argumentLine = ['sandbox', 'setup', '--elevated', '--user', identity, '--codex-home', this.legacyHome].map(value => '"' + value.replace(/"/g, '\\"') + '"').join(' ')
    const script = `$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath ${quote(this.executable)} -ArgumentList ${quote(argumentLine)} -WorkingDirectory ${quote(this.legacyHome)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' })
      const timer = setTimeout(() => { cleanup(); child.kill(); reject(new ModelError('管理员配置仍未完成，请完成 Windows 授权后重新检测')) }, 180000)
      const abort = (): void => { cleanup(); child.kill(); reject(new ModelError('已停止等待配置；已启动的 Windows 管理员配置可能仍在完成')) }
      const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      child.once('error', () => { cleanup(); reject(new ModelError('无法启动管理员配置，请检查系统策略')) })
      child.once('close', code => { cleanup(); code === 0 ? resolve() : reject(new ModelError('管理员配置未成功或授权已取消；可重试配置，或联系管理员检查账户与防火墙策略')) })
    })
    signal?.throwIfAborted()
    this.setBackend('elevated')
  }
  private async checkLegacyRuntime(): Promise<void> {
    // 两个管理辅助程序也必须固定校验，禁止从 PATH 查找替代程序。
    for (const [name, checksum] of Object.entries({
      'codex-command-runner.exe': 'f9cdc39dc02c2208ecb65a7a4849b26ac1c368c35741eb015e448d0bfcd77159',
      'codex-windows-sandbox-setup.exe': '7efc654885230814c9499cf6b95f0c1aabae5c6f344ac70e2f57437c512f42b7'
    })) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path.join(this.options.runtimeDirectory, 'bin', name))) hash.update(chunk)
      if (hash.digest('hex') !== checksum) throw new ModelError('安全执行配置程序缺失或校验失败，请重新安装应用')
    }
  }
  private contexts = new Map<string, NativeContext>()
  private runtimeChecked?: Promise<void>
  constructor(private readonly options: { runtimeDirectory: string; dataDirectory: string; protectedDirectories: string[] }) {}
  private get executable(): string { return path.join(this.options.runtimeDirectory, 'bin', 'codex.exe') }
  async repair(project: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.resetProject(project)
    const root = await realpath(this.options.dataDirectory)
    const directory = path.join(root, createHash('sha256').update(project).digest('hex'))
    await mkdir(directory, { recursive: true })
    if (await realpath(directory) !== directory) throw new ModelError(`沙箱配置目录发生重定向：${directory}`)
    const home = path.join(directory, 'runtime-home')
    const info = await lstat(home).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
    if (info) {
      if (info.isSymbolicLink() || await realpath(home) !== home) throw new ModelError(`沙箱运行配置目录发生重定向：${home}`)
      // 保留旧配置供排查，只重建本项目的应用运行配置。
      await rename(home, path.join(directory, `runtime-home-backup-${Date.now()}`))
    }
    await mkdir(home)
  }
  async checkRuntime(): Promise<void> {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new ModelError('当前平台尚未提供经过验证的终端系统沙箱')
    this.runtimeChecked ??= (async () => {
      const manifest = JSON.parse(await readFile(path.join(this.options.runtimeDirectory, 'manifest.json'), 'utf8'))
      if (manifest.version !== runtimeVersion || manifest.platform !== 'win32' || manifest.arch !== 'x64') throw new Error('运行时版本不匹配')
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(this.executable)) hash.update(chunk)
      const checksum = hash.digest('hex')
      if (checksum !== runtimeChecksum || checksum !== manifest.files?.['bin/codex.exe']) throw new Error('运行时文件校验失败')
    })()
    try { await this.runtimeChecked }
    catch (error) { this.runtimeChecked = undefined; throw new ModelError(`终端系统沙箱运行时缺失或校验失败：${this.executable}；${error instanceof Error ? error.message : String(error)}。请恢复应用内置运行时`) }
  }
  async prepare(project: string, signal?: AbortSignal, developer = false): Promise<void> {
    signal?.throwIfAborted()
    await this.checkBackend(this.backend)
    await this.checkRuntime()
    const canonical = await realpath(project)
    if (canonical !== project || path.parse(project).root === project) throw new ModelError('项目路径发生变化或是整个盘符，不能启动终端系统沙箱')
    const protectedDirectories = await Promise.all([...this.options.protectedDirectories, this.options.runtimeDirectory, this.options.dataDirectory].map(directory => realpath(directory).catch(error => { if (error.code === 'ENOENT') return path.resolve(directory); throw error })))
    for (const root of protectedDirectories) {
      const relative = path.relative(root, project)
      if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new ModelError(`项目位于应用保护目录内，不能配置写入权限：${root}`)
    }
    if (this.contexts.has(project)) return
    if (this.backend === 'elevated') await this.checkLegacyRuntime()
    await mkdir(this.options.dataDirectory, { recursive: true })
    const directory = path.join(await realpath(this.options.dataDirectory), createHash('sha256').update(project).digest('hex'))
    await mkdir(directory, { recursive: true })
    if (await realpath(directory) !== directory) throw new ModelError(`沙箱配置目录发生重定向：${directory}`)
    const home = this.backend === 'elevated' ? this.legacyHome : path.join(directory, 'runtime-home')
    await mkdir(home, { recursive: true })
    if (await realpath(home) !== home) throw new ModelError(`沙箱运行配置目录发生重定向：${home}`)
    // 原生 deny 是递归边界，临时写入区不能放在被拒绝的应用数据目录之下。
    const scratch = await createSandboxTemporaryDirectory('pi-runner-command-', [...this.options.protectedDirectories, this.options.runtimeDirectory, this.options.dataDirectory])
    try {
      await prepareSandboxConfiguration(scratch)
      const context: NativeContext = { home, scratch, scratchIdentity: await directoryIdentity(scratch), profile: sandboxProfile(project, scratch, protectedDirectories, await developerToolReads(project, protectedDirectories)) }
      if (!developer) await checkGitWorkingDirectory({ exec: (command, cwd, options) => this.run(command, cwd, context, options) }, project, signal)
      signal?.throwIfAborted()
      this.contexts.set(project, context)
    } catch (error) {
      await removeSandboxTemporaryDirectory(scratch, 'pi-runner-command-')
      throw error
    }
  }
  async exec(command: string, cwd: string, options: Parameters<BashOperations['exec']>[2]): Promise<{ exitCode: number }> {
    options.signal?.throwIfAborted()
    const context = this.contexts.get(cwd)
    if (!context) throw new ModelError('终端系统沙箱尚未就绪，不能执行命令')
    if (await realpath(cwd) !== cwd) throw new ModelError('项目路径发生变化，不能执行命令')
    const queries = parseGitInspection(command)
    if (queries) {
      // 允许自动重试的查询不得写索引或启动 fsmonitor、外部 diff/textconv 程序。
      command = queries.map(args => {
        if (args[0] === 'diff') args.splice(1, 0, '--no-ext-diff', '--no-textconv')
        return `git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false ${args.map(arg => "'" + arg.replace(/'/g, "''") + "'").join(' ')}`
      }).join('; ')
    }
    const rust = await rustToolInvocation(command, cwd, options.signal)
    return this.run(rust?.command ?? command, cwd, context, options, rust?.env)
  }
  async execDevelopmentProbe(command: string, cwd: string, options: Parameters<BashOperations['exec']>[2]): Promise<{ exitCode: number }> {
    await this.prepare(cwd, options.signal, true)
    return this.run(command, cwd, this.contexts.get(cwd)!, options, {}, true)
  }
  private async run(command: string, cwd: string, context: NativeContext, options: Parameters<BashOperations['exec']>[2], runtimeEnv: NodeJS.ProcessEnv = {}, developmentProbe = false): Promise<{ exitCode: number }> {
    options.signal?.throwIfAborted()
    if (await realpath(context.scratch) !== context.scratch || await directoryIdentity(context.scratch) !== context.scratchIdentity) throw new ModelError(`命令临时目录已被替换或重定向，停止执行：${context.scratch}`)
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
    const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const literalCwd = cwd.replace(/'/g, "''")
    const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; try { New-PSDrive -Name Project -PSProvider FileSystem -Root '${literalCwd}' | Out-Null; Set-Location -LiteralPath 'Project:\\'; [Environment]::CurrentDirectory='${literalCwd}'; & {\n${command}\n}; if (-not $?) { exit 1 }; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { [Console]::Error.WriteLine($_.Exception.Message + '\n' + $_.InvocationInfo.PositionMessage); exit 1 }`
    const development = developmentProbe || await developerCommand(command, options.signal)
    const profile = development ? context.profile.replace('network={enabled=false}', 'network={enabled=true}') : context.profile
    const args = ['sandbox', '--permission-profile', 'pi-runner', '-C', cwd, '-c', profile, '-c', `windows.sandbox="${this.backend}"`, '-c', 'features.prefer_mxc=false', '-c', 'shell_environment_policy.inherit="all"', '--', powershell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) { reject(options.signal.reason); return }
      const env = { ...sandboxEnvironment(context.home, context.scratch), ...runtimeEnv, COREPACK_ENABLE_NETWORK: development ? '1' : '0' }
      const child = spawn(this.executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false
      const terminate = (): void => {
        if (!child.pid) return
        // MXC 会在宿主命令结束时终止隔离进程及其后代；taskkill 同时终止宿主进程树。
        const killer = spawn(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.once('error', () => { child.kill() })
      }
      const cleanup = (): void => { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', terminate) }
      child.stdout.on('data', options.onData); child.stderr.on('data', options.onData)
      child.once('error', error => { cleanup(); reject(new ModelError(`终端系统沙箱进程启动失败：${error.message}`)) })
      child.once('close', code => {
        cleanup()
        if (options.signal?.aborted) reject(options.signal.reason)
        else if (timedOut) reject(new ModelError('终端系统沙箱命令执行超时'))
        else resolve({ exitCode: code ?? 1 })
      })
      options.signal?.addEventListener('abort', terminate, { once: true })
      if (options.signal?.aborted) terminate()
      if (options.timeout !== undefined) timer = setTimeout(() => { timedOut = true; terminate() }, options.timeout * 1000)
    })
  }
}
