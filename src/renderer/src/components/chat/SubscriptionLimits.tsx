import { useEffect, useState } from 'react'
import { Tooltip } from 'radix-ui'
import { Button } from '@/components/ui/button'
import type { ChatgptUsage, ModelReply } from '../../../../shared/models'
import { LatestRound } from './LatestRound'

export function resetCountdown(resetsAt: number | undefined, now: number): string {
  if (!resetsAt || !Number.isFinite(resetsAt)) return '重置时间暂未提供'
  const remaining = resetsAt * 1000 - now
  if (remaining <= 0) return '已到重置时间，等待更新'
  if (remaining < 60000) return '不到 1 分钟后重置'
  const minutes = Math.ceil(remaining / 60000)
  const parts = [
    Math.floor(minutes / 1440) ? `${Math.floor(minutes / 1440)} 天` : '',
    Math.floor(minutes % 1440 / 60) ? `${Math.floor(minutes % 1440 / 60)} 小时` : '',
    minutes % 60 ? `${minutes % 60} 分钟` : ''
  ].filter(Boolean)
  return `${parts.join(' ')}后重置`
}

/** 右下角按钮上的剩余时间：向上取整，例如还剩 2.1 小时显示为“3 小时”。 */
export function remainingWindowLabel(item: { resetsAt?: number } | undefined, unit: '小时' | '天', now: number): string {
  if (!item?.resetsAt || !Number.isFinite(item.resetsAt)) return ''
  const remainingMs = item.resetsAt * 1000 - now
  if (remainingMs <= 0) return '即将重置'
  const minutes = Math.ceil(remainingMs / 60000)
  // 7 天窗口在剩余不足 2 天时也改用小时显示，避免出现“0 天”。
  return unit === '天' && minutes >= 1440 * 2 ? `${Math.ceil(minutes / 1440)} 天` : `${Math.ceil(minutes / 60)} 小时`
}

export function SubscriptionLimits({ usage, latestReply }: { usage?: ChatgptUsage; latestReply?: ModelReply }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    // 按钮上的剩余时间需要持续刷新：气泡打开时按秒刷新，否则每 30 秒刷新一次。
    const timer = window.setInterval(() => setNow(Date.now()), open ? 1000 : 30000)
    return () => window.clearInterval(timer)
  }, [open])
  const windows = [{ seconds: 18000, label: '5 小时', unit: '小时' as const }, { seconds: 604800, label: '7 天', unit: '天' as const }]
  return <Tooltip.Root open={open} onOpenChange={value => { setNow(Date.now()); setOpen(value) }}><Tooltip.Trigger asChild><Button type="button" variant="ghost" className="composer-limits" aria-label="ChatGPT 订阅使用限制">
    {windows.map(({ seconds, unit }) => { const item = usage?.windows.find(window => window.seconds === seconds); const remaining = remainingWindowLabel(item, unit, Date.now()); return <span key={seconds} className={item && item.usedPercent >= 90 ? 'context-warning' : undefined}>{remaining ? `${remaining} 剩余${Math.max(0, Math.floor(100 - item!.usedPercent))}%` : '剩余未知'}</span> })}
  </Button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="composer-status-tooltip subscription-tooltip" side="top" align="end" sideOffset={8} collisionPadding={12}>
    <div className="subscription-tooltip-heading"><strong>ChatGPT 订阅额度</strong>{usage?.plan && <span className="subscription-plan">{usage.plan}</span>}</div>
    <div className="subscription-windows">{windows.map(({ seconds, label }) => {
      const item = usage?.windows.find(window => window.seconds === seconds)
      const used = item ? Math.min(100, Math.max(0, item.usedPercent)) : null
      return <div className="subscription-window" key={seconds}>
        <div className="subscription-window-heading"><span>{label}额度</span><span className={used !== null && used >= 90 ? 'subscription-warning' : undefined}>{used !== null ? `已用 ${used}%` : '暂无数据'}</span></div>
        {used !== null && <div className="subscription-meter" aria-hidden="true"><div className={used >= 90 ? 'subscription-meter-warning' : undefined} style={{ width: `${used}%` }} /></div>}
        <div className="subscription-reset">{item ? resetCountdown(item.resetsAt, now) : '服务尚未提供此窗口的额度'}</div>
      </div>
    })}</div>
    <dl className="subscription-facts subscription-reset-facts">
      <div><dt>可用重置</dt><dd>{usage?.resetCredits ? `${usage.resetCredits.availableCount} 次` : usage?.resetCreditsError ? '读取失败' : '暂未提供'}</dd></div>
      <div><dt>最早过期</dt><dd>{usage?.resetCredits?.availableCount === 0 ? '无可用重置' : usage?.resetCredits?.earliestExpiresAt
        ? new Date(usage.resetCredits.earliestExpiresAt).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
        : usage?.resetCredits?.earliestExpiresAt === null ? '不过期' : usage?.resetCreditsError ? '读取失败，将自动重试' : '暂未提供'}</dd></div>
    </dl>
    <LatestRound reply={latestReply} />
    <div className={`subscription-footer${usage?.error ? ' subscription-warning' : ''}`}>{usage?.error ?? (usage?.fetchedAt ? `更新于 ${new Date(usage.fetchedAt).toLocaleTimeString('zh-CN')}` : '正在读取订阅额度…')}</div>
  </Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}
