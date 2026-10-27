import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CircleCheck, CircleX, PlugZap, Square } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type TestStatus = 'idle' | 'running' | 'success' | 'failure'

interface ModelProfileActionsProps {
  canSave?: boolean
  savedFlash?: boolean
  testStatus?: TestStatus
  testMessage?: string
  onCancelTest?: () => void
  onSave: () => void
  onSaveAndTest: () => void
  isLocal?: boolean
}

const TEST_HINT = { local: '测试连接：发送一条短消息，加载本地模型并占用计算资源。', remote: '测试连接：发送一条短消息，可能产生服务端费用。' }

export function ModelProfileActions({ canSave = true, savedFlash = false, testStatus = 'idle', testMessage, onCancelTest, onSave, onSaveAndTest, isLocal }: ModelProfileActionsProps): React.JSX.Element {
  const hint = testStatus === 'running' ? '正在测试连接…'
    : testStatus === 'success' || testStatus === 'failure' ? testMessage ?? ''
      : isLocal ? TEST_HINT.local : TEST_HINT.remote
  return <div className="model-profile-actions">
    <Separator />
    <div className="model-profile-actions-buttons">
      {testStatus === 'running' && <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="model-test-stop" aria-label="终止测试" onClick={onCancelTest}><Square size={14} /></Button></TooltipTrigger><TooltipContent>终止测试</TooltipContent></Tooltip>}
      {testStatus === 'idle' && <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" aria-label="测试连接" onClick={onSaveAndTest}><PlugZap size={17} /></Button></TooltipTrigger><TooltipContent>测试连接</TooltipContent></Tooltip>}
      {testStatus === 'success' && <Tooltip><TooltipTrigger asChild><span className="test-status success" role="status" aria-label="连接成功"><CircleCheck size={17} /></span></TooltipTrigger><TooltipContent>连接成功</TooltipContent></Tooltip>}
      {testStatus === 'failure' && <Tooltip><TooltipTrigger asChild><span className="test-status failure" role="status" aria-label="连接失败"><CircleX size={17} /></span></TooltipTrigger><TooltipContent>连接失败</TooltipContent></Tooltip>}
      <p className={`hint test-hint${testStatus === 'success' ? ' test-success' : testStatus === 'failure' ? ' test-failure' : ''}`} aria-live="polite">{hint}</p>
    </div>
    <div className="model-profile-actions-save"><Button className="primary" disabled={!canSave} onClick={onSave}>保存配置</Button>{savedFlash && <span aria-live="polite" className="saved-flash">已保存</span>}</div>
  </div>
}
