import type { SandboxBackend } from '../../shared/sandbox'
import { NativeTerminalSandbox, type TerminalSandbox } from './terminal-sandbox'
import { AppContainerSandbox } from './appcontainer-sandbox'
import { sandboxVerificationFingerprint } from './sandbox-verification-fingerprint'
import { ModelError } from './model-validation'
import { checkGitWorkingDirectory, retryableGitInspection } from './git-working-directory-check'
import { developerCommand } from './developer-command-policy'
import { literalCommand } from './windows-command-parser'
import { checkSandboxIsolation, checkCachedSandboxIsolation, checkSandboxDeveloperNetwork } from './sandbox-isolation-check'
import { createSandboxTemporaryDirectory } from './sandbox-temporary-directory'
import { rm } from 'node:fs/promises'

/** 不同 Windows 版本共用真实检测与错误处理，不再启动要求全盘读取的旧兼容后端。 */
export class WindowsSandboxEngine implements TerminalSandbox {
  readonly failClosed = true
  readonly developerTools = true
  private backend: SandboxBackend = 'mxc'
  private native: NativeTerminalSandbox
  private appcontainer: AppContainerSandbox
  private gitChecks = new Map<string, Promise<void>>()
  private developmentChecks = new Map<string, Promise<void>>()
  private developmentIsolation?: Promise<void>
  constructor(private readonly options: { runtimeDirectory: string; dataDirectory: string; protectedDirectories: string[] }) {
    this.native = new NativeTerminalSandbox(options); this.appcontainer = new AppContainerSandbox(options)
  }
  private get selected(): NativeTerminalSandbox | AppContainerSandbox { return this.backend === 'mxc' ? this.native : this.appcontainer }
  setBackend(backend: SandboxBackend): void {
    if (backend === 'seatbelt') throw new ModelError('Windows 不能使用 macOS 隔离后端')
    this.backend = backend === 'elevated' ? 'appcontainer' : backend
  }
  reset(): void { this.native.reset(); this.appcontainer.reset(); this.gitChecks.clear(); this.developmentChecks.clear(); this.developmentIsolation = undefined }
  resetProject(project: string): void { this.native.resetProject(project); this.gitChecks.delete(project); this.developmentChecks.delete(project) }
  async repair(project: string, signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted()
    const scratch = await createSandboxTemporaryDirectory('pi-runner-repair-', [...this.options.protectedDirectories, this.options.runtimeDirectory, this.options.dataDirectory])
    await rm(scratch, { recursive: true })
    await this.native.repair(project, signal)
    // 即使本次选择 MXC，也恢复上次关机中断的 AppContainer 清理。
    return this.appcontainer.recoverCleanup(signal)
  }
  async checkDevelopment(project: string, signal: AbortSignal): Promise<void> {
    let pending = this.developmentChecks.get(project)
    if (!pending) {
      pending = (async () => {
        // 联网状态下重新验证全部文件边界，不能沿用另一个后端的通过结果。
        const development: TerminalSandbox = {
          prepare: (folder, probeSignal) => this.native.prepare(folder, probeSignal, true),
          exec: (command, folder, options) => this.native.execDevelopmentProbe(command, folder, options)
        }
        // 公共边界探针在本次运行中只做一次；每个项目仍需实际启动与读写校验。
        const isolation = this.developmentIsolation ??= checkSandboxIsolation(development, project, this.options.dataDirectory, signal, async (_id, _label, task) => task())
        try { await isolation }
        catch (error) { if (signal.aborted && this.developmentIsolation === isolation) this.developmentIsolation = undefined; throw error }
        await development.prepare(project, signal)
        await checkCachedSandboxIsolation(development, project, this.options.dataDirectory, signal)
        await checkSandboxDeveloperNetwork(development, project, signal)
      })()
      this.developmentChecks.set(project, pending)
      // 失败保留到下一次重新配置，避免每条开发命令重复启动故障后端。
      void pending.catch(() => {
        if (signal.aborted && this.developmentChecks.get(project) === pending) this.developmentChecks.delete(project)
      })
    }
    await pending
    signal.throwIfAborted()
  }
  checkRuntime(): Promise<void> { return this.selected.checkRuntime() }
  fingerprint(project: string): Promise<string> { return sandboxVerificationFingerprint(this.options, this.backend, project) }
  environmentFingerprint(): Promise<string> { return sandboxVerificationFingerprint(this.options, this.backend) }
  async checkBackend(backend: SandboxBackend): Promise<void> { if (backend === 'mxc') await this.native.checkBackend('mxc') }
  async configureLegacy(signal?: AbortSignal): Promise<void> { signal?.throwIfAborted(); this.setBackend('appcontainer'); await this.checkRuntime() }
  async prepare(project: string, signal?: AbortSignal): Promise<void> {
    const selected = this.selected
    await selected.prepare(project, signal)
    // 兼容后端也必须从真实项目目录运行 Git，不能只验证它能读写测试文件。
    if (selected !== this.appcontainer) return
    let pending = this.gitChecks.get(project)
    if (!pending) {
      pending = checkGitWorkingDirectory(selected, project, signal)
      this.gitChecks.set(project, pending)
      void pending.catch(() => { if (this.gitChecks.get(project) === pending) this.gitChecks.delete(project) })
    }
    await pending
    signal?.throwIfAborted()
  }
  async exec(command: string, cwd: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    // 命令分类期间其他项目可能切换后端，固定本次调用所选的实例。
    const selected = this.selected
    if (retryableGitInspection(command)) return this.appcontainer.exec(command, cwd, options)
    if (await developerCommand(command, options.signal)) {
      try { await this.checkDevelopment(cwd, options.signal ?? new AbortController().signal) }
      catch (error) {
        options.signal?.throwIfAborted()
        throw new ModelError(`文件隔离仍可使用，但 MXC 开发工具能力未通过检查，用户命令尚未执行：${error instanceof Error ? error.message : String(error)}。请重新配置安全执行环境后重试`)
      }
      const parts = command.trim().split(/;|\r?\n/).map(value => value.trim()).filter(Boolean)
      if (parts.length > 1 && parts.length <= 32 && parts.every(part => literalCommand(part))) {
        const deadline = options.timeout === undefined ? undefined : Date.now() + options.timeout * 1000
        let result = { exitCode: 0 }
        for (const part of parts) {
          options.signal?.throwIfAborted()
          const timeout = deadline === undefined ? undefined : Math.max(0, (deadline - Date.now()) / 1000)
          if (timeout === 0) throw new ModelError('开发命令组合执行超时，已停止剩余操作')
          result = await this.exec(part, cwd, { ...options, timeout })
        }
        return result
      }
      try { await this.native.prepare(cwd, options.signal, true) }
      catch (error) {
        options.signal?.throwIfAborted()
        throw new ModelError(`开发工具隔离环境准备失败，用户命令尚未执行：${error instanceof Error ? error.message : String(error)}。请排查系统沙箱兼容性；不会改为完整本机执行`)
      }
      return this.native.exec(command, cwd, options)
    }
    return selected.exec(command, cwd, options)
  }
}
