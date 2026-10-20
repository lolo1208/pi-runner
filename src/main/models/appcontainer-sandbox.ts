import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { ModelError } from './model-validation'
import { sandboxEnvironment, type TerminalSandbox } from './terminal-sandbox'
import { prepareSandboxConfiguration } from './sandbox-configuration'
import { parseGitInspection } from './git-working-directory-check'
import { findHostRuntime } from './windows-command-recovery'
import { SandboxCompatibilityError } from './sandbox-compatibility-error'
import { createSandboxTemporaryDirectory, removeSandboxTemporaryDirectory } from './sandbox-temporary-directory'
import { AppContainerCleanupStore } from './appcontainer-cleanup-store'

/** 原生 argv 引用规则，不经 PowerShell 解释。 */
function nativeArgument(value: string): string {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
}

/** Windows 10 的 LPAC 后端。每次命令使用独立身份，仅向当前项目及临时目录授权。 */
export class AppContainerSandbox implements TerminalSandbox {
  private checked?: Promise<void>
  private recovery?: Promise<string[]>
  private readonly cleanupStore: AppContainerCleanupStore
  constructor(private readonly options: { runtimeDirectory: string; dataDirectory: string; protectedDirectories: string[] }) {
    this.cleanupStore = new AppContainerCleanupStore(options.dataDirectory)
  }
  private get executable(): string { return path.join(this.options.runtimeDirectory, 'bin/pi-runner-appcontainer.exe') }
  reset(): void { this.checked = undefined; this.recovery = undefined }
  async checkRuntime(): Promise<void> {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new ModelError('AppContainer 后端需要 Windows x64')
    this.checked ??= (async () => {
      const manifest = JSON.parse(await readFile(path.join(this.options.runtimeDirectory, 'appcontainer-manifest.json'), 'utf8'))
      const sourceHash = createHash('sha256').update(await readFile(path.join(this.options.runtimeDirectory, 'AppContainerRunner.cs'))).digest('hex')
      if (manifest.version !== 1 || manifest.source !== sourceHash) throw new Error('隔离宿主源码校验失败')
      const hash = createHash('sha256'); for await (const chunk of createReadStream(this.executable)) hash.update(chunk)
      if (hash.digest('hex') !== manifest.executable) throw new Error('隔离宿主校验失败')
    })()
    try { await this.checked } catch (error) { this.checked = undefined; throw new ModelError(`AppContainer 隔离宿主缺失或校验失败：${this.executable}；${error instanceof Error ? error.message : String(error)}。请恢复应用内置运行时`) }
  }
  async recoverCleanup(signal?: AbortSignal): Promise<string[]> {
    this.recovery ??= this.cleanupStore.recover(async record => {
      await this.checkRuntime()
      await this.cleanupPermissions(record.moniker, record.project, record.scratch, signal)
    }, signal)
    try { return await this.recovery } catch (error) { this.recovery = undefined; throw error }
  }
  private async cleanupPermissions(moniker: string, project: string, scratch: string, signal?: AbortSignal): Promise<void> {
    let output = ''
    const result = await this.run([moniker, project, scratch, 'cleanup'], scratch, { signal, timeout: 30, onData: data => { output = (output + data.toString('utf8')).slice(-8000) } })
    if (result.exitCode !== 0) throw new ModelError(`AppContainer 权限清理失败：${project}；${output.trim() || `退出码 ${result.exitCode}`}`)
  }
  private async finish(moniker: string, project: string, scratch: string): Promise<void> {
    try {
      const record = await this.cleanupStore.validate(moniker)
      if (record.project !== project || record.scratch !== scratch) throw new ModelError('AppContainer 权限清理记录与本次命令不一致')
      await this.cleanupPermissions(moniker, project, scratch)
      await removeSandboxTemporaryDirectory(scratch, 'pi-runner-ac-')
      await this.cleanupStore.complete(moniker)
    } catch (error) {
      this.recovery = undefined
      throw error
    } finally { this.cleanupStore.release(moniker) }
  }
  private async begin(moniker: string, project: string, scratch: string): Promise<void> {
    try { await this.cleanupStore.begin(moniker, project, scratch) }
    catch (error) {
      // 尚未调用隔离宿主，没有授予权限；保留原始落盘错误。
      await removeSandboxTemporaryDirectory(scratch, 'pi-runner-ac-').catch(() => {})
      throw new ModelError(`无法登记 AppContainer 权限清理，用户命令尚未执行：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  async prepare(project: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); await this.checkRuntime()
    if (await realpath(project) !== project || path.parse(project).root === project) throw new ModelError('项目路径发生变化或是整个盘符，不能配置 AppContainer')
    for (const directory of [...this.options.protectedDirectories, this.options.runtimeDirectory, this.options.dataDirectory]) {
      const root = await realpath(directory).catch(error => { if (error.code === 'ENOENT') return path.resolve(directory); throw error })
      const relative = path.relative(root, project)
      if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new ModelError(`项目位于应用保护目录内，不能授予 AppContainer 写入权限：${root}`)
    }
    await this.recoverCleanup(signal)
  }
  private async protectedPaths(project: string): Promise<string[]> {
    const paths = [...this.options.protectedDirectories, this.options.runtimeDirectory, this.options.dataDirectory, ...['.git', '.agents', '.codex', '.aws', '.pi-runner'].map(name => path.join(project, name))]
    const resolved = await Promise.all(paths.map(async directory => realpath(directory).catch(error => { if (error.code === 'ENOENT') return path.resolve(directory); throw error })))
    return [...new Set([...paths.map(directory => path.resolve(directory)), ...resolved])]
  }
  async exec(command: string, project: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    const gitQueries = parseGitInspection(command)
    if (gitQueries) {
      const deadline = options.timeout === undefined ? undefined : Date.now() + options.timeout * 1000
      for (const argv of gitQueries) {
        options.signal?.throwIfAborted()
        if (argv[0] === 'diff') argv.splice(1, 0, '--no-ext-diff', '--no-textconv')
        const timeout = deadline === undefined ? undefined : Math.max(0, (deadline - Date.now()) / 1000)
        if (timeout === 0) throw new ModelError('Git 组合查询执行超时，已停止剩余查询')
        const result = await this.execGit(project, argv, { ...options, timeout })
        if (result.exitCode !== 0) return result
      }
      return { exitCode: 0 }
    }
    await this.prepare(project, options.signal)
    const protect = await this.protectedPaths(project)
    const scratch = await createSandboxTemporaryDirectory('pi-runner-ac-', [...this.options.protectedDirectories, this.options.runtimeDirectory, this.options.dataDirectory])
    const moniker = 'pi-runner.' + randomUUID().replace(/-/g, '')
    const cwd = project.replace(/'/g, "''")
    const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; try { New-PSDrive -Name Project -PSProvider FileSystem -Root '${cwd}' | Out-Null; Set-Location -LiteralPath 'Project:\\'; [Environment]::CurrentDirectory='${cwd}'; & {\n${command}\n}; if (-not $?) { exit 1 }; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`
    await this.begin(moniker, project, scratch)
    let executionError: unknown
    try {
      await prepareSandboxConfiguration(scratch)
      return await this.run([moniker, project, scratch, Buffer.from(script, 'utf16le').toString('base64'), ...protect], scratch, options)
    } catch (error) { executionError = error; throw error }
    finally {
      // 使用新宿主清理权限，强制停止的旧宿主不能执行 finally；清理不执行用户脚本。
      await this.finish(moniker, project, scratch).catch(error => {
        throw new ModelError(`${error instanceof Error ? error.message : String(error)}${executionError ? `；原执行错误：${executionError instanceof Error ? executionError.message : String(executionError)}` : ''}`)
      })
    }
  }
  private async gitExecutable(project: string): Promise<string | undefined> {
    const executable = await findHostRuntime('git', project)
    if (!executable) return undefined
    // cmd/bin 的 Git 是包装程序，真正的 Git 进程需要在恢复线程之前设置私有映射。
    for (const architecture of ['mingw64', 'mingw32']) {
      const candidate = path.resolve(path.dirname(executable), '..', architecture, 'bin/git.exe')
      try { if ((await stat(candidate)).isFile()) return candidate } catch { /* 继续检查其他安装布局。 */ }
    }
    if (path.extname(executable).toLowerCase() !== '.exe') throw new ModelError('未找到可直接启动的 git.exe，请检查 Git 安装路径')
    return executable
  }
  async checkGitWorkingDirectory(project: string, signal?: AbortSignal): Promise<void> {
    if (!await this.gitExecutable(project)) return
    let output = ''
    const result = await this.execGit(project, ['status', '--porcelain', '--untracked-files=no'], { signal, timeout: 30, onData: data => { output = (output + data.toString('utf8')).slice(-8000) } }, true)
    if (result.exitCode !== 0) throw new SandboxCompatibilityError(`AppContainer 私有项目入口中的 Git 启动检查失败，用户命令尚未执行：${output.trim() || '未收到有效退出状态'}`)
  }
  private async execGit(project: string, argv: string[], options: Parameters<TerminalSandbox['exec']>[2], probe = false): Promise<{ exitCode: number }> {
    await this.prepare(project, options.signal)
    const git = await this.gitExecutable(project)
    if (!git) throw new ModelError('本机 PATH 中未找到 Git，请安装或配置 Git 后重试')
    const protect = await this.protectedPaths(project)
    const scratch = await createSandboxTemporaryDirectory('pi-runner-ac-', [...this.options.protectedDirectories, this.options.runtimeDirectory, this.options.dataDirectory])
    const moniker = 'pi-runner.' + randomUUID().replace(/-/g, '')
    await this.begin(moniker, project, scratch)
    let executionError: unknown
    try {
      await prepareSandboxConfiguration(scratch)
      const argumentsList = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']
      if (probe) {
        const repository = path.join(scratch, 'probe.git')
        await mkdir(path.join(repository, 'objects'), { recursive: true }); await mkdir(path.join(repository, 'refs'))
        await writeFile(path.join(repository, 'HEAD'), 'ref: refs/heads/probe\n')
        await writeFile(path.join(repository, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n')
        argumentsList.push(`--git-dir=${repository}`, '--work-tree=.')
      }
      const payload = 'git:' + Buffer.from(git + '\n' + [...argumentsList, ...argv].map(nativeArgument).join(' '), 'utf16le').toString('base64')
      return await this.run([moniker, project, scratch, payload, ...protect], scratch, options)
    } catch (error) { executionError = error; throw error }
    finally {
      await this.finish(moniker, project, scratch).catch(error => {
        throw new ModelError(`${error instanceof Error ? error.message : String(error)}${executionError ? `；原执行错误：${executionError instanceof Error ? executionError.message : String(executionError)}` : ''}`)
      })
    }
  }
  private run(args: string[], scratch: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) { reject(options.signal.reason); return }
      const child = spawn(this.executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: sandboxEnvironment(this.options.dataDirectory, scratch) })
      let timedOut = false, timer: ReturnType<typeof setTimeout> | undefined
      const terminate = (): void => {
        if (!child.pid) return
        const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.once('error', () => { child.kill() })
      }
      const cleanup = (): void => { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', terminate) }
      child.stdout.on('data', options.onData); child.stderr.on('data', options.onData)
      child.once('error', error => { cleanup(); reject(new ModelError(`AppContainer 启动失败：${error.message}`)) })
      child.once('close', code => { cleanup(); if (options.signal?.aborted) reject(options.signal.reason); else if (timedOut) reject(new ModelError('AppContainer 命令执行超时')); else resolve({ exitCode: code ?? 1 }) })
      options.signal?.addEventListener('abort', terminate, { once: true }); if (options.signal?.aborted) terminate()
      if (options.timeout !== undefined) timer = setTimeout(() => { timedOut = true; terminate() }, options.timeout * 1000)
    })
  }
}
