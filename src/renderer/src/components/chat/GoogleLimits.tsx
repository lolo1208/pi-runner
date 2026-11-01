import { Tooltip } from 'radix-ui'
import { Button } from '@/components/ui/button'
import type { ModelReply } from '../../../../shared/models'
import { LatestRound } from './LatestRound'

const tokens = (value: number): string => value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : value.toLocaleString('zh-CN')

export function GoogleLimits({ latestReply, contextLimit }: { latestReply?: ModelReply; contextLimit?: number | null }): React.JSX.Element | null {
  const usage = latestReply?.roundUsage ?? latestReply?.usage
  if (!usage) return null
  const summary = `本轮 ${tokens(usage.inputTokens + usage.outputTokens)} tokens`
  return <Tooltip.Root><Tooltip.Trigger asChild>
    <Button type="button" variant="ghost" className="composer-limits" aria-label="Google 本轮用量">{summary}</Button>
  </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="composer-status-tooltip subscription-tooltip" side="top" align="end" sideOffset={8} collisionPadding={12}>
    <strong>Google 本轮用量</strong>
    <dl className="subscription-facts">
      <div><dt>上下文上限</dt><dd>{contextLimit ? `${contextLimit.toLocaleString('zh-CN')} tokens` : '模型目录未提供'}</dd></div>
      <div><dt>计费方式</dt><dd>按输入、输出 Token 计费</dd></div>
    </dl>
    <LatestRound reply={latestReply} />
  </Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}
