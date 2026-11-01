import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** 共用供应商密钥输入、更新及安全存储反馈。 */
export function ApiProviderConnection({ name, apiKey, hasApiKey, encryptionAvailable, busy, onKeyChange, onConnect }: {
  name: string; apiKey: string; hasApiKey?: boolean; encryptionAvailable: boolean; busy: boolean
  onKeyChange(value: string): void; onConnect(): void
}): React.JSX.Element {
  return <fieldset className="provider-connection-form" disabled={busy}>
    <Label>API Key<Input type="password" value={apiKey} autoComplete="off" spellCheck={false} disabled={!encryptionAvailable} placeholder={hasApiKey ? '输入新的 API Key' : `输入 ${name} API Key`} onChange={event => onKeyChange(event.target.value)} /></Label>
    <p className="hint">密钥加密保存在本机，所有 {name} 模型共用。读取目录不会调用模型。</p>
    {!encryptionAvailable && <p className="error" role="alert">系统安全存储不可用，暂时无法保存 API Key。</p>}
    <Button disabled={!apiKey.trim() || !encryptionAvailable} onClick={onConnect}>{busy ? '正在读取模型…' : hasApiKey ? '更新密钥并读取模型' : '连接并读取模型'}</Button>
  </fieldset>
}
