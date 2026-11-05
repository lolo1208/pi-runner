import { useState } from 'react'
import { ArrowLeft, Plus, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { compatibleConnectionName } from '../../../shared/compatible-connection-name'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog'
import type { CompatibleConnection, CompatibleConnectionCommand, ModelProfileView, ModelSettings } from '../../../shared/models'
import { unwrapModelResult } from '../model-result'
import { OpenrouterCatalog } from './OpenrouterCatalog'
import { CompatibleConnectionIcon } from './CompatibleConnectionIcon'
import { ModelIcon } from './chat/ModelIcon'

const blank = (): CompatibleConnection => ({ id: crypto.randomUUID(), name: '', baseUrl: '', compatibleApi: 'chat-completions', models: [] })
export function CompatibleConnections({ settings, onChange, onConfigure, creating, onCloseCreate, onBack, onBusyChange }: {
  settings: ModelSettings; onChange: (settings: ModelSettings) => void; onConfigure: (profile: ModelProfileView) => void
  creating: boolean; onCloseCreate: () => void; onBack: () => void; onBusyChange?: (busy: boolean) => void
}): React.JSX.Element {
  const connections = settings.compatibleConnections ?? []
  const [selected, setSelected] = useState('')
  const current = connections.find(c => c.id === selected) ?? connections[0]
  const [draft, setDraft] = useState<CompatibleConnection>(blank)
  const [editOpen, setEditOpen] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [remove, setRemove] = useState<CompatibleConnectionCommand | null>(null)
  const open = creating || editOpen
  const run = async (command: CompatibleConnectionCommand): Promise<boolean> => {
    setBusy(true); onBusyChange?.(true); setError('')
    try { onChange(unwrapModelResult(await window.piRunner.manageCompatibleConnection(command))); return true }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); return false }
    finally { setBusy(false); onBusyChange?.(false) }
  }
  const edit = (c?: CompatibleConnection): void => { setDraft(c ?? blank()); setKey(''); setError(''); setEditOpen(true) }
  const close = (): void => { setEditOpen(false); setDraft(blank()); setKey(''); onCloseCreate() }
  const profiles = settings.profiles.filter(p => p.compatibleConnectionId === current?.id)
  const modelCount = new Set([...(current?.models.map(m => m.id) ?? []), ...profiles.map(p => p.model)]).size
  const toggleModel = (profile: ModelProfileView): void => {
    const saved = profiles.find(item => item.model === profile.model)
    if (!saved) { void run({ action: 'add-model', id: current.id, model: profile.model }); return }
    setBusy(true); onBusyChange?.(true); setError('')
    void window.piRunner.saveModelProfile({ profile: { ...saved, enabled: saved.enabled === false }, credential: { action: 'keep' } })
      .then(unwrapModelResult).then(onChange).catch(e => setError(e instanceof Error ? e.message : '操作失败，请重试'))
      .finally(() => { setBusy(false); onBusyChange?.(false) })
  }
  const configureModel = (profile: ModelProfileView): void => {
    const saved = profiles.find(item => item.model === profile.model)
    if (saved) { onConfigure(saved); return }
    onConfigure(profile)
  }
  return <div className="compatible-connections">
    <header className="provider-detail-heading"><span className="provider-icon" aria-hidden="true"><ModelIcon provider="custom" size={19} /></span><div><h3>OpenAI 兼容接口</h3></div><Button variant="outline" className="provider-remove" disabled={busy} onClick={() => edit()}><Plus size={15} />添加连接</Button></header>
    {current ? <Tabs value={current.id} onValueChange={value => { setSelected(value); setQuery(''); setError('') }}>
      <TabsList variant="line" className="compatible-connection-tabs" aria-label="兼容服务连接">{connections.map(c => <TabsTrigger key={c.id} value={c.id} disabled={busy} className="gap-2"><CompatibleConnectionIcon baseUrl={c.baseUrl} />{c.name}</TabsTrigger>)}</TabsList>
      <TabsContent value={current.id}>
      <div className="openrouter-connection compatible-connection-actions"><span className="hint compatible-connection-url">{current.baseUrl}</span><Button variant="ghost" className="compatible-remove-connection" disabled={busy} onClick={() => setRemove({ action: 'remove', id: current.id })}>移除连接</Button><Button variant="outline" disabled={busy} onClick={() => edit(current)}>配置连接</Button><Button variant="outline" disabled={busy} onClick={() => { void run({ action: 'refresh', id: current.id }) }}><RefreshCw size={15} />更新模型</Button></div>
      <div className="provider-model-toolbar"><div><h4>模型 <span>{modelCount}</span></h4></div></div>
      <div className="search-field provider-model-search"><Search size={15} /><Input aria-label="搜索兼容模型" placeholder="搜索模型名称或 ID" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <OpenrouterCatalog key={current.id} settings={settings} connection={current} query={query} busy={busy} getThinkingLabel={() => null} onConfigure={configureModel} onToggle={toggleModel} onRemoveManual={model => setRemove({ action: 'remove-model', id: current.id, model })} manualAdd={<div className="compatible-manual-model"><Input aria-label="手动填写模型 ID" placeholder="找不到模型？在此填写模型 ID" value={manual} onChange={e => setManual(e.target.value)} maxLength={200} /><Button variant="outline" disabled={busy || !manual.trim()} onClick={() => { void run({ action: 'add-model', id: current.id, model: manual.trim(), manuallyAdded: true }).then(ok => { if (ok) setManual('') }) }}>添加模型</Button></div>} />
      </TabsContent>
    </Tabs> : <p className="provider-no-results">还没有兼容连接，添加连接后即可读取模型目录。</p>}
    {!open && error && <p className="error" role="alert">{error}</p>}
    <Modal open={open} onOpenChange={value => { if (!value && !busy) close() }} title={connections.some(c => c.id === draft.id) && !creating ? '配置兼容连接' : '添加兼容连接'} contentClassName="provider-dialog" closeDisabled={busy}>
      <div className="provider-dialog-body model-settings"><fieldset disabled={busy}><Label>连接名称（可选）<Input value={draft.name} maxLength={80} placeholder={compatibleConnectionName(draft.baseUrl) || '留空时根据服务域名自动命名'} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Label><Label>Base URL<Input type="url" value={draft.baseUrl} placeholder="https://example.com/v1" onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} /></Label><Label>API Key<Input type="password" autoComplete="off" value={key} disabled={!settings.encryptionAvailable} placeholder={draft.hasApiKey ? '留空保留原密钥' : '请输入 API Key'} onChange={e => setKey(e.target.value)} /></Label>{error && <p className="error" role="alert">{error}</p>}</fieldset></div>
      <footer className="provider-dialog-footer" style={{ justifyContent: 'flex-end' }}>{creating && <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => { close(); onBack() }}><ArrowLeft size={15} />上一步</Button>}<Button className="primary" disabled={busy || !draft.baseUrl.trim()} onClick={() => { void run({ action: 'save', id: draft.id, name: draft.name.trim(), baseUrl: draft.baseUrl.trim(), compatibleApi: draft.compatibleApi, ...(key || !draft.hasApiKey ? { apiKey: key.trim() } : {}) }).then(ok => { if (ok) { setSelected(draft.id); close() } }) }}>保存连接</Button></footer>
    </Modal>
    <AlertDialog open={Boolean(remove)} onOpenChange={open => { if (!open && !busy) setRemove(null) }}><AlertDialogContent><AlertDialogTitle>{remove?.action === 'remove' ? '移除该连接？' : '移除该模型？'}</AlertDialogTitle><AlertDialogDescription>{remove?.action === 'remove' ? '将删除此连接、已保存的密钥及关联模型，不影响其他连接。此操作无法撤销。' : '将删除本地模型配置；之后可从目录重新添加。已有对话不会删除。'}</AlertDialogDescription>{error && <p className="error" role="alert">{error}</p>}<AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" disabled={busy}>取消</Button></AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => { if (remove) void run(remove).then(ok => { if (ok) setRemove(null) }) }}>确认移除</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
