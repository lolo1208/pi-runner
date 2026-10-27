import { ListTodo, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { IntentMode } from '../../../../shared/models'

// 目的模式：在计划与执行之间循环切换；执行即当前默认任务模式，计划的完整行为后续实现
const intentModes = [
  { value: 'plan' as const, label: '计划', icon: ListTodo },
  { value: 'execute' as const, label: '执行', icon: Play }
]

export function IntentModePicker({ mode, onChange, disabled }: { mode: IntentMode; onChange?: (mode: IntentMode) => void; disabled?: boolean }): React.JSX.Element {
  const selected = intentModes.find(item => item.value === mode) ?? intentModes[1]
  const Icon = selected.icon
  return <Tooltip>
    <TooltipTrigger asChild><Button
      type="button"
      variant="ghost"
      className={`intent-mode-trigger intent-${selected.value}`}
      disabled={disabled}
      aria-label={`目的模式：${selected.label}，点击切换`}
      onClick={() => onChange?.(intentModes[(intentModes.findIndex(item => item.value === selected.value) + 1) % intentModes.length].value)}
    >
      <Icon size={14} /><span>{selected.label}</span>
    </Button></TooltipTrigger>
    <TooltipContent side="top">目的模式：{selected.label}</TooltipContent>
  </Tooltip>
}
