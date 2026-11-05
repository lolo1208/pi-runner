import { ChevronRight, Globe, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { ModelIcon } from './chat/ModelIcon'
import { ModelPriceTag } from './ModelPriceTag'
import { CountryFlag } from './CountryFlag'
import { callableOpenrouterModels, defaultOpenrouterMaxTokens, OPENROUTER_BASE_URL, openrouterManufacturer, openrouterManufacturerCountry } from '../../../shared/openrouter'
import type { CompatibleConnection, ModelDescriptor, ModelProfileView, ModelSettings } from '../../../shared/models'
import { useRef, useState, type ReactNode } from 'react'
import { PagedList } from './PagedList'
import { compatibleReferencePricing } from '../../../shared/model-pricing'

// 前列参考 OpenRouter 最近完整周的作者请求份额；长尾厂商按常见度维护顺序。
const POPULAR_MANUFACTURERS = [
  'DeepSeek', 'OpenAI', 'Google', '智谱', '通义千问', 'Anthropic', '小米', 'Mistral', 'Tencent',
  '阶跃星辰', 'NVIDIA', 'Meta', 'xAI', '月之暗面', 'MiniMax', '字节跳动', 'Amazon', 'Microsoft',
  'Cohere', 'OpenRouter', 'Fireworks AI', 'AI21', 'IBM', 'Upstage', 'Sakana AI', 'Reka', 'Poolside',
  'Inception', 'Thinking Machines', 'Dots Studio', 'Nex-AGI', 'Aion Labs', 'Perceptron', 'PrismML',
  'Relace', 'TypeSafe AI', 'Unbiased',
]
function compareManufacturers(a: string, b: string): number {
  const aRank = POPULAR_MANUFACTURERS.indexOf(a)
  const bRank = POPULAR_MANUFACTURERS.indexOf(b)
  if (aRank !== bRank) {
    if (aRank < 0) return 1
    if (bRank < 0) return -1
    return aRank - bRank
  }
  return a.localeCompare(b, 'zh-CN')
}

function ManufacturerGroup({ vendor, models, search, children }: { vendor: string; models: ModelDescriptor[]; search: string; children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(Boolean(search))
  return <details className="openrouter-manufacturer" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight size={15} aria-hidden="true" /><div className="openrouter-manufacturer-name"><strong>{vendor}</strong><ManufacturerCountryIndicator modelId={models[0].id} /></div><span aria-label={`${models.length} 个模型`}>{models.length}</span></summary>
    {open && children}
  </details>
}

function ManufacturerCountryIndicator({ modelId }: { modelId: string }): React.JSX.Element {
  const country = openrouterManufacturerCountry(modelId)
  return <span className="openrouter-manufacturer-country" role="img" aria-label={country ? `厂商所属国家：${country.name}` : '厂商所属国家未知'}>{country ? <CountryFlag code={country.code} /> : <><Globe size={14} aria-hidden="true" />?</>}</span>
}

export function OpenrouterCatalog({ settings, query, busy, getThinkingLabel, onConfigure, onToggle, connection, manualAdd, onRemoveManual }: {
  settings: ModelSettings; query: string; busy: boolean; connection?: CompatibleConnection; manualAdd?: ReactNode; onRemoveManual?(model: string): void
  getThinkingLabel(profile: ModelProfileView): string | null
  onConfigure(profile: ModelProfileView): void; onToggle(profile: ModelProfileView): void
}): React.JSX.Element {
  const catalog = connection?.models ?? settings.providers?.find(item => item.provider === 'openrouter')?.models ?? []
  const saved = settings.profiles.filter(item => connection ? item.compatibleConnectionId === connection.id : item.provider === 'openrouter')
  const callable = connection ? catalog : callableOpenrouterModels(catalog)
  const ids = new Set(callable.map(item => item.id))
  const profiles = new Map(saved.map(item => [item.model, item]))
  // 分组只在重新打开供应商列表时重新计算，避免切换开关后模型跳走。
  const initiallyEnabled = useRef(new Set(saved.filter(item => item.enabled !== false).map(item => item.model)))
  // 保留已有配置，服务下架的模型仍可查看和调整。
  const rows: ModelDescriptor[] = [...callable, ...saved.filter(item => !ids.has(item.model)).map(item => catalog.find(model => model.id === item.model) ?? { id: item.model, name: item.name, capabilities: [], maxContextTokens: null })]
  const search = query.trim().toLowerCase()
  const manual: ModelDescriptor[] = []
  const enabled: ModelDescriptor[] = []
  const groups = new Map<string, ModelDescriptor[]>()
  rows.sort((a, b) => (b.name ?? b.id).localeCompare(a.name ?? a.id, 'zh-CN', { numeric: true, sensitivity: 'base' }) || b.id.localeCompare(a.id))
  for (const model of rows) {
    const vendor = openrouterManufacturer(model.id)
    if (search && !`${model.name ?? ''} ${model.id} ${vendor}`.toLowerCase().includes(search)) continue
    if (connection && (profiles.get(model.id)?.manuallyAdded || (profiles.has(model.id) && !ids.has(model.id)))) manual.push(model)
    else if (initiallyEnabled.current.has(model.id)) enabled.push(model)
    else {
      const group = groups.get(vendor) ?? []
      group.push(model)
      groups.set(vendor, group)
    }
  }
  const modelProfile = (model: ModelDescriptor): ModelProfileView => profiles.get(model.id) ?? {
    id: crypto.randomUUID(), name: model.name ?? model.id, provider: connection ? 'custom' : 'openrouter', protocol: 'openai-compatible', baseUrl: connection?.baseUrl ?? OPENROUTER_BASE_URL,
    ...(connection ? { compatibleConnectionId: connection.id, compatibleApi: connection.compatibleApi } : { autoMaxTokens: true }),
    model: model.id, temperature: null, contextTokens: null, maxTokens: connection ? 2048 : defaultOpenrouterMaxTokens(model),
    tokenParameter: 'max_tokens', timeoutSeconds: connection ? 60 : 120, enabled: false, hasApiKey: Boolean(connection ? connection.hasApiKey : settings.providers?.find(item => item.provider === 'openrouter')?.hasApiKey), available: true,
  }
  const renderModels = (models: ModelDescriptor[], label: string, removable = false): React.JSX.Element => <PagedList items={models} label={label} resetKey={search}>{page => <ul className="provider-model-list">{page.map(model => {
        const profile = modelProfile(model)
        const thinking = getThinkingLabel(profile)
        return <li key={model.id}>
          <span className="provider-icon" aria-hidden="true"><ModelIcon provider={connection ? 'custom' : 'openrouter'} model={model.id} size={19} /></span>
          <div className="provider-model-name model-priced-name" title={profile.available === false ? `${model.name ?? model.id}（当前不可用）` : profile.enabled === false ? `${model.name ?? model.id}（已停用）` : model.name ?? model.id}><strong>{model.name ?? model.id}{profile.available === false ? ' · 当前不可用' : ''}</strong><ModelPriceTag descriptor={connection ? { ...model, pricing: model.pricing ?? (/^https:\/\/api\.siliconflow\.(?:cn|com)\/v1\/?$/.test(connection.baseUrl) ? undefined : compatibleReferencePricing(model.id)) } : model} /></div>
          <div className="provider-model-actions">{thinking && <Tooltip><TooltipTrigger asChild><span className="provider-model-thinking">{thinking}</span></TooltipTrigger><TooltipContent>当前推理强度：{thinking}</TooltipContent></Tooltip>}{removable && onRemoveManual && <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={busy ? 0 : undefined}><Button size="icon" variant="ghost" className="compatible-remove-connection" disabled={busy} aria-label={`移除 ${model.name ?? model.id}`} onClick={() => onRemoveManual(model.id)}><Trash2 size={16} aria-hidden="true" /></Button></span></TooltipTrigger><TooltipContent>移除模型</TooltipContent></Tooltip>}<Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={busy ? 0 : undefined}><Button size="icon" variant="ghost" disabled={busy} aria-label={`配置 ${model.name ?? model.id}`} onClick={() => onConfigure(profile)}><SlidersHorizontal size={16} /></Button></span></TooltipTrigger><TooltipContent>模型高级设置</TooltipContent></Tooltip>
            <Switch aria-label={`启用 ${model.name ?? model.id}`} checked={profile.enabled !== false} disabled={busy || profile.available === false} onCheckedChange={() => onToggle(profile)} /></div>
        </li>
      })}</ul>}</PagedList>
  return <div className="openrouter-catalog">
    <section aria-label="已启用模型">
      <h5 className="openrouter-section-heading">已启用 <span>{enabled.length}</span></h5>
      {enabled.length ? renderModels(enabled, '已启用模型') : <p className="hint">{search ? '没有匹配的已启用模型。' : '尚未启用模型，可在下方展开厂商并启用。'}</p>}
    </section>
    <section aria-label="未启用模型">
      <h5 className="openrouter-section-heading">未启用 <span>{[...groups.values()].reduce((count, models) => count + models.length, 0)}</span></h5>
      {(manual.length > 0 || manualAdd) && <details className="openrouter-manufacturer" open={Boolean(search) || undefined} key={`manual:${Boolean(search)}`}>
        <summary><ChevronRight size={15} aria-hidden="true" /><div className="openrouter-manufacturer-name"><strong>手动添加</strong></div><span aria-label={`${manual.length} 个模型`}>{manual.length}</span></summary>
        {manual.length > 0 && renderModels(manual, '手动添加的模型', true)}
        {manualAdd}
      </details>}
      {[...groups].sort(([a], [b]) => compareManufacturers(a, b)).map(([vendor, models]) => <ManufacturerGroup vendor={vendor} models={models} search={search} key={`${vendor}:${Boolean(search)}`}>
        {renderModels(models, `${vendor} 未启用模型`)}
      </ManufacturerGroup>)}
    </section>
    {!manual.length && !enabled.length && !groups.size && <p className="provider-no-results">{search ? '没有匹配的模型，请尝试其他关键词。' : '暂无可调用的模型，请刷新目录重试。'}</p>}
  </div>
}
