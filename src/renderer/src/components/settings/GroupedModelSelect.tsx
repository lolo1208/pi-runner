import { useId, useState } from 'react'
import { Popover } from 'radix-ui'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { findModelDescriptor, PROVIDER_PRESETS, type ModelProfileView, type ModelProviderConnection } from '../../../../shared/models'
import { ModelIcon } from '../chat/ModelIcon'
import { ModelPriceTag } from '../ModelPriceTag'

export function GroupedModelSelect({ label, value, placeholder, disabled, profiles, providers, choices = [], onChange }: {
  label: string; value: string; placeholder: string; disabled?: boolean
  profiles: ModelProfileView[]; providers?: ModelProviderConnection[]
  choices?: { value: string; label: string }[]; onChange(value: string): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const id = useId()
  const selected = profiles.find(item => item.id === value)
  const selectedChoice = choices.find(item => item.value === value)
  const groups = [...new Set(profiles.map(item => item.provider))].map(provider => ({
    provider, label: PROVIDER_PRESETS.find(item => item.id === provider)?.label ?? provider,
    models: profiles.filter(item => item.provider === provider)
  }))
  const choose = (next: string): void => { setOpen(false); onChange(next) }
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button type="button" aria-label={label} disabled={disabled} className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50">
      <span className="flex min-w-0 flex-1 items-center gap-2 text-left">{selected && <span className="shrink-0" aria-hidden="true"><ModelIcon model={selected.model} provider={selected.provider} size={16} /></span>}<span className="min-w-0 truncate">{selected ? `${selected.name} · ${PROVIDER_PRESETS.find(item => item.id === selected.provider)?.label ?? selected.provider}` : selectedChoice?.label ?? placeholder}</span></span><ChevronDown size={16} className="shrink-0" />
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={4} className="grouped-model-select-content z-50 max-h-[var(--radix-popover-content-available-height)] min-w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-16px)] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text)] shadow-md">
      {choices.map(choice => <Button key={choice.value} type="button" variant="ghost" className="flex h-auto w-full justify-start gap-2 px-2 py-1.5 text-left text-sm font-normal" onClick={() => choose(choice.value)}><span className="w-4 shrink-0">{value === choice.value && <Check size={14} />}</span>{choice.label}</Button>)}
      {groups.map(group => <section key={group.provider} aria-label={group.label}>
        <Button type="button" variant="ghost" className="conversation-model-group-toggle" aria-expanded={!collapsed[group.provider]} aria-controls={`${id}-${group.provider}`} onClick={() => setCollapsed(current => ({ ...current, [group.provider]: !current[group.provider] }))}><span>{group.label}</span>{collapsed[group.provider] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</Button>
        <div id={`${id}-${group.provider}`} hidden={!!collapsed[group.provider]}>{group.models.map(model => <Button key={model.id} type="button" variant="ghost" className="flex h-auto w-full justify-start gap-2 px-2 py-1.5 text-left text-sm font-normal" aria-pressed={value === model.id} onClick={() => choose(model.id)}><span className="w-4 shrink-0">{value === model.id && <Check size={14} />}</span><ModelIcon model={model.model} provider={model.provider} /><span className="model-priced-name min-w-0"><span className="model-price-name-text">{model.name}</span><ModelPriceTag descriptor={findModelDescriptor(providers, model)} /></span></Button>)}</div>
      </section>)}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
