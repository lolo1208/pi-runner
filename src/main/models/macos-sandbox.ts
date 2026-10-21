import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SandboxBackend } from '../../shared/sandbox'
import type { TerminalSandbox } from './terminal-sandbox'
import { ModelError } from './model-validation'
import { developerCommand } from './developer-command-policy'
import { developerToolReads } from './developer-tool-access'

const executable = '/usr/bin/sandbox-exec'
const shell = '/bin/bash'
const systemReads = ['/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/libexec', '/usr/share', '/System/Library', '/System/Cryptexes/OS/usr/lib', '/Library/Apple', '/private/var/db/timezone', '/opt/homebrew/bin', '/opt/homebrew/lib', '/opt/homebrew/Cellar', '/opt/homebrew/opt', '/opt/homebrew/share', '/usr/local/bin', '/usr/local/lib', '/usr/local/Cellar', '/usr/local/opt', '/usr/local/share']
const quoted = (value: string): string => JSON.stringify(value)

/** 仅允许系统工具、项目和本次临时区；不开放用户目录、全盘读取或网络。 */
export function macosSandboxProfile(project: string, scratch: string, protectedDirectories: string[], systemDirectories: string[] = systemReads, development = false): string {
  if (![project, scratch, ...protectedDirectories].every(root => path.posix.isAbsolute(root))) throw new ModelError('macOS 隔离路径必须是绝对路径')
  const subpath = (value: string): string => `(subpath ${quoted(value)})`
  const ancestors = new Set<string>(['/', '/private', '/private/var', '/System/Volumes', '/System/Volumes/Data'])
  for (const root of [project, scratch]) {
    for (let parent = path.posix.dirname(root); parent !== '/'; parent = path.posix.dirname(parent)) ancestors.add(parent)
  }
  const lines = ['(version 1)', '(deny default)', '(allow process-exec process-fork)', '(allow signal (target same-sandbox))', '(allow process-info* (target same-sandbox))',
    '(allow sysctl-read (sysctl-name-prefix "hw.") (sysctl-name-prefix "machdep.cpu.") (sysctl-name "kern.argmax") (sysctl-name "kern.maxfilesperproc") (sysctl-name "kern.osrelease") (sysctl-name "kern.ostype") (sysctl-name "kern.osversion") (sysctl-name "kern.version") (sysctl-name "vm.loadavg"))',
    '(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))',
    `(allow file-read-metadata ${[...ancestors].map(value => `(literal ${quoted(value)})`).join(' ')})`,
    `(allow file-read* file-map-executable ${[...systemDirectories, project, scratch].map(subpath).join(' ')})`,
    `(allow file-write* ${[project, scratch].map(subpath).join(' ')})`,
    '(allow file-read* (literal "/dev/random") (literal "/dev/urandom") (literal "/private/etc/localtime"))',
    '(allow file-read* file-write-data (literal "/dev/null") (literal "/dev/zero"))',
    '(allow file-read-data file-write-data (subpath "/dev/fd"))',
    development ? '(allow network*)' : '(deny network*)', `(deny file-write-unlink (literal ${quoted(project)}) (literal ${quoted(scratch)}))`,
    '(deny file-write* (regex #"(^|/)\\.git(/|$)"))',
    '(deny file-read* file-write* (regex #"(^|/)(\\.agents|\\.codex|\\.aws|\\.pi-runner)(/|$)"))']
  for (const root of protectedDirectories) {
    lines.push(`(deny file-read* file-write* ${subpath(root)} (literal ${quoted(root)}))`)
    // 不允许把受保护目录的祖先移出拒绝规则的范围。
    for (let parent = path.posix.dirname(root); parent.startsWith(project + '/'); parent = path.posix.dirname(parent)) lines.push(`(deny file-write-unlink (literal ${quoted(parent)}))`)
  }
  return lines.join('\n')
}

export function macosSandboxEnvironment(project: string, scratch: string): NodeJS.ProcessEnv {
  return { PATH: `${project}/node_modules/.bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: scratch, TMPDIR: scratch + '/', TMP: scratch, TEMP: scratch,
    XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_CACHE_HOME: path.join(scratch, 'cache'), XDG_DATA_HOME: path.join(scratch, 'data'), XDG_STATE_HOME: path.join(scratch, 'state'),
    PYTHONPYCACHEPREFIX: path.join(scratch, 'python-cache'), PIP_CACHE_DIR: path.join(scratch, 'pip-cache'),
    npm_config_userconfig: path.join(scratch, 'npmrc'), npm_config_globalconfig: path.join(scratch, 'npm-globalrc'), npm_config_store_dir: path.join(scratch, 'pnpm-store'), PNPM_HOME: path.join(scratch, 'pnpm-home'),
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', BASH_ENV: '/dev/null', ENV: '/dev/null', NODE_OPTIONS: '--preserve-symlinks --preserve-symlinks-main', npm_config_cache: path.join(scratch, 'npm-cache'), COREPACK_HOME: path.join(scratch, 'corepack'), NO_COLOR: '1' }
}

/** 固定调用系统 Seatbelt；其限制由内核继承到子进程，没有普通终端回退。 */
export class MacosSandboxEngine implements TerminalSandbox {
  readonly failClosed = true
  private prepared = new Set<string>()
  constructor(private readonly options: { dataDirectory: string; protectedDirectories: string[]; platform?: string }) {}
  reset(): void { this.prepared.clear() }
  setBackend(backend: SandboxBackend): void { if (backend !== 'seatbelt') throw new ModelError('macOS 只能使用 Seatbelt 隔离后端') }
  async checkBackend(backend: SandboxBackend): Promise<void> { this.setBackend(backend) }
  async configureLegacy(): Promise<void> { throw new ModelError('macOS 无需管理员安装，请使用自动准备或排查') }
  async checkRuntime(): Promise<void> {
    if ((this.options.platform ?? process.platform) !== 'darwin') throw new ModelError('Seatbelt 隔离后端只能在 macOS 上执行')
    try { await access(executable, constants.X_OK); await access(shell, constants.X_OK) }
    catch { throw new ModelError('系统 sandbox-exec 或 Bash 不可用，请检查系统策略或修复 macOS；自动终端执行保持关闭') }
  }
  async prepare(project: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); await this.checkRuntime()
    if (await realpath(project) !== project || project === path.parse(project).root) throw new ModelError('项目路径无效或发生变化，不能启动 macOS 隔离终端')
    if (this.prepared.has(project)) return
    let output = ''
    const marker = 'PI_RUNNER_SEATBELT_READY'
    const result = await this.run(`printf '${marker}\\n'`, project, { signal, timeout: 15, onData: data => { output = (output + data.toString('utf8')).slice(-4000) } })
    if (result.exitCode !== 0 || !output.includes(marker)) throw new ModelError(`macOS 系统沙箱启动失败，命令尚未执行：${output.trim().slice(-1800) || '系统未返回启动标记'}`)
    this.prepared.add(project)
  }
  async exec(command: string, cwd: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    await this.prepare(cwd, options.signal)
    return this.run(command, cwd, options)
  }
  private async run(command: string, cwd: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pi-runner-command-')))
    try {
      const protectedDirectories = await Promise.all([...this.options.protectedDirectories, this.options.dataDirectory].map(root => realpath(root).catch(() => path.resolve(root))))
      if (protectedDirectories.some(root => scratch === root || scratch.startsWith(root + path.sep))) throw new ModelError('隔离临时目录与应用保护目录重叠，请检查临时目录配置')
      // 系统动态库可能经 Cryptex 或系统链接映射到其他只读位置；只解析固定系统根。
      const resolvedSystem = (await Promise.all(systemReads.map(root => realpath(root).catch(() => root)))).filter(root =>
        systemReads.some(allowed => root === allowed || root.startsWith(allowed + '/') || root === '/System/Volumes/Data' + allowed || root.startsWith('/System/Volumes/Data' + allowed + '/')) || root.startsWith('/System/Volumes/Preboot/Cryptexes/OS/'))
      const development = await developerCommand(command, options.signal)
      const tools = await developerToolReads(cwd, protectedDirectories)
      const profile = macosSandboxProfile(cwd, scratch, protectedDirectories, [...new Set([...systemReads, ...resolvedSystem, ...tools])], development)
      return await new Promise<{ exitCode: number }>((resolve, reject) => {
        options.signal?.throwIfAborted()
        const child = spawn(executable, ['-p', profile, shell, '--noprofile', '--norc', '-c', command], { cwd, env: macosSandboxEnvironment(cwd, scratch), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let timedOut = false
        const terminate = (): void => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } } }
        const timer = setTimeout(() => { timedOut = true; terminate() }, (options.timeout ?? 120) * 1000)
        const cleanup = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', terminate); terminate() }
        child.stdout.on('data', options.onData); child.stderr.on('data', options.onData)
        child.once('error', error => { cleanup(); reject(new ModelError(`macOS 隔离进程无法启动：${error.message}`)) })
        child.once('close', code => {
          cleanup()
          if (options.signal?.aborted) reject(options.signal.reason)
          else if (timedOut) reject(new ModelError('macOS 隔离命令执行超时，已停止进程组'))
          else resolve({ exitCode: code ?? 1 })
        })
        options.signal?.addEventListener('abort', terminate, { once: true })
        if (options.signal?.aborted) terminate()
      })
    } finally { await rm(scratch, { recursive: true, force: true }) }
  }
}
