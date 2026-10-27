import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Cpu, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { ModelIcon } from './components/chat/ModelIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PROVIDER_PRESETS, selectedModelThinking, thinkingLabel, type ModelDescriptor, type ModelProfile, type ModelProfileView, type ModelSettings, type ProviderId } from '../../shared/models'
import { ModelProfileFields } from './components/ModelProfileFields'
import { ModelProfileActions } from './components/ModelProfileActions'
import { unwrapModelResult } from './model-result'
import { ChatgptAuthorization } from './components/ChatgptAuthorization'
import { OpenrouterCatalog } from './components/OpenrouterCatalog'
import { ModelPriceTag } from './components/ModelPriceTag'
import { callableOpenrouterModels, defaultOpenrouterMaxTokens } from '../../shared/openrouter'
import { automaticOutputTokens, systemOutputTokens } from '../../shared/output-tokens'
import { PagedList } from './components/PagedList'

function newProfile(provider: ProviderId): ModelProfile {
  const preset = PROVIDER_PRESETS.find(item => item.id === provider)!
  return { id: crypto.randomUUID(), name: preset.label, provider, protocol: preset.protocol, baseUrl: preset.baseUrl,
    model: '', temperature: null, maxTokens: provider === 'openrouter' ? defaultOpenrouterMaxTokens() : 2048, ...(provider === 'openrouter' ? { autoMaxTokens: true } : {}), tokenParameter: provider === 'openai' ? 'max_completion_tokens' : 'max_tokens', timeoutSeconds: provider === 'openrouter' ? 120 : 60 }
}
function providerName(provider: ProviderId): string { return PROVIDER_PRESETS.find(item => item.id === provider)!.label }
const PROFILE_EDIT_FIELDS = ['name', 'provider', 'protocol', 'baseUrl', 'model', 'temperature', 'maxTokens', 'autoMaxTokens', 'tokenParameter', 'timeoutSeconds', 'contextTokens', 'thinking', 'thinkingLevel', 'ollamaThinkingLevel'] as const
function profileEdited(profile: ModelProfile, saved: ModelProfileView): boolean {
  return PROFILE_EDIT_FIELDS.some(field => profile[field] !== saved[field])
}
function ProviderIcon({ provider, model }: { provider: ProviderId; model?: string }): React.JSX.Element {
  return <span className="provider-icon" aria-hidden="true"><ModelIcon provider={provider} model={model} size={19} /></span>
}
interface Props { settings: ModelSettings; onChange(settings: ModelSettings): void; onClose(): void; onBusyChange?(busy: boolean): void }
export default function ModelSettingsPanel({ settings, onChange, onBusyChange }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<ProviderId | null>(() => {
    const available = new Set([...settings.profiles.map(item => item.provider), ...(settings.providers ?? []).map(item => item.provider)])
    return (['openrouter', 'ollama', 'chatgpt'] as const).find(provider => available.has(provider)) ?? null
  })
  const [profile, setProfile] = useState<ModelProfile>(() => newProfile('ollama'))
  const [dialog, setDialog] = useState<'choose' | 'configure' | null>(null)
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [providerQuery, setProviderQuery] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const openrouterConnection = settings.providers?.find(item => item.provider === 'openrouter')
  const [modelInfo, setModelInfo] = useState<ModelDescriptor | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoError, setInfoError] = useState('')
  const [infoRevision, setInfoRevision] = useState(0)
  const openrouterPricingRefresh = useRef<{ revision: number; request: Promise<ModelSettings> } | null>(null)
  const latestSettings = useRef(settings)
  latestSettings.current = settings
  const [test, setTest] = useState<{ status: 'idle' | 'running' | 'success' | 'failure'; message?: string }>({ status: 'idle' })
  const [savedFlash, setSavedFlash] = useState(false)
  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (testTimer.current) clearTimeout(testTimer.current); if (savedTimer.current) clearTimeout(savedTimer.current) }, [])
  const saved = settings.profiles.find(item => item.id === profile.id)
  const profileDirty = !saved || apiKey.trim() !== '' || removeKey || profileEdited(profile, saved)
  const providers = [...new Set([...settings.profiles.map(item => item.provider), ...(settings.providers ?? []).map(item => item.provider)])]
  const ollamaConnection = settings.providers?.find(item => item.provider === 'ollama')
  const currentOllamaUrl = ollamaConnection?.baseUrl ?? settings.profiles.find(item => item.provider === 'ollama')?.baseUrl ?? 'http://localhost:11434'
  const preferredProvider = (['openrouter', 'ollama', 'chatgpt'] as const).find(provider => providers.includes(provider))
  const currentProvider = selected && providers.includes(selected) ? selected : preferredProvider ?? providers[0] ?? null
  const models = settings.profiles.filter(item => item.provider === currentProvider)
  const shownModelCount = currentProvider === 'openrouter' ? new Set([...callableOpenrouterModels(openrouterConnection?.models ?? []).map(item => item.id), ...models.map(item => item.model)]).size : models.length
  const descriptors = new Map<string, ModelDescriptor>()
  for (const connection of settings.providers ?? []) for (const model of connection.models) descriptors.set(`${connection.provider}:${model.id}`, model)
  /** 只展示模型真正支持的推理档位，避免给不支持推理的模型显示误导性标签。 */
  const modelThinkingLabel = (item: ModelProfileView): string | null => {
    const controls = descriptors.get(`${item.provider}:${item.model}`)?.thinking
    if (!controls?.values.some(value => value !== false && value !== 'off')) return null
    return thinkingLabel(selectedModelThinking(item, controls))
  }
  const filteredModels = models
    .filter(item => `${item.name} ${item.model}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(a.enabled === false) - Number(b.enabled === false)
      || b.name.localeCompare(a.name, 'zh-CN', { numeric: true, sensitivity: 'base' }))
  const options = (['chatgpt', 'ollama', 'openrouter'] as const).filter(provider => `${providerName(provider)} ${provider === 'chatgpt' ? '订阅 OpenAI ChatGPT' : provider === 'ollama' ? '本地' : 'API 云端 多厂家模型'}`.toLowerCase().includes(providerQuery.trim().toLowerCase()))
  const subscription = profile.provider === 'chatgpt' && !editing
  const connectingOllama = dialog === 'configure' && profile.provider === 'ollama' && !editing
  const connectingOpenrouter = dialog === 'configure' && profile.provider === 'openrouter' && !editing
  useEffect(() => {
    if (dialog !== 'configure' || !editing || !['ollama', 'chatgpt', 'openrouter'].includes(profile.provider)) { setModelInfo(null); setInfoError(''); setInfoLoading(false); return }
    if (profile.provider === 'openrouter') {
      const cached = openrouterConnection?.models.find(item => item.id === profile.model)
      setModelInfo(cached ?? null); setInfoError(''); setInfoLoading(false)
      if (!cached || !openrouterConnection?.hasApiKey || cached.cachePricingChecked) return
      let disposed = false
      setInfoLoading(true)
      // 升级前的目录未保存缓存定价；一次刷新补齐全部模型，缺失值不触发重复刷新。
      if (!openrouterPricingRefresh.current || openrouterPricingRefresh.current.revision !== infoRevision) {
        openrouterPricingRefresh.current = { revision: infoRevision, request: Promise.resolve().then(() => window.piRunner.connectOpenrouter()).then(unwrapModelResult) }
      }
      void openrouterPricingRefresh.current.request.then(next => {
        if (disposed) return
        const connection = next.providers?.find(item => item.provider === 'openrouter')
        if (!connection) throw new Error('OpenRouter 未返回模型目录，请重试')
        setModelInfo(connection.models.find(item => item.id === profile.model) ?? cached)
        // 只更新目录，保留刷新期间用户保存的模型参数和启停状态。
        onChange({ ...latestSettings.current, providers: latestSettings.current.providers?.map(item => item.provider === 'openrouter' ? { ...item, models: connection.models } : item) })
      }).catch(error => {
        if (!disposed) setInfoError(error instanceof Error ? error.message : 'OpenRouter 价格读取失败，请重试')
      }).finally(() => { if (!disposed) setInfoLoading(false) })
      return () => { disposed = true }
    }
    let disposed = false
    const cached = profile.provider === 'chatgpt' ? settings.providers?.find(item => item.provider === 'chatgpt')?.models.find(item => item.id === profile.model) : ollamaConnection?.baseUrl === profile.baseUrl.replace(/\/v1\/?$/, '') ? ollamaConnection.models.find(item => item.id === profile.model) : undefined
    setModelInfo(cached ?? null)
    if (profile.provider === 'chatgpt' && cached?.thinking != null) { setInfoError(''); setInfoLoading(false); return }
    setInfoLoading(true); setInfoError('')
    const request = profile.provider === 'chatgpt' ? window.piRunner.getChatgptModelInfo(profile.model) : window.piRunner.getOllamaModelInfo(profile.baseUrl, profile.model)
    void request.then(unwrapModelResult).then(info => { if (!disposed) setModelInfo(current => ({ ...info, sizeBytes: info.sizeBytes ?? current?.sizeBytes })) }).catch(e => {
      if (!disposed) setInfoError(e instanceof Error ? e.message : '模型信息读取失败，请重试')
    }).finally(() => { if (!disposed) setInfoLoading(false) })
    return () => { disposed = true }
  }, [dialog, editing, profile.id, profile.baseUrl, profile.model, infoRevision, ollamaConnection, settings.providers])
  const update = <K extends Exclude<keyof ModelProfile, 'name'>>(field: K, value: ModelProfile[K]): void => {
    setProfile(current => ({ ...current, [field]: value })); setNotice('')
  }
  const run = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true); onBusyChange?.(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试') }
    finally { setIsBusy(false); onBusyChange?.(false); setRequestId(null) }
  }
  const save = async (): Promise<void> => {
    if (profile.contextTokens != null && modelInfo?.maxContextTokens != null && profile.contextTokens > modelInfo.maxContextTokens) throw new Error('上下文上限不能超过模型支持的最大上下文')
    const contextTokens = profile.contextTokens ?? modelInfo?.maxContextTokens
    const normalizedProfile = { ...profile,
      contextTokens: contextTokens == null ? null : Math.floor(contextTokens / 1000) * 1000,
      temperature: profile.provider === 'chatgpt' || (profile.provider === 'openrouter' && profile.temperature === null) ? null : Math.floor(profile.temperature ?? 1),
      maxTokens: systemOutputTokens(profile.provider) ? automaticOutputTokens({ ...profile, contextTokens: contextTokens == null ? null : Math.floor(contextTokens / 1000) * 1000 }, modelInfo) : Math.floor(profile.maxTokens ?? 2048),
      ...(systemOutputTokens(profile.provider) ? { autoMaxTokens: true } : {}),
      timeoutSeconds: Math.floor(profile.timeoutSeconds ?? (profile.provider === 'ollama' ? 120 : 60)) }
    const selected = selectedModelThinking(profile, modelInfo?.thinking)
    if (profile.provider === 'chatgpt' || profile.provider === 'openrouter') {
      normalizedProfile.thinkingLevel = typeof selected === 'string' ? selected as ModelProfile['thinkingLevel'] : null
      normalizedProfile.thinking = null
    } else if (profile.provider === 'ollama') {
      normalizedProfile.ollamaThinkingLevel = typeof selected === 'string' ? selected : null
      normalizedProfile.thinking = typeof selected === 'boolean' ? selected : null
    }
    const next = unwrapModelResult(await window.piRunner.saveModelProfile({ profile: normalizedProfile,
      credential: apiKey.trim() ? { action: 'replace', value: apiKey } : { action: removeKey ? 'remove' : 'keep' } }))
    onChange(next); setApiKey(''); setRemoveKey(false); setSelected(profile.provider)
    setProfile(next.profiles.find(item => item.id === profile.id)!); setEditing(true)
  }
  const configure = (provider: ProviderId, existing?: ModelProfile): void => {
    setProfile(existing ?? newProfile(provider)); setEditing(Boolean(existing)); setDialog('configure')
    setApiKey(''); setRemoveKey(false); setError(''); setNotice('')
    if (provider === 'ollama' && !existing) setOllamaUrl(currentOllamaUrl.replace(/\/v1\/?$/, ''))
  }
  const connectOllama = (baseUrl: string, close = false): void => { void run(async () => {
    const next = unwrapModelResult(await window.piRunner.connectOllama(baseUrl))
    onChange(next); setSelected('ollama'); setQuery('')
    if (close) setDialog(null)
    const count = next.providers?.find(item => item.provider === 'ollama')?.models.length ?? 0
    setNotice(count ? `已读取 ${count} 个 Ollama 模型` : 'Ollama 已连接，尚未发现模型。请先使用 ollama pull 下载模型，再刷新列表。')
  }) }
  const connectOpenrouter = (refresh = false): void => { void run(async () => {
    const next = unwrapModelResult(await window.piRunner.connectOpenrouter(refresh ? undefined : apiKey.trim()))
    onChange(next); setSelected('openrouter'); setQuery(''); setApiKey('')
    if (!refresh) setDialog(null)
  }) }
  const toggleModel = (item: ModelProfileView): void => { void run(async () => {
    const next = unwrapModelResult(await window.piRunner.saveModelProfile({ profile: { ...item, enabled: item.enabled === false }, credential: { action: 'keep' } }))
    onChange(next)
    if (item.id === profile.id) setProfile(next.profiles.find(profile => profile.id === item.id)!)
    setNotice(item.enabled === false ? `已启用 ${item.name}` : `已停用 ${item.name}`)
  }) }
  const saveProfile = (): void => { void run(async () => { await save(); setNotice(''); setSavedFlash(true); if (savedTimer.current) clearTimeout(savedTimer.current); savedTimer.current = setTimeout(() => setSavedFlash(false), 2000) }) }
  const saveAndTest = (): void => { void run(async () => {
    await save()
    const id = crypto.randomUUID(); setRequestId(id)
    setTest({ status: 'running' })
    try {
      const result = unwrapModelResult(await window.piRunner.testModel(profile.id, id))
      const elapsed = result.elapsedMs >= 1000 ? `${(Math.floor(result.elapsedMs / 100) / 10).toFixed(1)}s` : `${result.elapsedMs} ms`
      setTest({ status: 'success', message: `连接成功 · ${elapsed} · ${result.model}${result.truncated ? '（测试输出达到 Token 上限）' : ''}` })
    } catch (e) {
      const message = e instanceof Error ? e.message : '测试连接失败，请重试'
      if (message.includes('取消')) { setTest({ status: 'idle' }); return }
      setTest({ status: 'failure', message: `连接失败 · ${message}` })
    }
    if (testTimer.current) clearTimeout(testTimer.current)
    testTimer.current = setTimeout(() => setTest({ status: 'idle' }), 4000)
  }) }
  const feedback = <div className="provider-dialog-feedback" aria-live="polite">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
  </div>
  return <section className="model-settings" aria-labelledby="model-settings-title">
    <div className="section-heading"><h2 id="model-settings-title">模型供应商</h2></div>
    <p className="section-description">管理模型来源、连接方式与各模型的独立配置。</p>
    <div className="provider-workspace">
      <aside className="provider-sidebar" aria-label="已配置的模型供应商">
        <p className="provider-sidebar-label">已配置的供应商</p>
        <nav aria-label="供应商列表">{providers.map(provider => { const count = settings.profiles.filter(item => item.provider === provider).length; return <Button key={provider} variant="ghost" disabled={isBusy} className="provider-nav-item" aria-current={provider === currentProvider ? 'page' : undefined} onClick={() => { setSelected(provider); setQuery(''); setError(''); setNotice('') }}>
          <ProviderIcon provider={provider} /><span className="provider-nav-name">{providerName(provider)}</span><Tooltip><TooltipTrigger asChild><small aria-label={`${count} 个模型`}>{count}</small></TooltipTrigger><TooltipContent>{count} 个模型</TooltipContent></Tooltip>
        </Button> })}</nav>
        {!providers.length && <p className="hint provider-sidebar-empty">添加供应商后，将在这里显示。</p>}
        <Button variant="outline" className="provider-add" disabled={isBusy} onClick={() => { setEditing(false); setDialog('choose'); setProviderQuery(''); setError(''); setNotice('') }}><Plus size={16} />添加供应商</Button>
      </aside>
      <div className="provider-detail">
        {currentProvider ? <>
          <header className="provider-detail-heading"><ProviderIcon provider={currentProvider} /><div><h3>{providerName(currentProvider)}</h3><p>{currentProvider === 'ollama' ? '本地服务 · Ollama' : currentProvider === 'chatgpt' ? 'ChatGPT 订阅账号' : 'API 配置'}</p></div><span className="provider-badge">已配置</span></header>
          <div className="provider-connection-summary"><span>连接方式</span><strong>{currentProvider === 'ollama' ? currentOllamaUrl : currentProvider === 'chatgpt' ? '浏览器授权' : 'API 连接'}</strong>{currentProvider === 'ollama' && <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => configure('ollama')}>配置连接</Button>}<p>每个模型的上下文与生成参数独立保存。</p>{currentProvider === 'chatgpt' && !dialog && <ChatgptAuthorization onChange={onChange} />}</div>
          {currentProvider === 'openrouter' && <div className="openrouter-connection"><span className="hint">API Key {openrouterConnection?.hasApiKey ? '已加密保存 · 所有模型共用' : '未配置'}</span><Button size="sm" variant="ghost" disabled={isBusy} onClick={() => configure('openrouter')}>配置连接</Button><Button size="sm" variant="outline" disabled={isBusy} onClick={() => connectOpenrouter(true)}><RefreshCw size={14} />刷新模型</Button></div>}
          <div className="provider-model-toolbar"><div><h4>模型 <span>{shownModelCount}</span></h4><p>启用需要的模型，默认模型可在通用设置中选择。</p></div>{currentProvider === 'ollama' && <Button size="sm" variant="outline" disabled={isBusy} onClick={() => connectOllama(currentOllamaUrl)}><RefreshCw size={14} />刷新模型</Button>}</div>
          <div className="search-field provider-model-search"><Search size={15} /><Input aria-label="搜索模型" placeholder="搜索模型名称或 ID" value={query} onChange={event => setQuery(event.target.value)} /></div>
          {currentProvider === 'openrouter' ? <><p className="hint">展示所有支持文字输出和工具调用的模型。已启用模型按名称排序，未启用模型按厂商分组，默认收起。</p><OpenrouterCatalog settings={settings} query={query} busy={isBusy} getThinkingLabel={modelThinkingLabel} onConfigure={item => configure('openrouter', item)} onToggle={toggleModel} /></> : <><PagedList items={filteredModels} label="供应商模型" resetKey={`${currentProvider}:${query}`}>{page => <ul className="provider-model-list">{page.map(item => { const thinking = modelThinkingLabel(item); return <li key={item.id}>
            <ProviderIcon provider={item.provider} model={item.model} /><div className="provider-model-name model-priced-name" title={item.available === false ? `${item.name}（当前不可用）` : item.enabled === false ? `${item.name}（已停用）` : item.name}><strong>{item.name}{item.available === false ? ' · 当前不可用' : ''}</strong><ModelPriceTag descriptor={descriptors.get(`${item.provider}:${item.model}`)} /></div>
            <div className="provider-model-actions">{thinking && <Tooltip><TooltipTrigger asChild><span className="provider-model-thinking">{thinking}</span></TooltipTrigger><TooltipContent>当前推理强度：{thinking}</TooltipContent></Tooltip>}<Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={isBusy ? 0 : undefined}><Button size="icon" variant="ghost" disabled={isBusy} aria-label={`配置 ${item.name}`} onClick={() => configure(item.provider, item)}><SlidersHorizontal size={16} /></Button></span></TooltipTrigger><TooltipContent>模型高级设置</TooltipContent></Tooltip>
              <Switch aria-label={`启用 ${item.name}`} checked={item.enabled !== false} disabled={isBusy || item.available === false} onCheckedChange={() => toggleModel(item)} /></div>
          </li> })}</ul>}</PagedList>
          {!filteredModels.length && <p className="provider-no-results">{query ? '没有匹配的模型，请尝试其他关键词。' : currentProvider === 'ollama' ? '本地还没有模型。请使用 ollama pull 下载模型，再点击“刷新模型”。' : '暂无模型。'}</p>}
          </>}
        </> : <div className="provider-empty"><Cpu size={30} /><h3>添加你的第一个模型供应商</h3><p>连接 ChatGPT 订阅、OpenRouter 或本地 Ollama 模型。</p><Button variant="outline" onClick={() => { setEditing(false); setDialog('choose'); setProviderQuery('') }}><Plus size={16} />添加供应商</Button></div>}
      </div>
    </div>
    {!dialog && feedback}
    <Modal open={dialog !== null} onOpenChange={open => { if (!open && !isBusy) setDialog(null) }} closeLabel="关闭供应商配置" closeDisabled={isBusy}
      contentClassName={`provider-dialog${editing ? ' model-configuration-dialog' : ''}`}
      title={dialog === 'choose' ? '添加供应商' : editing ? <span className="model-name-with-icon model-priced-name"><span aria-hidden="true"><ModelIcon model={profile.model} provider={profile.provider} size={18} /></span><span className="model-price-name-text">{profile.model}</span><ModelPriceTag descriptor={modelInfo ?? descriptors.get(`${profile.provider}:${profile.model}`)} /></span> : `${providers.includes(profile.provider) ? '连接' : '添加'} · ${providerName(profile.provider)}`}
      headingExtra={!editing && <div className="provider-steps" aria-label="添加进度"><span data-active={dialog === 'choose'}>1 选择供应商</span><ChevronRight size={13} /><span data-active={dialog === 'configure'}>2 配置连接</span></div>}
      onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>('.provider-add')?.focus() }}>
      <div className="provider-dialog-body model-settings">
          {!editing && <p className="provider-dialog-description">{dialog === 'choose' ? '选择要连接的账号、API 或本地服务。' : subscription ? '通过 ChatGPT 订阅账号使用 OpenAI 模型。' : connectingOllama ? '连接本机运行的 Ollama，自动获取已安装的模型。' : connectingOpenrouter ? '输入 OpenRouter API Key，自动读取所有可调用模型。连接后展开厂商分组，配置并启用需要的模型。' : ''}</p>}
          {dialog === 'choose' ? <>
            <div className="search-field"><Search size={15} /><Input aria-label="搜索供应商" placeholder="搜索供应商…" value={providerQuery} onChange={event => setProviderQuery(event.target.value)} /></div>
            <div className="provider-options">{options.map(provider => <Button variant="ghost" key={provider} onClick={() => configure(provider)}><ProviderIcon provider={provider} /><span><strong>{providerName(provider)}</strong><small>{provider === 'chatgpt' ? '浏览器授权 · 支持复制链接' : provider === 'openrouter' ? 'API Key 连接 · 全部可调用模型' : '本地运行，连接 Ollama 服务'}</small></span><ChevronRight size={17} /></Button>)}</div>
            {!options.length && <p className="provider-no-results">没有匹配的供应商。目前支持 ChatGPT、OpenRouter 和 Ollama。</p>}
          </> : subscription ? <div className="provider-subscription"><ChatgptAuthorization onChange={next => { onChange(next); setSelected('chatgpt') }} /></div> : connectingOpenrouter ? <fieldset className="provider-connection-form" disabled={isBusy}>
            <Label>API Key<Input type="password" value={apiKey} autoComplete="off" spellCheck={false} disabled={!settings.encryptionAvailable} placeholder={openrouterConnection?.hasApiKey ? '输入新的 API Key' : '输入 OpenRouter API Key'} onChange={event => setApiKey(event.target.value)} /></Label>
            <p className="hint">密钥加密保存在本机，所有 OpenRouter 模型共用。读取目录不会调用模型。</p>
            {!settings.encryptionAvailable && <p className="error" role="alert">系统安全存储不可用，暂时无法保存 API Key。</p>}
            <Button disabled={!apiKey.trim() || !settings.encryptionAvailable} onClick={() => connectOpenrouter()}>{isBusy ? '正在读取模型…' : openrouterConnection?.hasApiKey ? '更新密钥并读取模型' : '连接并读取模型'}</Button>
          </fieldset> : connectingOllama ? <fieldset className="provider-connection-form" disabled={isBusy}>
            <Label>本地服务地址<Input type="url" value={ollamaUrl} onChange={event => setOllamaUrl(event.target.value)} placeholder="http://localhost:11434" /></Label><p className="hint">请先启动 Ollama。本步骤只读取模型列表，不会下载或运行模型。</p><Button onClick={() => connectOllama(ollamaUrl, true)} disabled={!ollamaUrl.trim()}>连接并获取模型</Button>
          </fieldset> : <fieldset disabled={isBusy && !requestId}>
            <ModelProfileFields profile={profile} savedProfile={saved} settings={settings} modelInfo={modelInfo} infoLoading={infoLoading} apiKey={apiKey} removeKey={removeKey} onFieldChange={update} onApiKeyChange={setApiKey} onRemoveKeyChange={remove => { setRemoveKey(remove); setApiKey('') }}>
              {infoError && <p className="error" role="alert">{infoError} <Button size="sm" variant="ghost" disabled={isBusy || infoLoading} onClick={() => setInfoRevision(value => value + 1)}>重试读取</Button></p>}
              <ModelProfileActions isLocal={profile.provider === 'ollama'} canSave={profileDirty} savedFlash={savedFlash} testStatus={test.status} testMessage={test.message} onCancelTest={() => { if (requestId) void window.piRunner.cancelModelRequest(requestId).then(unwrapModelResult).catch(() => setError('取消请求失败，请重试')) }} onSave={saveProfile} onSaveAndTest={saveAndTest} />
            </ModelProfileFields>
          </fieldset>}
          {feedback}
      </div>
      {(dialog === 'configure' && !editing) && <footer className="provider-dialog-footer"><Button variant="ghost" disabled={isBusy} onClick={() => { setDialog('choose'); setError(''); setNotice('') }}><ArrowLeft size={15} />上一步</Button></footer>}
    </Modal>
  </section>
}
