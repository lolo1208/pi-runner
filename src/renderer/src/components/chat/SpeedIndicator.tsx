import { Tooltip } from 'radix-ui'
import type { OutputSpeed } from '../../../../shared/models'

const compact = (value: number): string => value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(value)
const duration = (ms: number): string => {
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60), seconds = total % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}
const aboutRate = (value: number): string => `约 ${Math.max(1, Math.round(value))} tok/s`

function Sparkline({ samples }: { samples: OutputSpeed['samples'] }): React.JSX.Element {
  const points = samples.slice(-60)
  const width = 96, height = 30
  const max = Math.max(...points.map(item => item.tokensPerSecond), 1)
  const path = points.map((item, index) => {
    const x = points.length > 1 ? index / (points.length - 1) * (width - 2) + 1 : width / 2
    const y = height - 2 - item.tokensPerSecond / max * (height - 5)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const last = points.at(-1)
  return <svg className="speed-tooltip-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    {path && <path d={path} fill="none" />}
    {last && path && <circle cx={width - 1} cy={Math.max(2, Math.min(height - 2, height - 2 - last.tokensPerSecond / max * (height - 5)))} r={2} />}
  </svg>
}

/** 输入框右上角（外侧）的输出速度提示：纯文本展示，绝对定位不占布局空间。 */
export function SpeedIndicator({ speed }: { speed: OutputSpeed }): React.JSX.Element {
  const current = speed.recentTokensPerSecond || speed.averageTokensPerSecond
  return <Tooltip.Provider delayDuration={180}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild><span className="composer-speed" aria-label="输出速度">{duration(speed.elapsedMs)} · {aboutRate(current)}</span></Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="composer-status-tooltip speed-tooltip" side="top" align="end" sideOffset={8} collisionPadding={12}>
        <div className="speed-tooltip-heading">
          <div className="speed-tooltip-current">
            <span className="speed-tooltip-label">最近速度</span>
            <span className="speed-tooltip-value">约{Math.max(1, Math.round(current))}<small> tok/s</small></span>
          </div>
          <Sparkline samples={speed.samples} />
        </div>
        <div className="speed-tooltip-figures">
          <div><span>本轮平均</span><b>{aboutRate(speed.averageTokensPerSecond)}</b></div>
          <div><span>累计输出</span><b>约{compact(speed.outputTokens)} tok</b></div>
          <div><span>峰值</span><b>{aboutRate(speed.peakTokensPerSecond)}</b></div>
        </div>
        <div className="speed-tooltip-footer"><span>首响应</span><span>{speed.firstResponseMs == null ? '—' : `${(speed.firstResponseMs / 1000).toFixed(1)}秒`}</span></div>
      </Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
}
