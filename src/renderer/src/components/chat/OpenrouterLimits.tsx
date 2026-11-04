import { Tooltip } from 'radix-ui'
import { Button } from '@/components/ui/button'
import type { ModelReply, OpenrouterUsage } from '../../../../shared/models'
import { LatestRound } from './LatestRound'

const dollars = (value: number): string => `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`

export function OpenrouterLimits({ model, usage, latestReply, onDetails }: { model: string; usage?: OpenrouterUsage; latestReply?: ModelReply; onDetails(): void }): React.JSX.Element {
  const free = model.endsWith(':free') || model === 'openrouter/free'
  const daily = usage?.freeDaily
  const summary = usage?.error ? '额度：未知' : !usage ? '正在读取额度…' : free
    ? daily ? `今日剩余 ${daily.remaining.toLocaleString('zh-CN')} 次` : '今日剩余：未知'
    : typeof usage.remaining === 'number' ? `密钥剩余 ${dollars(usage.remaining)}` : usage.limit === null ? '密钥未设金额上限' : '密钥额度：未知'
  const exhausted = free ? daily?.remaining === 0 : usage?.remaining === 0
  return <Tooltip.Root><Tooltip.Trigger asChild>
    <Button type="button" variant="ghost" className={`composer-limits${exhausted ? ' context-warning' : ''}`} aria-label="OpenRouter 使用额度">{summary}</Button>
  </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="composer-status-tooltip subscription-tooltip" side="top" align="end" sideOffset={8} collisionPadding={12}>
    <strong>OpenRouter 使用额度</strong>
    {free ? <>
      <div>{daily ? `今日已用 ${daily.used.toLocaleString('zh-CN')} / ${daily.limit.toLocaleString('zh-CN')} 次，剩余 ${daily.remaining.toLocaleString('zh-CN')} 次` : '服务尚未提供今日免费请求次数。'}</div>
      <div>免费次数由账号共享，每日 00:00 UTC（北京时间 08:00）重置。</div>
      <div>部分账号或路由不受此上限约束；上游服务仍可能限流。</div>
    </> : <>
      <div>密钥金额上限：{typeof usage?.limit === 'number' ? dollars(usage.limit) : usage?.limit === null ? '未设置' : '未知'}</div>
      <div>密钥剩余额度：{typeof usage?.remaining === 'number' ? dollars(usage.remaining) : usage?.remaining === null ? '未设上限' : '未知'}</div>
      <div>今日消费：{typeof usage?.dailySpend === 'number' ? dollars(usage.dailySpend) : '未知'}</div>
      <div>金额由此密钥下的模型共享。密钥额度不代表账户余额，其他预算也可能限制调用。</div>
    </>}
    <LatestRound reply={latestReply} onDetails={onDetails} />
    <div className={`subscription-footer${usage?.error ? ' subscription-warning' : ''}`}>{usage?.error ?? (usage?.fetchedAt ? `更新于 ${new Date(usage.fetchedAt).toLocaleTimeString('zh-CN')}` : '正在读取额度…')}</div>
  </Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}
