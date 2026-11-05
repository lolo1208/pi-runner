import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ChatgptAuthStatus, ModelSettings } from '../../../shared/models'
import { unwrapModelResult } from '../model-result'
import { notify as setNotice, notifyModelCatalog } from '../lib/notify'
import { toast } from 'sonner'

export function ChatgptAuthorization({ onChange }: { onChange(settings: ModelSettings): void }): React.JSX.Element {
  const [auth, setAuth] = useState<ChatgptAuthStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [callback, setCallback] = useState('')
  const change = useRef(onChange); change.current = onChange
  const previous = useRef<ChatgptAuthStatus['state'] | undefined>(undefined)
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const status = unwrapModelResult(await window.piRunner.getChatgptAuth())
        if (!active) return
        setAuth(status)
        if (status.error) { setError(status.error); setNotice('') }
        else if (status.state === 'signed-in') setError('')
        const refresh = status.state === 'signed-in' && previous.current === 'authorizing'
        previous.current = status.state
        if (refresh) {
          setBusy(true)
          try { const settings = unwrapModelResult(await window.piRunner.refreshChatgptModels()); if (active) { change.current(settings); setNotice('ChatGPT 已授权，可用模型已加载') } }
          catch (e) { if (active) setError(e instanceof Error ? e.message : '模型列表读取失败，请点击更新模型重试') }
          finally { if (active) setBusy(false) }
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '无法读取授权状态，请重新打开模型设置') }
      if (active) timer = setTimeout(() => { void poll() }, 1000)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [])
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (e) { toast.error('ChatGPT 操作失败', { description: e instanceof Error ? e.message : '授权操作失败，请重试', duration: 8000 }) }
    finally { setBusy(false) }
  }
  const authorize = (copy: boolean): void => { void run(async () => {
    const next = unwrapModelResult(await window.piRunner.startChatgptAuth())
    setAuth(next); previous.current = next.state
    if (next.error || !next.url) throw new Error(next.error ?? '授权链接生成失败，请重试')
    unwrapModelResult(await (copy ? window.piRunner.copyChatgptAuthLink() : window.piRunner.openChatgptAuth()))
    setNotice(copy ? '已复制授权链接，请在隐私窗口中粘贴并登录' : '请在浏览器中完成授权，完成后会自动返回应用')
  }) }
  return <div className="chatgpt-authorization" aria-label="ChatGPT 订阅授权">
    {auth?.state !== 'signed-in' && <p className="hint" role="status">{!auth ? '正在读取授权状态…' : auth.state === 'authorizing' ? '等待浏览器授权…' : '使用 ChatGPT 订阅账号登录，无需 API Key。'}</p>}
    {auth?.state === 'signed-in' ? <div className="chatgpt-auth-actions">
      <AlertDialog>
        <AlertDialogTrigger asChild><Button disabled={busy} variant="ghost" className="compatible-remove-connection">退出账号</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>退出 ChatGPT 账号？</AlertDialogTitle>
          <AlertDialogDescription>退出后需要重新授权才能使用订阅模型，已保存的模型参数和对话不会删除。</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button variant="outline">取消</Button></AlertDialogCancel>
            <AlertDialogCancel asChild><Button variant="destructive" onClick={() => { void run(async () => { unwrapModelResult(await window.piRunner.logoutChatgpt()); setAuth({ state: 'signed-out' }); previous.current = 'signed-out'; setNotice('已退出 ChatGPT 账号，模型参数与对话保留') }) }}>确认退出</Button></AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button disabled={busy} variant="outline" onClick={() => { void run(async () => { const next = unwrapModelResult(await window.piRunner.refreshChatgptModels()); change.current(next); notifyModelCatalog('ChatGPT', next.providers?.find(item => item.provider === 'chatgpt')?.models.length ?? 0, '请检查账号权限，或重新授权后刷新。') }) }}><RefreshCw size={15} />更新模型</Button>
    </div> : <>
      <div className="chatgpt-auth-actions"><Button disabled={busy || !auth} onClick={() => authorize(false)}><ExternalLink size={15} />在浏览器中授权</Button><Button disabled={busy || !auth} variant="outline" onClick={() => authorize(true)}><Copy size={15} />复制授权链接</Button>
        {auth?.state === 'authorizing' && <Button disabled={busy} variant="ghost" onClick={() => { void run(async () => { unwrapModelResult(await window.piRunner.cancelChatgptAuth()); setAuth({ state: 'signed-out' }); previous.current = 'signed-out' }) }}>取消授权</Button>}
      </div>
      <p className="hint">可复制链接到浏览器隐私模式中登录。链接仅用于本次授权，有效期 10 分钟。</p>
      {auth?.manualInput && <details className="provider-advanced"><summary>浏览器未自动返回？</summary><Label>浏览器回调地址<Input value={callback} onChange={event => setCallback(event.target.value)} placeholder="http://localhost:1455/auth/callback?…" autoComplete="off" /></Label><p className="hint">授权完成后，如本地回调页面无法打开，请复制浏览器地址栏中的完整地址到这里。</p><Button disabled={busy || !callback.trim()} variant="outline" onClick={() => { void run(async () => { unwrapModelResult(await window.piRunner.submitChatgptCallback(callback)); setCallback(''); setNotice('已提交回调地址，正在完成授权…') }) }}>完成授权</Button></details>}
    </>}
    {busy && <p className="hint" role="status">正在处理…</p>}
    {auth?.state === 'signed-in' && auth.catalogSource === 'sdk' && <p className="hint">账户模型目录暂不可用，当前显示 pi SDK 内置目录；实际可用性取决于账号权限。可点击更新模型重试。</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>
}
