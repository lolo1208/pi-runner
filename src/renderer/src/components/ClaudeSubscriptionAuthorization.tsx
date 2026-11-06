import { useEffect, useRef, useState } from 'react'
import { BookOpen, Copy, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import type { ClaudeSubscriptionStatus, ModelSettings } from '../../../shared/models'
import type { PiRunnerApi } from '../../../shared/api'
import { unwrapModelResult } from '../model-result'

type Action = Parameters<PiRunnerApi['claudeSubscription']>[0]
export function ClaudeSubscriptionAuthorization({ onChange }: { onChange(settings: ModelSettings): void }): React.JSX.Element {
  const [status, setStatus] = useState<ClaudeSubscriptionStatus | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [code, setCode] = useState('')
  const [proxyDraft, setProxyDraft] = useState<string | null>(null)
  const proxy = proxyDraft ?? status?.proxy ?? ''
  const mounted = useRef(true)
  const serial = useRef(0)
  const change = useRef(onChange); change.current = onChange
  useEffect(() => {
    mounted.current = true
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      const revision = serial.current
      try {
        const result = unwrapModelResult(await window.piRunner.claudeSubscription('status'))
        if (active && revision === serial.current) setStatus(result.status)
        if (active) timer = setTimeout(() => { void poll() }, result.status.busy ? 3000 : 30000)
      } catch (error) {
        if (active) { setError(error instanceof Error ? error.message : '状态读取失败，请重新检测'); timer = setTimeout(() => { void poll() }, 10000) }
      }
    }
    void poll()
    return () => { active = false; mounted.current = false; clearTimeout(timer) }
  }, [])
  const run = async (action: Action, input?: string): Promise<void> => {
    ++serial.current; setPending(true); setError(''); setMessage('')
    try {
      if (action === 'login' || (['install', 'bind', 'refresh', 'choose'].includes(action) && proxyDraft !== null)) {
        const saved = unwrapModelResult(await window.piRunner.claudeSubscription('proxy', proxy))
        if (!mounted.current) return
        setStatus(saved.status); setProxyDraft(null)
      }
      const result = unwrapModelResult(await window.piRunner.claudeSubscription(action, input))
      if (!mounted.current) return
      setStatus(result.status)
      if (action === 'submit' || action === 'cancel') setCode('')
      if (action === 'proxy') { setProxyDraft(null); setMessage(input?.trim() ? 'CLI 代理已保存，下次启动 CLI 时生效。' : '已清除 CLI 的 HTTP_PROXY 和 HTTPS_PROXY 配置。') }
      if (result.settings) change.current(result.settings)
      if (action === 'bind' || action === 'refresh') setMessage('已读取当前账号模型，可在下方选择和配置。')
      if (action === 'login') setMessage('请在浏览器完成官方授权，登录状态会自动更新，完成后绑定订阅。')
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : '操作失败，请重试')
    } finally { if (mounted.current) setPending(false) }
  }
  const busy = pending || !!status?.busy
  const ready = status?.available && status.loggedIn && status.subscription
  return <section className="chatgpt-authorization" aria-label="Claude 订阅授权" aria-busy={pending}>
    {!status?.available && <div className="claude-install-section">
      <h3 className="text-sm font-medium">安装 Claude Code</h3>
      <p className="hint" role="status">{!status ? '正在检测官方 Claude Code…' : status.busy === 'install' ? '正在安装 Claude Code…' : '尚未检测到 Claude Code，程序需要通过官方 Claude Code 登录和使用 Claude 订阅，请先安装。'}</p>
      <div className="chatgpt-auth-actions flex-wrap">
        <Button variant="outline" size="icon" disabled={pending} aria-label="重新检测" title="重新检测" onClick={() => { void run('status') }}><RefreshCw size={15} /></Button>
        <Button variant="outline" size="icon" disabled={busy} aria-label="选择已安装的程序" title="选择已安装的程序" onClick={() => { void run('choose') }}><FolderOpen size={15} /></Button>
        <Button variant="outline" size="icon" disabled={pending} aria-label="官方指引" title="官方指引" onClick={() => { void run('help') }}><BookOpen size={15} /></Button>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button className="primary" disabled={busy || !status}>安装 Claude Code</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>安装官方 Claude Code？</AlertDialogTitle>
            <AlertDialogDescription>将根据系统下载并执行对应的官方安装脚本，需要网络，不会自动提权。</AlertDialogDescription>
            <div className="grid gap-2 text-sm">
              <div><Button type="button" variant="link" onClick={() => { void window.piRunner.claudeSubscription('help').then(unwrapModelResult).catch(() => setError('无法打开官方文档，请重试')) }}>查看官方文档</Button></div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel asChild><Button variant="outline">取消</Button></AlertDialogCancel>
              <AlertDialogAction asChild><Button className="primary" onClick={() => { void run('install') }}>确定</Button></AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {status?.busy === 'install' && <Button variant="ghost" disabled={pending} onClick={() => { void run('cancel') }}>取消安装</Button>}
      </div>
    </div>}
    <div className="grid gap-2">
      <Label htmlFor="claude-http-proxy">Claude Code 网络代理（可选）</Label>
      <Input id="claude-http-proxy" value={proxy} disabled={busy || !status} maxLength={2048} placeholder="127.0.0.1:7890 或 http://127.0.0.1:7890" autoComplete="off" spellCheck={false} aria-describedby="claude-http-proxy-help" onChange={event => setProxyDraft(event.target.value)} />
      <p id="claude-http-proxy-help" className="hint">提示：未配置时默认使用系统环境变量 HTTP_PROXY 和 HTTPS_PROXY。<br />配置后将写入 ~/.claude/settings.json，该设置在所有 Claude Code 工具间共享。</p>
    </div>
    {status?.available && <div className="mt-5 border-t border-[var(--border)] pt-5">
      <h3 className="text-sm font-medium">Claude 订阅登录</h3>
      <p className="hint" role="status">{status.busy === 'login' ? '等待浏览器授权…' : status.busy === 'logout' ? '正在退出共享账号…' : !status.loggedIn ? 'Claude Code 已安装，请登录订阅账号。' : !status.subscription ? '当前登录无法识别为订阅账号，请重新登录。' : status.bound ? `已绑定 Claude 订阅${status.plan ? ` · ${status.plan}` : ''}` : '已检测到订阅登录，绑定后即可加载模型。'}</p>
    </div>}
    {status?.available && <div className="chatgpt-auth-actions flex-wrap">
      <Button variant="outline" size="icon" disabled={pending} aria-label="重新检测登录状态" title="重新检测登录状态" onClick={() => { void run('status') }}><RefreshCw size={15} /></Button>
      {status?.available && ready && (!status.bound || status.error) && <Button disabled={busy} onClick={() => { void run('bind') }}>{status?.bound ? '确认并重新绑定' : '绑定订阅并加载模型'}</Button>}
      {status?.available && <Button className={ready ? undefined : 'primary'} variant={ready ? 'outline' : 'default'} disabled={busy} onClick={() => { void run('login') }}><ExternalLink size={15} />{status.loggedIn ? '切换账号 / 重新登录' : '登录 Claude 订阅'}</Button>}
      {status?.bound && <Button variant="outline" disabled={busy} onClick={() => { void run('refresh') }}><RefreshCw size={15} />更新模型</Button>}
      {status?.busy && <Button variant="ghost" disabled={pending} onClick={() => { void run('cancel') }}>{status.busy === 'login' ? '取消登录' : '取消当前操作'}</Button>}
      {status?.url && <Button variant="outline" disabled={pending} onClick={() => { void window.piRunner.copyText(status.url!).then(() => setMessage('已复制本次授权链接。')).catch(() => setError('复制失败，请重新登录')) }}><Copy size={15} />复制授权链接</Button>}
    </div>}
    {message && <p className="hint" role="status">{message}</p>}
    {status?.busy === 'login' && <details className="provider-advanced"><summary>需要手动输入授权码？</summary><Label htmlFor="claude-login-code">官方授权页面提供的单行授权码</Label><Input id="claude-login-code" type="password" autoComplete="off" value={code} maxLength={8192} onChange={event => setCode(event.target.value)} /><p className="hint">仅在登录时要求手动输入授权码的情况下使用。授权码仅用于本次登录，不会保存。</p><div className="mt-4"><Button variant="outline" disabled={pending || !code.trim()} onClick={() => { void run('submit', code) }}>提交授权码</Button></div></details>}
    {(status?.bound || status?.loggedIn) && <div className="chatgpt-auth-actions flex-wrap">
      {status.bound && <Button variant="ghost" disabled={busy} onClick={() => { void run('unbind') }}>解除 Pi Runner 绑定</Button>}
      {status.loggedIn && <Button variant="ghost" disabled={busy} onClick={() => { void run('logout') }}>退出共享 Claude Code 账号</Button>}
    </div>}
    {(error || status?.error) && <p className="error" role="alert">{error || status?.error}</p>}
  </section>
}
