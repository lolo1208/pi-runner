import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ModelDescriptor, ModelProfile } from '../../../shared/models'
import { unwrapModelResult } from '../model-result'

/** 新建与编辑共用兼容服务连接配置；目录不可用时始终允许手填。 */
export function CompatibleModelConnection({ profile, apiKey, saved, onChange, compact = false, parametersOnly = false }: {
  profile: ModelProfile; apiKey: string; saved?: boolean; compact?: boolean; parametersOnly?: boolean
  onChange: <K extends Exclude<keyof ModelProfile, 'name'>>(field: K, value: ModelProfile[K]) => void
}): React.JSX.Element {
  const [parameters, setParameters] = useState(() => profile.compatibleParameters ? JSON.stringify(profile.compatibleParameters, null, 2) : '')
  const [parameterError, setParameterError] = useState('')
  const [models, setModels] = useState<ModelDescriptor[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const requestVersion = useRef(0)
  useEffect(() => {
    requestVersion.current++
    setModels([]); setMessage(''); setBusy(false)
    return () => { requestVersion.current++ }
  }, [profile.baseUrl, apiKey, saved])
  return <div className="provider-connection-form">
    {!parametersOnly && <>
    {!compact && <p className="hint">使用 OpenAI 兼容服务。密钥按模型加密保存，可添加不同地址的多个模型。远程地址须使用 HTTPS。</p>}
    <Label>调用接口<Select value={profile.compatibleApi ?? 'chat-completions'} onValueChange={value => onChange('compatibleApi', value as ModelProfile['compatibleApi'])}>
      <SelectTrigger aria-label="调用接口"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="chat-completions">Chat Completions</SelectItem><SelectItem value="responses">Responses</SelectItem></SelectContent>
    </Select></Label>
    <Button type="button" variant="outline" disabled={busy || !profile.baseUrl.trim()} onClick={async () => {
      const version = ++requestVersion.current
      setBusy(true); setMessage(''); setModels([])
      try {
        const result = unwrapModelResult(await window.piRunner.listCompatibleModels({ baseUrl: profile.baseUrl, apiKey: apiKey.trim(), ...(saved && !apiKey.trim() ? { profileId: profile.id } : {}) }))
        if (version !== requestVersion.current) return
        setModels(result); setMessage(result.length ? `读取到 ${result.length} 个模型。请选择或手动填写模型 ID。` : '服务未返回模型，可手动填写模型 ID。')
      } catch (error) { if (version === requestVersion.current) setMessage(error instanceof Error ? error.message : '读取失败，可手动填写模型 ID。') }
      finally { if (version === requestVersion.current) setBusy(false) }
    }}>{busy ? '正在读取…' : '读取模型列表'}</Button>
    {models.length > 0 && <Label>目录模型<Select value={models.some(model => model.id === profile.model) ? profile.model : ''} onValueChange={value => {
      onChange('model', value)
      const model = models.find(item => item.id === value)
      const context = model?.maxContextTokens && model.maxContextTokens <= 2097152 ? model.maxContextTokens : null
      onChange('contextTokens', context)
      onChange('maxTokens', Math.min(model?.maxOutputTokens ?? profile.maxTokens, context ?? 131072, 131072))
    }}>
      <SelectTrigger aria-label="目录模型"><SelectValue placeholder="选择模型" /></SelectTrigger><SelectContent>{models.map(model => <SelectItem key={model.id} value={model.id}>{model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id}</SelectItem>)}</SelectContent>
    </Select></Label>}
    {message && <p className="hint" role="status">{message}</p>}
    <Label>模型 ID<Input value={profile.model} maxLength={200} placeholder="例如 gpt-4.1" onChange={event => onChange('model', event.target.value)} /></Label>
    </>}
    {!compact && <Label>扩展参数（JSON 对象）<Textarea value={parameters} maxLength={16384} spellCheck={false} placeholder={'例如 {"top_p":0.9,"reasoning_effort":"high"}'} aria-invalid={Boolean(parameterError)} onChange={event => {
      const text = event.target.value; setParameters(text)
      try {
        const value: unknown = text.trim() ? JSON.parse(text) : {}
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请输入 JSON 对象')
        onChange('compatibleParameters', value as Record<string, unknown>); setParameterError('')
      } catch {
        setParameterError('JSON 格式无效，修正后才能保存。')
        // 让主进程的统一配置校验拒绝保存无效草稿，不能静默保存旧参数。
        onChange('compatibleParameters', null as unknown as Record<string, unknown>)
      }
    }} /></Label>}
    {parameterError && <p className="error" role="alert">{parameterError}</p>}
  </div>
}
