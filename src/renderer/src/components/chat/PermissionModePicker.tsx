import { useState } from 'react'
import { DropdownMenu, Tooltip as TooltipPrimitive } from 'radix-ui'
import { Check, ChevronDown, ShieldQuestion, ShieldCheck, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PermissionMode } from '../../../../shared/models'

const modes = [
  { value: 'default' as const, label: '每次询问', icon: ShieldQuestion, description: '项目内读取直接执行；修改文件、执行命令或读取项目外文件前逐次询问。' },
  { value: 'auto' as const, label: '项目自审', icon: ShieldCheck, description: '可读取除凭证目录（如存放 SSH 密钥）以外的所有文件；项目和临时目录内可写；其他操作先由规则审核，无法判定时交由 AI 审核，仍无法确定时询问用户。' },
  { value: 'full' as const, label: '完全访问', icon: ShieldAlert, description: '按当前用户权限读写文件、执行命令和联网，无需逐次批准。' }
]

export function PermissionModePicker({ mode, disabled, onChange }: { mode: PermissionMode; disabled?: boolean; onChange(mode: PermissionMode): Promise<void> }): React.JSX.Element {
  const [changing, setChanging] = useState(false)
  const selected = modes.find(item => item.value === mode) ?? modes[0]
  const Icon = selected.icon
  return <DropdownMenu.Root>
    <Tooltip><TooltipTrigger asChild><DropdownMenu.Trigger asChild><Button type="button" variant="ghost" className={`permission-mode-trigger permission-${mode}`} disabled={disabled || changing} aria-label={`权限模式：${selected.label}`}>
      <Icon size={14} /><span>{changing ? '正在切换…' : selected.label}</span><ChevronDown size={12} />
    </Button></DropdownMenu.Trigger></TooltipTrigger><TooltipContent side="top" sideOffset={6}>{selected.description}</TooltipContent></Tooltip>
    <DropdownMenu.Portal><DropdownMenu.Content className="permission-mode-menu" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="选择权限模式">
      <DropdownMenu.RadioGroup value={mode} onValueChange={value => {
        if (value === mode || changing || disabled) return
        setChanging(true)
        void onChange(value as PermissionMode).finally(() => setChanging(false))
      }}>
        {modes.map(item => { const ItemIcon = item.icon; return <TooltipPrimitive.Root key={item.value}>
          <TooltipPrimitive.Trigger asChild><DropdownMenu.RadioItem value={item.value} className={`permission-mode-option permission-${item.value}`}>
            <ItemIcon size={17} /><span>{item.label}</span><DropdownMenu.ItemIndicator><Check size={16} /></DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem></TooltipPrimitive.Trigger>
          <TooltipPrimitive.Portal><TooltipPrimitive.Content className="permission-mode-tooltip" side="right" sideOffset={10} collisionPadding={12}>{item.description}</TooltipPrimitive.Content></TooltipPrimitive.Portal>
        </TooltipPrimitive.Root> })}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}
