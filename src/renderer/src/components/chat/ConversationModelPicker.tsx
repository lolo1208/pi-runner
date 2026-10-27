import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Popover, Tooltip as TooltipPrimitive } from 'radix-ui'
import { ChevronDown, ChevronRight, Eye, Search, Settings2 } from 'lucide-react'
import { ModelIcon } from './ModelIcon'
import { ModelPriceTag } from '../ModelPriceTag'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { PagedList } from '../PagedList'
import { findModelDescriptor, PROVIDER_PRESETS, selectedModelThinking, thinkingLabel, tokenCountLabel, type ModelProfileView, type ModelProviderConnection } from '../../../../shared/models'

function ModelName({ text, className }: { text: string; className: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  const [open, setOpen] = useState(false)
  const measure = (): void => {
    const element = ref.current
    const clipped = Boolean(element && element.clientWidth > 0 && element.scrollWidth > element.clientWidth)
    setTruncated(clipped)
    if (!clipped) setOpen(false)
  }
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [text, className])
  return <TooltipPrimitive.Root open={truncated && open} onOpenChange={setOpen}>
    <TooltipPrimitive.Trigger asChild><span ref={ref} className={className} onPointerEnter={measure} onFocus={measure} tabIndex={truncated ? 0 : undefined}>{text}</span></TooltipPrimitive.Trigger>
    {truncated && <TooltipPrimitive.Portal><TooltipPrimitive.Content className="conversation-model-name-tooltip" side="top" sideOffset={6} collisionPadding={12}>{text}</TooltipPrimitive.Content></TooltipPrimitive.Portal>}
  </TooltipPrimitive.Root>
}

interface Props {
  profile?: ModelProfileView
  profiles: ModelProfileView[]
  /** 供应商目录，用于显示上下文与推理档位；缺失时相关标记隐藏。 */
  providers?: ModelProviderConnection[]
  disabled?: boolean
  onSelect(id: string): void
  /** 快捷修改当前模型的推理档位；由上层负责持久化并回传新的设置。 */
  onThinkingChange?(profile: ModelProfileView, value: boolean | string | null): Promise<void> | void
  onOpenSettings(): void
}

export function ConversationModelPicker({ profile, profiles, providers, disabled, onSelect, onThinkingChange, onOpenSettings }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const groupId = useId()
  const [thinkingSaving, setThinkingSaving] = useState(false)
  const enabledProfiles = profiles.filter(item => item.enabled !== false)
  const search = query.trim().toLocaleLowerCase()
  const filtered = enabledProfiles.filter(item => `${item.name} ${item.model} ${PROVIDER_PRESETS.find(preset => preset.id === item.provider)?.label ?? ''}`.toLocaleLowerCase().includes(search))
  const groups = PROVIDER_PRESETS.map(preset => ({ preset, models: filtered.filter(model => model.provider === preset.id) })).filter(group => group.models.length > 0)
  const close = (): void => setOpen(false)
  const descriptor = profile ? findModelDescriptor(providers, profile) : undefined
  const thinkingOptions = (descriptor?.thinking?.values ?? []).map(value => ({ key: `${typeof value === 'boolean' ? 'boolean' : 'level'}:${value}`, label: thinkingLabel(value) ?? String(value), raw: value }))
  const configuredThinking = profile ? selectedModelThinking(profile, descriptor?.thinking) : null
  const selectedThinkingKey = thinkingOptions.find(option => option.raw === configuredThinking)?.key
  const showThinking = thinkingOptions.some(option => option.raw !== false && option.raw !== 'off')
  const configuredThinkingLabel = thinkingLabel(configuredThinking)

  const changeThinking = async (value: boolean | string | null): Promise<void> => {
    if (!profile || !onThinkingChange || thinkingSaving) return
    setThinkingSaving(true)
    try { await onThinkingChange(profile, value) }
    finally { setThinkingSaving(false) }
  }

  return <Popover.Root open={open && !disabled} onOpenChange={next => {
    setOpen(next)
    if (next) setQuery('')
  }}>
    <Tooltip><TooltipTrigger asChild><Popover.Trigger asChild>
      <Button type="button" className="model-picker" disabled={disabled} aria-label={`切换模型：${profile?.model || '选择模型'}`}>
        <ModelIcon model={profile?.model} provider={profile?.provider} size={14} /><span className="model-price-name-text">{profile?.model || '选择模型'}</span>
        {profile && <ModelPriceTag descriptor={descriptor} />}
        {showThinking && configuredThinkingLabel && <span className="model-picker-thinking">· {configuredThinkingLabel}</span>}
        <ChevronDown size={14} />
      </Button>
    </Popover.Trigger></TooltipTrigger><TooltipContent side="top" sideOffset={6}>切换本次会话的模型，并可在此设置推理强度</TooltipContent></Tooltip>
    <Popover.Portal>
      <Popover.Content className="conversation-model-picker" side="top" align="end" sideOffset={10} collisionPadding={12} aria-label="本次会话模型" onOpenAutoFocus={event => event.preventDefault()}>
        <div className="conversation-model-search">
          <Search size={16} aria-hidden="true" />
          <input aria-label="搜索会话模型" placeholder="搜索模型" value={query} onChange={event => setQuery(event.target.value)} />
          <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="conversation-model-config" aria-label="配置模型" onClick={() => { close(); onOpenSettings() }}><Settings2 size={16} /></Button></TooltipTrigger><TooltipContent side="top" sideOffset={6}>打开模型设置</TooltipContent></Tooltip>
        </div>
        <div className="conversation-model-list">
          {groups.map(({ preset, models }) => {
            const expanded = !collapsedGroups[preset.id]
            const modelsId = `${groupId}-${preset.id}`
            return <section key={preset.id} aria-label={preset.label}>
              <h2><Button type="button" variant="ghost" className="conversation-model-group-toggle" aria-expanded={expanded} aria-controls={modelsId} onClick={() => setCollapsedGroups(current => ({ ...current, [preset.id]: !current[preset.id] }))}>
                <span>{preset.label}</span>
                {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              </Button></h2>
              <div id={modelsId} hidden={!expanded}>
                {expanded && <PagedList items={models} label={preset.label} resetKey={search}>{page => page.map(model => {
                  const info = findModelDescriptor(providers, model)
                  const context = tokenCountLabel(info?.maxContextTokens ?? model.contextTokens)
                  const modelThinking = thinkingLabel(selectedModelThinking(model, info?.thinking))
                  return <Button type="button" variant="ghost" className="conversation-model-option" key={model.id} aria-label={`使用 ${model.name}`} aria-current={model.id === profile?.id || undefined} disabled={model.available === false} onClick={() => {
                    if (model.id === profile?.id) close()
                    else onSelect(model.id)
                  }} onDoubleClick={close}>
                    <ModelIcon model={model.model} provider={model.provider} size={16} />
                    <span className="conversation-model-priced-name"><ModelName className={model.id === profile?.id ? 'conversation-model-name is-current' : 'conversation-model-name'} text={`${model.name}${model.available === false ? ' · 当前不可用' : ''}`} /><ModelPriceTag descriptor={info} /></span>
                    <span className="conversation-model-meta">
                      {modelThinking && <Tooltip><TooltipTrigger asChild><span>{modelThinking}</span></TooltipTrigger><TooltipContent>推理强度：{modelThinking}</TooltipContent></Tooltip>}
                      {info?.capabilities.includes('vision') && <Tooltip><TooltipTrigger asChild><span><Eye size={13} aria-hidden="true" /></span></TooltipTrigger><TooltipContent>支持图片输入</TooltipContent></Tooltip>}
                      {context && <Tooltip><TooltipTrigger asChild><span>{context}</span></TooltipTrigger><TooltipContent>上下文上限 {info?.maxContextTokens ?? model.contextTokens} Token</TooltipContent></Tooltip>}
                    </span>
                  </Button>
                })}</PagedList>}
              </div>
            </section>
          })}
          {!filtered.length && <p className="conversation-model-empty">{enabledProfiles.length ? '没有找到匹配的模型，请尝试其他名称。' : profiles.length ? '暂无已启用的模型，请先在模型设置中启用。' : '尚未配置模型，请先添加供应商。'}</p>}
        </div>
        <footer className="conversation-model-reasoning" aria-busy={thinkingSaving}>
          {!profile ? <p className="conversation-model-reasoning-hint">请先选择一个模型。</p>
            : showThinking ? <>
              <div className="conversation-model-reasoning-head"><span>推理强度</span><strong className="model-priced-name"><ModelName className="model-price-name-text" text={profile.name} /><ModelPriceTag descriptor={descriptor} /></strong></div>
              <RadioGroup className="conversation-model-thinking" aria-label={`${profile.name} 推理强度`} value={selectedThinkingKey} disabled={thinkingSaving || !onThinkingChange} onValueChange={value => {
                const raw = thinkingOptions.find(option => option.key === value)?.raw
                if (raw !== undefined) void changeThinking(raw)
              }}>
                {thinkingOptions.map(option => <RadioGroupItem key={option.key} variant="segmented" className="conversation-model-thinking-option" value={option.key}>{option.label}</RadioGroupItem>)}
              </RadioGroup>
            </>
            : <p className="conversation-model-reasoning-hint">{providers?.length ? `${profile.name} 未提供可调整的推理强度。` : `${profile.name} 的模型信息尚未读取，请在模型设置中刷新列表。`}</p>}
        </footer>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
