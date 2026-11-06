import { readClaudeProxy, saveClaudeProxy } from './claude-proxy'
import { app, dialog, shell } from 'electron'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import { type ChildProcess } from 'node:child_process'
import { InMemoryCredentialStore, getSupportedThinkingLevels, type ProviderEnv } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ClaudeSubscriptionStatus, ModelDescriptor, ModelProfile } from '../../shared/models'
import type { ModelSettingsStore } from './model-settings-store'
import type { PiAttachments } from './pi-attachments'
import { ModelError } from './model-validation'
import { captureProcess, closeClaudeProcesses, discoverClaudeModels, getClaudeStatus, killProcessTree, resolveClaudeExecutable, spawnCommand } from './claude-code/claude-cli'
import { modelFromDiscovery, type ClaudeCodeModel } from './claude-code/model-catalog'
import { streamClaudeCode } from './claude-code/stream'
import { requestPiStream } from './pi-stream'

/** 仅存储绑定与目录；认证、刷新及安全存储完全交给官方 Claude Code。 */
class ClaudeSubscriptionService {
  private proxy?: string
  private proxyLoading?: Promise<void>
  private async loadProxy(): Promise<void> {
    if (this.proxy !== undefined) return
    await (this.proxyLoading ??= readClaudeProxy().then(value => { this.proxy = value }).finally(() => { this.proxyLoading = undefined }))
  }
  async setProxy(value: unknown): Promise<void> {
    if (this.operation) throw new ModelError('请先结束当前 Claude Code 操作再修改代理')
    await this.loadProxy()
    this.proxy = await saveClaudeProxy(value)
    await this.invalidate()
    this.error = undefined
  }
  private settings?: ModelSettingsStore
  private models: ClaudeCodeModel[] = []
  private operation?: { kind: 'login' | 'install' | 'logout'; child: ChildProcess; timer: ReturnType<typeof setTimeout> }
  private error?: string
  private url?: string
  private generation = new AbortController()
  private closing = false
  private shutdownTask?: Promise<void>
  private version?: { command: string; value: string }
  private billingBlocked = false
  private rateLimit?: ClaudeSubscriptionStatus['rateLimit']
  initialize(settings: ModelSettingsStore): void { this.settings = settings }
  private store(): ModelSettingsStore {
    if (!this.settings) throw new ModelError('Claude 订阅服务尚未初始化')
    return this.settings
  }
  private env(): Record<string, string | undefined> {
    // Finder 启动的桌面应用通常不继承终端 PATH，补充官方用户安装位置。
    const env: Record<string, string | undefined> = process.platform === 'win32' ? Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key.toUpperCase(), value])) : { ...process.env }
    env.PATH = [join(homedir(), '.local', 'bin'), ...(process.platform === 'win32' ? [join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm')] : ['/usr/local/bin', '/opt/homebrew/bin']), process.env.PATH ?? ''].join(delimiter)
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_OAUTH_TOKEN']) {
      if (env[key]) throw new ModelError(`Claude 订阅拒绝非预期认证配置 ${key}，请清除后重启应用`)
    }
    for (const key of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS']) {
      if (env[key] && !['0', 'false', 'no', 'off'].includes(env[key]!.toLowerCase())) throw new ModelError(`Claude 订阅不允许 ${key}`)
    }
    if (this.proxy !== undefined) {
      // 同步到子进程环境；模型 worker 禁用了设置来源，不能只依赖 settings.json。
      if (this.proxy) { env.HTTP_PROXY = this.proxy; env.HTTPS_PROXY = this.proxy }
      else { delete env.HTTP_PROXY; delete env.HTTPS_PROXY }
      delete env.http_proxy; delete env.https_proxy
      // CLI 模型流先连接本地 relay，回环地址不可被 HTTP 代理截走。
      env.NO_PROXY = [env.NO_PROXY ?? env.no_proxy ?? '', '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(',')
      delete env.no_proxy
    }
    env.PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS = '0'
    return env
  }
  async status(): Promise<ClaudeSubscriptionStatus> {
    const bound = !!(await this.store().list()).providers?.some(item => item.provider === 'claude-subscription')
    try {
      await this.loadProxy()
      const status = await getClaudeStatus(this.env(), AbortSignal.timeout(25000))
      if (status.command && this.version?.command !== status.command && !this.operation) {
        try {
          const env = Object.fromEntries(Object.entries(this.env()).filter((entry): entry is [string, string] => entry[1] !== undefined))
          const result = await captureProcess(status.command, ['--version'], env, AbortSignal.timeout(10000))
          const match = result.stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)
          if (result.code === 0 && match) this.version = { command: status.command, value: match[0] }
        } catch { /* 模型目录握手仍会独立检测协议兼容性。 */ }
      }
      return { proxy: this.proxy ?? '', version: this.version?.value, rateLimit: this.rateLimit, available: status.available, loggedIn: status.loggedIn, subscription: status.subscription, plan: status.plan, bound, busy: this.operation?.kind, url: this.url, error: this.error ?? (this.billingBlocked ? '检测到额外计费，订阅调用已锁定。请关闭账户额外付费后重新绑定' : undefined) ?? (status.loggedIn && !status.subscription ? '当前登录不是可识别的订阅账号，请使用 Claude Pro/Max 订阅登录' : undefined) }
    } catch (error) {
      return { proxy: this.proxy ?? process.env.HTTP_PROXY ?? '', available: false, loggedIn: false, subscription: false, bound, busy: this.operation?.kind, error: error instanceof ModelError ? error.message : 'Claude Code 状态检查失败，请重新检测' }
    }
  }
  private async confirm(message: string, detail: string): Promise<void> {
    const result = await dialog.showMessageBox({ type: 'warning', message, detail, buttons: ['取消', '继续'], defaultId: 0, cancelId: 0, noLink: true })
    if (result.response !== 1) throw new ModelError('已取消操作')
  }
  private launch(kind: 'login' | 'install' | 'logout', command: string, args: string[]): void {
    if (this.operation || this.closing) throw new ModelError('已有 Claude Code 操作正在进行')
    const child = spawnCommand(command, args, { env: this.env(), cwd: app.getPath('home'), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
    this.error = undefined; this.url = undefined
    const timer = setTimeout(() => { if (this.operation?.child === child) { this.error = '操作超时，请重试或使用终端完成'; killProcessTree(child) } }, kind === 'install' ? 5 * 60_000 : 10 * 60_000)
    this.operation = { kind, child, timer }
    // 不回传 CLI 原始输出，避免认证码、令牌或账号信息进入日志及 IPC。
    let tail = ''
    const consume = (chunk: Buffer): void => {
      if (kind !== 'login' || this.operation?.child !== child) return
      tail = (tail + chunk.toString('utf8')).slice(-16384)
      for (const candidate of tail.match(/https:\/\/[^\s<>"\u001b]+/g) ?? []) {
        try {
          const url = new URL(candidate)
          if (!['https://claude.ai', 'https://platform.claude.com'].includes(url.origin) || url.pathname !== '/oauth/authorize' || url.username || url.password) continue
          if (this.url === url.href) continue
          this.url = url.href
          void shell.openExternal(url.href).catch(() => { if (this.operation?.child === child) this.error = '浏览器打开失败，请复制授权链接' })
        } catch { /* 忽略非 URL 终端输出。 */ }
      }
    }
    child.stdout?.on('data', consume); child.stderr?.on('data', consume)
    child.stdin?.on('error', () => { if (this.operation?.child === child) this.error = '登录进程输入已关闭，请重新登录' })
    const finish = (success: boolean): void => {
      clearTimeout(timer)
      if (this.operation?.child !== child) return
      this.operation = undefined; this.url = undefined
      if (!success && !this.error) this.error = kind === 'install' ? '安装失败；请检查网络及系统权限，或按官方指引手动安装 CLI' : 'Claude Code 操作失败，请重新登录或在终端完成授权' 
    }
    child.once('error', () => finish(false))
    child.once('close', code => finish(code === 0))
  }
  async login(): Promise<void> {
    await this.loadProxy()
    if (this.operation) throw new ModelError('已有操作正在进行')
    await this.invalidate()
    const command = await resolveClaudeExecutable(this.env())
    if (!command) throw new ModelError('请先安装官方 Claude Code')
    this.launch('login', command, ['auth', 'login'])
  }
  async install(): Promise<void> {
    await this.loadProxy()
    if (this.operation) throw new ModelError('已有操作正在进行')
    if (process.platform !== 'win32' && process.platform !== 'darwin') throw new ModelError('当前平台不支持一键安装，请按官方指引手动安装')
    const windows = process.platform === 'win32'
    const script = 'curl -fsSL https://claude.ai/install.sh | bash'
    if (this.operation || this.closing) throw new ModelError('已有 Claude Code 操作正在进行')
    if (windows) {
      this.launch('install', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; irm https://claude.ai/install.ps1 | iex; if (-not $?) { exit 1 }"])
    } else {
      this.launch('install', '/bin/bash', ['-o', 'pipefail', '-c', script])
    }
  }
  async help(): Promise<void> { await shell.openExternal('https://code.claude.com/docs/en/setup') }
  async chooseExecutable(): Promise<void> {
    if (this.operation) throw new ModelError('请等待当前操作完成')
    const result = await dialog.showOpenDialog({ title: '选择官方 Claude Code 可执行文件', properties: ['openFile'] })
    if (result.canceled || !result.filePaths[0]) return
    const selected = result.filePaths[0]
    if (process.platform === 'win32' && !/\.exe$/i.test(selected)) throw new ModelError('请选择官方原生 claude.exe；npm 安装请使用默认路径自动检测')
    await this.confirm('使用选中的 Claude Code 程序？', '该程序将以当前用户身份运行。请仅选择可信的官方 Claude Code 可执行文件。')
    await this.invalidate()
    // 仅本次应用生命周期有效，不将任意可执行路径写入凭证配置。
    process.env.PI_CLAUDE_CODE_COMMAND = selected
  }
  submitCode(value: unknown): void {
    if (this.operation?.kind !== 'login' || !this.operation.child.stdin?.writable) throw new ModelError('当前没有等待授权的登录进程')
    if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\r\n\u0000-\u001f\u007f]/.test(value)) throw new ModelError('请输入单行授权码')
    // 仅写入官方登录进程的 stdin，不落盘、不记录日志。
    this.operation.child.stdin.write(`${value.trim()}\n`)
  }
  async cancel(): Promise<void> {
    const operation = this.operation
    if (!operation) return
    this.operation = undefined; clearTimeout(operation.timer); killProcessTree(operation.child)
    this.url = undefined; this.error = undefined
  }
  async logout(): Promise<void> {
    await this.loadProxy()
    if (this.operation) throw new ModelError('请先取消当前操作')
    await this.confirm('退出共享的 Claude Code 账号？', '此操作也会影响终端及其他使用该登录状态的工具。仅停用 Pi Runner 请改用“解除绑定”。')
    await this.unbind()
    const command = await resolveClaudeExecutable(this.env())
    if (command) this.launch('logout', command, ['auth', 'logout'])
  }
  private async invalidate(): Promise<void> {
    this.generation.abort(); this.generation = new AbortController(); this.models = []; this.rateLimit = undefined
    await closeClaudeProcesses()
  }
  async unbind() {
    await this.cancel(); await this.invalidate()
    return this.store().removeProvider('claude-subscription')
  }
  async bind() {
    if (this.operation) throw new ModelError('请等待登录或安装完成')
    await this.confirm('绑定 Claude 订阅？', 'Pi Runner 仅通过官方 CLI 使用订阅，不启用额外付费或 API 回退。请先关闭账户侧额外付费；本应用无法保证首次异常请求零费用，也无法保证账号不受限。')
    const next = await this.refreshModels(true)
    this.billingBlocked = false; this.error = undefined
    return next
  }
  async refreshModels(binding = false) {
    const generation = this.generation.signal
    const state = await this.status()
    if ((!binding && !state.bound) || !state.available || !state.loggedIn || !state.subscription || state.busy) throw new ModelError(state.error ?? '请先完成 Claude 订阅登录与绑定')
    const models = (await discoverClaudeModels(this.env(), generation)).map(modelFromDiscovery)
    generation.throwIfAborted()
    if (!models.length || models.length > 200) throw new ModelError('CLI 未返回有效模型目录，请更新 Claude Code 后重新检测')
    this.models = [...new Map(models.map(model => [model.id, model])).values()]
    return this.store().syncChatgpt(this.descriptors(), 'claude-subscription')
  }
  private descriptors(): ModelDescriptor[] {
    return this.models.map(model => {
      const values = [...getSupportedThinkingLevels(model)]
      return { id: model.id, name: model.name, maxContextTokens: model.contextWindow, maxOutputTokens: model.maxTokens,
        capabilities: ['completion', 'tools', ...(model.input.includes('image') ? ['vision'] : []), ...(model.reasoning ? ['thinking'] : [])],
        thinking: model.reasoning ? { values, default: values.includes('medium') ? 'medium' : values[0] } : undefined }
    })
  }
  async createProvider(profile: ModelProfile, attachments: PiAttachments, onActive: (active: boolean) => void = () => {}, cwd = homedir()) {
    const generation = this.generation.signal
    if (this.billingBlocked) throw new ModelError('Claude Code billing：额外计费保护已锁定调用，请关闭账户额外付费后重新绑定')
    if (this.closing || this.operation) throw new ModelError('Claude Code 当前不可用，请等待操作结束')
    const status = await this.status()
    if (!status.bound || !status.subscription) throw new ModelError(status.error ?? 'Claude 订阅未绑定或授权失效，请重新登录')
    if (!this.models.length) await this.refreshModels()
    generation.throwIfAborted()
    const source = this.models.find(model => model.id === profile.model)
    if (!source) throw new ModelError('该 Claude 模型不在当前账号目录中，请刷新模型列表')
    const configured = { ...source, contextWindow: Math.min(profile.contextTokens ?? source.contextWindow, source.contextWindow), maxTokens: Math.min(profile.maxTokens, source.maxTokens) }
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false })
    const env: ProviderEnv = Object.fromEntries(Object.entries(this.env()).filter((entry): entry is [string, string] => entry[1] !== undefined))
    runtime.registerProvider('claude-code', { api: configured.api, baseUrl: configured.baseUrl, apiKey: 'external-process', models: [configured],
      streamSimple: (model, context, options) => {
        const controller = new AbortController()
        return requestPiStream(() => streamClaudeCode(model, context, { ...options, env, temperature: undefined, maxTokens: configured.maxTokens, timeoutMs: profile.timeoutSeconds * 1000,
          signal: AbortSignal.any([generation, controller.signal, ...(options?.signal ? [options.signal] : [])])
        }, content => {
          const body = attachments.replacePayload({ messages: [{ role: 'user', content }] }, profile, false) as { messages: { content: unknown[] }[] }
          const converted = body.messages[0].content
          return typeof converted === 'string' ? [{ type: 'text', text: converted }] : converted
        }, info => {
          if (info.billingError) { this.billingBlocked = true; this.error = '检测到额外计费，已停止调用。请关闭账户侧额外付费后重新绑定'; void closeClaudeProcesses() }
          else this.rateLimit = { status: info.status, resetsAt: info.resetsAt, type: info.type }
        }, cwd), '', () => controller.abort(), onActive)
      }
    })
    return { runtime, model: runtime.getModel('claude-code', profile.model)!, thinkingLevel: profile.thinkingLevel ?? 'off' as const,
      ollamaCall: () => undefined }
  }
  shutdown(): Promise<void> {
    this.closing = true
    return this.shutdownTask ??= (async () => { await this.cancel(); await this.invalidate() })()
  }
}
export const claudeSubscription = new ClaudeSubscriptionService()
