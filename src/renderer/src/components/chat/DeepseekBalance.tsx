import { Tooltip } from 'radix-ui'
import { Button } from '@/components/ui/button'
import type { DeepseekBalance as Balance, ModelReply } from '../../../../shared/models'
import { LatestRound } from './LatestRound'

const format = (currency: string, amount: string): string => `${currency} ${amount}`

export function DeepseekBalance({ balance, latestReply, onDetails }: { balance?: Balance; latestReply?: ModelReply; onDetails(): void }): React.JSX.Element {
  const entries = balance?.balances ?? []
  const summary = balance?.error ? '余额：未知' : !balance ? '正在读取余额…' : entries.length ? `余额 ${entries.map(item => format(item.currency, item.total)).join(' / ')}` : '余额：未知'
  return <Tooltip.Root><Tooltip.Trigger asChild>
    <Button type="button" variant="ghost" className={`composer-limits${balance?.available === false ? ' context-warning' : ''}`} aria-label={`DeepSeek 账户${summary}`}>{summary}</Button>
  </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="composer-status-tooltip subscription-tooltip" side="top" align="end" sideOffset={8} collisionPadding={12}>
    <strong>DeepSeek 账户余额</strong>
    {entries.map(item => <div key={item.currency}>
      <div>总余额：{format(item.currency, item.total)}</div>
      <div>赠金余额：{format(item.currency, item.granted)}</div>
      <div>充值余额：{format(item.currency, item.toppedUp)}</div>
    </div>)}
    {balance?.available === false && <div className="subscription-warning">账户余额不足，可能无法调用 API。</div>}
    <div>账户余额由 DeepSeek 模型共享，不代表请求速率限制。</div>
    <LatestRound reply={latestReply} onDetails={onDetails} />
    <div className={`subscription-footer${balance?.error ? ' subscription-warning' : ''}`}>{balance?.error ?? (balance?.fetchedAt ? `更新于 ${new Date(balance.fetchedAt).toLocaleTimeString('zh-CN')}` : '正在读取余额…')}</div>
  </Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}
