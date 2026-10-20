import { createHash, randomUUID } from 'node:crypto'
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SandboxBackend, SandboxState, SandboxStep } from '../../shared/sandbox'
import { SANDBOX_CHECKS, SANDBOX_MESSAGES } from '../../shared/sandbox'
import { type TerminalSandbox } from './terminal-sandbox'
import { WindowsSandboxEngine } from './windows-sandbox-engine'
import { MacosSandboxEngine } from './macos-sandbox'
import { checkMacosSandboxIsolation } from './macos-sandbox-isolation-check'
import { SandboxVerificationStore } from './sandbox-verification-store'
import { ModelError } from './model-validation'
import { SandboxCompatibilityError } from './sandbox-compatibility-error'
import { checkSandboxIsolation, checkCachedSandboxIsolation } from './sandbox-isolation-check'
import { gitWorkingDirectoryDenied, retryableGitInspection } from './git-working-directory-check'
import { createSandboxTemporaryDirectory } from './sandbox-temporary-directory'
import { developerCommand } from './developer-command-policy'

export interface SandboxEngine extends TerminalSandbox {
  checkRuntime(): Promise<void>; reset(): void; setBackend(backend: SandboxBackend): void
  checkBackend?(backend: SandboxBackend): Promise<void>
  configureLegacy(signal?: AbortSignal): Promise<void>
  fingerprint?(project: string): Promise<string>
  environmentFingerprint?(): Promise<string>
  resetProject?(project: string): void
  repair?(project: string, signal?: AbortSignal): Promise<void | string[]>
  checkDevelopment?(project: string, signal: AbortSignal): Promise<void>
}
export class SandboxService implements TerminalSandbox {
  readonly failClosed = true
  get developerTools(): boolean { return this.engine.developerTools === true }
  private states = new Map<string, SandboxState>()
  private verified = new Set<string>()
  private fingerprints = new Map<string, string>()
  private environments = new Map<SandboxBackend, string>()
  private isolationProofs = new Map<SandboxBackend, string>()
  private readonly records: SandboxVerificationStore
  private operation?: { project: string; controller: AbortController; promise: Promise<void> }
  private activeExecutions = 0
  private readonly engine: SandboxEngine
  constructor(private readonly options: {
    runtimeDirectory: string; dataDirectory: string; protectedDirectories: string[]; emit(state: SandboxState): void
    engine?: SandboxEngine; platform?: string; release?: string
    verify?: typeof checkSandboxIsolation
    verifyCached?: typeof checkCachedSandboxIsolation
    stepTimeoutMs?: number
  }) {
    this.records = new SandboxVerificationStore(options.dataDirectory)
    this.engine = options.engine ?? (this.platform === 'darwin' ? new MacosSandboxEngine(options) : new WindowsSandboxEngine(options))
  }
  private get platform(): string { return this.options.platform ?? process.platform }
  private compatible(backend: unknown): backend is SandboxBackend { return this.platform === 'darwin' ? backend === 'seatbelt' : this.platform === 'win32' && ['mxc', 'appcontainer'].includes(String(backend)) }
  get busy(): boolean { return !!this.operation }
  private get activeProject(): string | undefined { return this.operation?.project }
  /** 编辑项目路径时迁移同一项目的通过记录，不把打开其他项目当作迁移。 */
  async rebindProject(previous: string, project: string): Promise<void> {
    if (this.busy || this.activeExecutions) throw new ModelError('安全执行环境正在准备或有命令执行，请完成后再修改项目路径')
    previous = await realpath(previous).catch(() => path.resolve(previous))
    project = await realpath(project)
    if (previous === project) return
    await this.records.rebind(previous, project)
    this.states.delete(previous); this.states.delete(project)
    this.verified.delete(previous); this.verified.delete(project)
    this.fingerprints.delete(previous); this.fingerprints.delete(project)
    this.engine.resetProject?.(previous); this.engine.resetProject?.(project)
  }
  async status(project: string): Promise<SandboxState> {
    project = await realpath(project)
    const current = this.states.get(project)
    if (current) return structuredClone(current)
    const { backend } = await this.records.restore(project, backend => this.compatible(backend))
    // 读取配置期间检查可能已开始或完成，不能再用初始状态覆盖进度。
    const latest = this.states.get(project)
    if (latest) return structuredClone(latest)
    // 磁盘记录只提供上次选择；新进程必须重新验证当前系统的权限边界。
    const state: SandboxState = { project, backend, phase: 'unconfigured', reused: false, operationId: '', steps: [], message: SANDBOX_MESSAGES.unconfigured, updatedAt: Date.now() }
    this.states.set(project, state)
    return structuredClone(state)
  }
  private publish(state: SandboxState, starting = false): void {
    const existing = this.states.get(state.project)
    if (!starting && existing?.operationId && existing.operationId !== state.operationId) return
    state.updatedAt = Date.now(); this.states.set(state.project, state); this.options.emit(structuredClone(state))
  }
  async ensure(project: string): Promise<SandboxState> {
    const state = await this.status(project)
    if (state.phase === 'failed' || this.verified.has(state.project)) return state
    if (this.operation) return state.project === this.operation.project ? this.status(project) : state
    try { return await this.startOperation(project, state.backend ? 'check' : 'configure', undefined, false, true) }
    catch (error) {
      // 多个页面状态请求可同时到达，共享正在进行的项目检查。
      if (this.activeProject === state.project) return this.status(project)
      throw error
    }
  }
  start(project: string, action: 'configure' | 'diagnose' | 'check'): Promise<SandboxState> {
    return this.startOperation(project, action)
  }
  private async startOperation(project: string, action: 'configure' | 'diagnose' | 'check', compatibilityFailure?: SandboxCompatibilityError, completedExecution = false, automatic = false): Promise<SandboxState> {
    if (this.operation) throw new ModelError('安全执行环境正在处理，请等待或停止当前检查')
    if (this.activeExecutions && !(completedExecution && this.activeExecutions === 1)) throw new ModelError('沙箱命令仍在执行，请完成或停止命令后再重新配置权限')
    const initial = await this.status(project)
    // 路径解析期间可能已启动另一项检查，必须再次确认互斥状态。
    if (this.operation) throw new ModelError('安全执行环境正在处理，请等待或停止当前检查')
    if (this.activeExecutions && !(completedExecution && this.activeExecutions === 1)) throw new ModelError('沙箱命令仍在执行，请完成或停止命令后再重新配置权限')
    this.verified.delete(initial.project)
    const controller = new AbortController()
    const state: SandboxState = { ...initial, backend: compatibilityFailure ? 'appcontainer' : action === 'check' ? initial.backend : undefined, developerNetwork: undefined, warning: undefined, reused: false, operationId: randomUUID(), phase: 'running', steps: [], message: action === 'diagnose' ? SANDBOX_MESSAGES.diagnosing : SANDBOX_MESSAGES.preparing }
    this.publish(state, true)
    const operation = { project: state.project, controller, promise: Promise.resolve() }
    this.operation = operation
    operation.promise = this.perform(state, action, controller, compatibilityFailure, automatic).finally(() => { if (this.operation === operation) this.operation = undefined })
    return structuredClone(state)
  }
  async wait(): Promise<void> { await this.operation?.promise }
  private async waitForCheck(project: string, signal?: AbortSignal): Promise<void> {
    const operation = this.operation
    if (!operation) return
    if (operation.project !== project) throw new ModelError('另一个项目正在检查安全执行环境，终端命令暂不执行')
    let abort!: () => void
    const canceled = new Promise<never>((_resolve, reject) => { abort = () => reject(signal?.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort() })
    try { await Promise.race([operation.promise, canceled]) }
    finally { signal?.removeEventListener('abort', abort) }
  }
  stop(): void { this.operation?.controller.abort(new ModelError('已停止安全执行检查，自动终端执行保持关闭')) }
  private async recoverGitWorkingDirectory(project: string, error: SandboxCompatibilityError, signal?: AbortSignal, completedExecution = false): Promise<void> {
    signal?.throwIfAborted()
    if (this.states.get(project)?.backend === 'mxc') {
      try { await this.startOperation(project, 'diagnose', error, completedExecution) }
      catch (startError) { if (this.activeProject !== project) throw startError }
    }
    await this.waitForCheck(project, signal)
    signal?.throwIfAborted()
    const repaired = this.states.get(project)!
    if (!this.verified.has(project) || repaired.phase !== 'ready' || repaired.backend !== 'appcontainer') throw new ModelError(repaired.message)
    this.engine.setBackend(repaired.backend)
    await this.engine.prepare(project, signal)
  }
  private invalidateRuntime(): void {
    this.engine.reset(); this.verified.clear(); this.fingerprints.clear(); this.environments.clear(); this.isolationProofs.clear()
    for (const state of this.states.values()) {
      if (state.phase !== 'ready') continue
      state.phase = 'unconfigured'; state.developerNetwork = undefined; state.warning = undefined
      state.message = SANDBOX_MESSAGES.unconfigured
      this.publish(state)
    }
  }
  private async perform(state: SandboxState, action: 'configure' | 'diagnose' | 'check', controller: AbortController, compatibilityFailure?: SandboxCompatibilityError, automatic = false): Promise<void> {
    const signal = controller.signal
    const overallTimer = setTimeout(() => controller.abort(new ModelError(`安全执行准备超时，停在“${state.message}”，请手动检查`)), 300000)
    const abortable = async <T>(operation: Promise<T>): Promise<T> => {
      let aborted!: () => void
      const interrupted = new Promise<never>((_resolve, reject) => { aborted = () => reject(signal.reason); signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted() })
      try { return await Promise.race([operation, interrupted]) }
      finally { signal.removeEventListener('abort', aborted) }
    }
    const check = async (id: string, label: string, task: (stepSignal: AbortSignal) => Promise<void>, optional = false): Promise<void> => {
      signal.throwIfAborted()
      const step: SandboxStep = { id, label, status: 'running' }
      state.steps.push(step); state.message = label; this.publish(state)
      const stepController = optional ? new AbortController() : controller
      const stepSignal = optional ? AbortSignal.any([signal, stepController.signal]) : signal
      const timeout = setTimeout(() => stepController.abort(new ModelError(`“${label}”超过等待时间，请检查系统权限或隔离后端`)), this.options.stepTimeoutMs ?? 60000)
      let aborted!: () => void
      const interrupted = new Promise<never>((_resolve, reject) => { aborted = () => reject(stepSignal.reason); stepSignal.addEventListener('abort', aborted, { once: true }); if (stepSignal.aborted) aborted() })
      try { await Promise.race([task(stepSignal), interrupted]); stepSignal.throwIfAborted(); step.status = id === 'repair' && state.warning ? 'warning' : 'passed'; this.publish(state) }
      catch (error) {
        step.status = optional && !signal.aborted ? 'warning' : 'failed'
        step.detail = error instanceof Error ? error.message : '检查未完成'
        if (step.status === 'warning') { state.developerNetwork = false; state.warning = [state.warning, step.detail].filter(Boolean).join('\n') }
        this.publish(state)
        if (step.status !== 'warning') throw error
      }
      finally { clearTimeout(timeout); stepSignal.removeEventListener('abort', aborted) }
    }
    try {
      let backend: SandboxBackend = this.platform === 'darwin' ? 'seatbelt' : state.backend === 'elevated' ? 'appcontainer' : state.backend ?? (Number((this.options.release ?? os.release()).split('.')[2]) >= 26100 ? 'mxc' : 'appcontainer')
      state.backend = backend
      if (!automatic) this.invalidateRuntime()
      else this.engine.resetProject?.(state.project)
      this.engine.setBackend(backend)
      let environment: string | undefined
      const runtime = async (): Promise<void> => {
        await mkdir(this.options.dataDirectory, { recursive: true })
        const current = await this.engine.environmentFingerprint?.()
        const previous = this.environments.get(backend)
        if (previous && current !== previous) this.invalidateRuntime()
        await this.engine.checkRuntime()
        environment = current
        if (current) this.environments.set(backend, current)
      }
      await check('environment', SANDBOX_CHECKS.environment.label, async () => {
        if (!['win32', 'darwin'].includes(this.platform)) throw new ModelError('当前系统尚未接入安全执行后端，请选择 Windows 或 macOS 环境')
        try { await runtime() }
        catch (error) {
          signal.throwIfAborted()
          if (backend !== 'mxc') throw error
          backend = 'appcontainer'; state.backend = backend; this.engine.setBackend(backend)
          await runtime()
          state.steps.find(step => step.id === 'environment')!.detail = `原生运行时不可用，已选择内置兼容后端；随后继续完整边界测试。原因：${error instanceof Error ? error.message : String(error)}`
        }
      })
      await check('temporary', SANDBOX_CHECKS.temporary.label, async () => {
        const directory = await createSandboxTemporaryDirectory('pi-runner-preflight-', [...this.options.protectedDirectories, this.options.runtimeDirectory, this.options.dataDirectory])
        await rm(directory, { recursive: true })
      })
      await check('repair', SANDBOX_CHECKS.repair.label, async () => {
        await mkdir(this.options.dataDirectory, { recursive: true })
        if (action !== 'check') {
          const warnings = await this.engine.repair?.(state.project, signal)
          if (Array.isArray(warnings) && warnings.length) {
            state.warning = warnings.join('\n')
            state.steps.find(step => step.id === 'repair')!.detail = state.warning
          }
        }
      })
      await check('compatibility', SANDBOX_CHECKS.compatibility.label, async () => { await this.engine.checkBackend?.(backend) })
      await check('launch', SANDBOX_CHECKS.launch.label, async () => {
        try { await this.engine.prepare(state.project, signal) }
        catch (error) {
          signal.throwIfAborted()
          if (backend !== 'mxc') throw error
          backend = 'appcontainer'; state.backend = backend; this.engine.setBackend(backend)
          await runtime(); await this.engine.checkBackend?.(backend)
          await this.engine.prepare(state.project, signal)
          state.steps.find(step => step.id === 'launch')!.detail = `原生隔离启动或 Git 工作目录检查未通过，已自动使用兼容隔离；随后继续完整边界测试。原因：${error instanceof Error ? error.message : '启动失败'}`
        }
        if (compatibilityFailure) state.steps.find(step => step.id === 'launch')!.detail = `原生环境出现 Git 工作目录权限错误，已改用兼容隔离；随后继续完整边界验证。原因：${compatibilityFailure.message}`
      })
      const fingerprint = await abortable(this.engine.fingerprint?.(state.project) ?? Promise.resolve(undefined))
      const { record } = await this.records.restore(state.project, backend => this.compatible(backend))
      const unchanged = Boolean(fingerprint && record?.backend === backend && record.fingerprint === fingerprint)
      const shared = Boolean(environment && this.isolationProofs.get(backend) === environment)
      // 已有项目的身份或权限变化时必须完整检查；新项目可复用公共证明，但仍校验真实项目。
      const reuse = automatic && (unchanged || (shared && !record?.fingerprint))
      if (!reuse) {
        await abortable((this.options.verify ?? (this.platform === 'darwin' ? checkMacosSandboxIsolation : checkSandboxIsolation))(this.engine, state.project, this.options.dataDirectory, signal, check))
      }
      if (this.platform === 'win32') {
        await check('current-project', '校验当前项目读写权限与外部隔离边界', async () => {
          await (this.options.verifyCached ?? checkCachedSandboxIsolation)(this.engine, state.project, this.options.dataDirectory, signal)
        })
      }
      if (environment) this.isolationProofs.set(backend, environment)
      state.reused = reuse
      if (!automatic && this.engine.checkDevelopment) {
        await check('network', SANDBOX_CHECKS.network.label, async stepSignal => {
          await this.engine.checkDevelopment!(state.project, stepSignal)
          state.developerNetwork = true
        }, true)
      }
      signal.throwIfAborted()
      await abortable(this.records.save(state.project, backend, signal, { fingerprint, developerNetwork: state.developerNetwork, warning: state.warning }))
      signal.throwIfAborted()
      this.verified.add(state.project)
      if (fingerprint) this.fingerprints.set(state.project, fingerprint)
      state.phase = 'ready'; state.message = state.developerNetwork === false ? SANDBOX_MESSAGES.limited : SANDBOX_MESSAGES.ready; this.publish(state)
    } catch (error) {
      this.verified.delete(state.project); this.fingerprints.delete(state.project); this.engine.resetProject?.(state.project)
      if (state.backend) this.isolationProofs.delete(state.backend)
      // 失败记录不能在下次启动时重新被当成有效缓存。
      await this.records.revoke(state.project).catch(() => {})
      state.phase = 'failed'; state.message = signal.aborted ? `${signal.reason instanceof Error ? signal.reason.message : '检查已停止'}。自动终端执行保持关闭。` : `${error instanceof Error ? error.message : '隔离测试失败'}。可排查问题，或明确切换到完全访问后执行。`
      this.publish(state)
    } finally {
      clearTimeout(overallTimer)
      await this.saveDiagnostic(state)
    }
  }
  private async saveDiagnostic(state: SandboxState): Promise<void> {
    const directory = path.join(this.options.dataDirectory, 'diagnostics')
    const file = path.join(directory, createHash('sha256').update(state.project).digest('hex') + '.json')
    const temporary = file + '.' + randomUUID() + '.tmp'
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(temporary, JSON.stringify({ ...state, platform: this.platform, release: this.options.release ?? os.release(), arch: process.arch, temporaryDirectory: os.tmpdir(), runtimeDirectory: this.options.runtimeDirectory, dataDirectory: this.options.dataDirectory }, null, 2) + '\n')
      await rename(temporary, file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      state.message += `。无法保存诊断记录 ${file}：${error instanceof Error ? error.message : String(error)}`
      this.publish(state)
    }
  }
  async prepare(project: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    project = await realpath(project)
    await this.waitForCheck(project, signal)
    const state = await this.status(project)
    if (this.verified.has(project) && this.engine.fingerprint) {
      this.engine.setBackend(state.backend!)
      let current: string
      try { current = await this.engine.fingerprint(project) }
      catch (error) {
        this.verified.delete(project); this.fingerprints.delete(project)
        if (state.backend) this.isolationProofs.delete(state.backend)
        await this.records.revoke(project).catch(() => {})
        state.phase = 'failed'; state.message = `无法确认当前项目权限，终端命令已停止：${error instanceof Error ? error.message : '权限指纹读取失败'}`
        this.publish(state); await this.saveDiagnostic(state)
        throw error
      }
      signal?.throwIfAborted()
      if (current !== this.fingerprints.get(project)) {
        this.verified.delete(project); this.fingerprints.delete(project)
        state.phase = 'unconfigured'; state.developerNetwork = undefined; state.warning = undefined
        state.message = '项目权限或隔离环境发生变化，正在重新校验。'; this.publish(state)
      }
    }
    if (!this.verified.has(project) && state.phase !== 'failed') {
      // 首次真正使用终端时才准备，浏览历史记录不启动隔离进程。
      await this.ensure(project)
      await this.waitForCheck(project, signal)
    }
    signal?.throwIfAborted()
    if (!this.verified.has(project)) { this.publish(this.states.get(project)!); throw new ModelError('安全执行环境尚未通过隔离测试；请完成配置、排查问题，或明确切换到完全访问') }
    try { this.engine.setBackend(this.states.get(project)!.backend!); await this.engine.prepare(project, signal) }
    catch (error) {
      if (signal?.aborted) throw error
      // 只有实际启动探针确认 MXC 不兼容时才自动修复一次。
      // 此时用户脚本尚未执行，等待兼容后端通过完整隔离验证后继续原请求。
      if (this.platform === 'win32' && state.backend === 'mxc' && error instanceof SandboxCompatibilityError) {
        try {
          await this.recoverGitWorkingDirectory(project, error, signal)
          return
        } catch (repairError) {
          if (signal?.aborted) throw repairError
          error = repairError
        }
      }
      this.verified.delete(project)
      await this.records.revoke(project).catch(() => {})
      const current = this.states.get(project)!
      current.phase = 'failed'; current.message = `安全执行环境失效：${error instanceof Error ? error.message : '启动失败'}。请排查或切换到完全访问。`
      this.publish(current); await this.saveDiagnostic(current); throw error
    }
  }
  async exec(command: string, cwd: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    if (this.busy) throw new ModelError('隔离检查正在进行，终端命令暂不执行')
    this.activeExecutions++
    try { return await this.execute(command, cwd, options) }
    finally { this.activeExecutions-- }
  }
  private async execute(command: string, cwd: string, options: Parameters<TerminalSandbox['exec']>[2]): Promise<{ exitCode: number }> {
    if (this.busy || !this.verified.has(cwd)) throw new ModelError('隔离测试尚未通过，终端命令已停止')
    const backend = this.states.get(cwd)!.backend!
    this.engine.setBackend(backend)
    if (this.engine.checkDevelopment && await developerCommand(command, options.signal)) {
      const state = this.states.get(cwd)!
      // 引擎也会检查并缓存该能力；这里只负责进度、限时和向界面保留失败原因。
      if (state.developerNetwork !== true) {
        const controller = new AbortController()
        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
        const step: SandboxStep = { id: 'network', label: SANDBOX_CHECKS.network.label, status: 'running' }
        const previousWarning = state.steps.find(item => item.id === 'network')?.detail
        state.steps = [...state.steps.filter(item => item.id !== 'network'), step]
        state.message = SANDBOX_CHECKS.network.progress
        this.publish(state)
        const timer = setTimeout(() => controller.abort(new ModelError('开发工具能力检查超时，请重新配置后重试')), this.options.stepTimeoutMs ?? 60000)
        try {
          await this.engine.checkDevelopment(cwd, signal)
          signal.throwIfAborted()
          state.developerNetwork = true; step.status = 'passed'
          if (state.warning === previousWarning) state.warning = undefined
          state.message = SANDBOX_MESSAGES.ready
        } catch (error) {
          state.developerNetwork = false; step.status = 'warning'
          step.detail = error instanceof Error ? error.message : '开发工具能力检查未完成'
          state.warning = step.detail; state.message = SANDBOX_MESSAGES.limited
          throw error
        } finally {
          clearTimeout(timer); this.publish(state)
          await this.saveDiagnostic(state)
        }
      }
    }
    const mayRecover = this.platform === 'win32' && backend === 'mxc'
    const mayRetry = mayRecover && retryableGitInspection(command)
    let output = '', pendingBytes = 0, buffering = mayRetry
    const pending: Buffer[] = []
    const flush = (): void => { buffering = false; for (const data of pending.splice(0)) options.onData(data) }
    let result: { exitCode: number | null }
    try {
      this.engine.setBackend(backend)
      result = await this.engine.exec(command, cwd, {
        ...options,
        onData: data => {
          if (mayRecover) output = (output + data.toString('utf8')).slice(-8000)
          // Git 的 cwd 错误只有一行；限量暂存，成功恢复后只返回重试的真实结果。
          if (buffering && pendingBytes + data.length <= 65536) { pending.push(Buffer.from(data)); pendingBytes += data.length }
          else { flush(); options.onData(data) }
        }
      })
    } catch (error) { flush(); throw error }
    if (mayRecover && result.exitCode !== 0 && gitWorkingDirectoryDenied(output)) {
      const failure = new SandboxCompatibilityError('fatal: Unable to read current working directory: Permission denied')
      try { await this.recoverGitWorkingDirectory(cwd, failure, options.signal, true) }
      catch (error) {
        flush()
        options.signal?.throwIfAborted()
        throw new ModelError(`${failure.message}\nGit 工作目录权限错误，兼容环境恢复未完成：${error instanceof Error ? error.message : '验证失败'}。原命令未重试。`)
      }
      if (mayRetry) {
        pending.length = 0
        // 仅完整匹配的只读查询组合可以重试一次；不递归调用，避免循环切换。
        const retried = await this.engine.exec(command, cwd, options)
        return { exitCode: retried.exitCode ?? 1 }
      }
      flush()
      options.onData(Buffer.from('\n已恢复 Git 兼容隔离环境。原脚本可能包含已完成的操作，因此未自动重跑；请先核对结果。\n'))
      return { exitCode: result.exitCode ?? 1 }
    }
    flush()
    return { exitCode: result.exitCode ?? 1 }
  }
}
