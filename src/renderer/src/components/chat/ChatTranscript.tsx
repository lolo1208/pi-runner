import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso'
import { Button } from '@/components/ui/button'
import { Settings2 } from 'lucide-react'
import type { AgentSnapshot, ChatMessage, ProviderId } from '../../../../shared/models'
import { ChatImages } from './ChatImages'
import { CopyMessageButton } from './CopyMessageButton'
import { RoundChanges } from './RoundChanges'
import { ExecutionLabel } from './ExecutionLabel'
import { RoundActivity } from './RoundActivity'
import { ChatMarkdown } from './ChatMarkdown'
import { roundChangesKey, useRoundChanges } from '../../hooks/useRoundChanges'
import { TranscriptProvider, TranscriptScope, TranscriptState } from './TranscriptState'
import { navigateTranscript } from './transcript-navigation'
import { highlightTranscript } from './transcript-highlight'

const NO_SNAPSHOTS: AgentSnapshot[] = []
// 给虚拟列表留出少量时间完成估算高度校正，期间保持同一文字锚点。
const RESIZE_SETTLE_MS = 100
const USER_SCROLL_PAUSE_MS = 150
const bubbleText = (content: string): string => content.replace(/^\s+|\s+$/g, '')
// 折叠摘要中的完整正文仍参与 DOM 布局，但不能用作用户的阅读位置。
const canAnchorReading = (element: HTMLElement): boolean => element.isConnected && !element.closest('[inert], [hidden], [aria-hidden="true"]')

/** 每轮对话对应一个导航点：用户消息行 + 随后的模型回复摘要。 */
interface RoundDot { key: string; index: number; user: string; reply: string }

const clipText = (text: string, max: number): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** 单个轮次导航点：悬停/聚焦时才渲染 tooltip 内容，避免把未挂载轮次的正文提前插入 DOM。 */
function RoundDotButton({ roundKey, round, number, active, onJump }: { roundKey: string; round: RoundDot; number: number; active?: boolean; onJump: (index: number) => void }): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  // tooltip 渲染到 body 的固定定位浮层：导航条的 overflow 裁剪和内层 transform 都不会影响它。
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null)
  const showTip = (): void => {
    const bounds = buttonRef.current?.getBoundingClientRect()
    if (bounds) setTipPos({ top: bounds.top + bounds.height / 2, left: bounds.right + 10 })
  }
  return <button ref={buttonRef} type="button" data-round-key={roundKey} className={`chat-round-dot${active ? ' active' : ''}`} aria-label={`跳转到第 ${number} 轮对话`} aria-current={active ? 'true' : undefined}
    onMouseEnter={showTip} onMouseLeave={() => setTipPos(null)} onFocus={showTip} onBlur={() => setTipPos(null)}
    onClick={() => onJump(round.index)}>
    <span className="round-dot-mark" aria-hidden="true" />
    {tipPos && createPortal(<span className="round-tip" role="tooltip" style={{ top: tipPos.top, left: tipPos.left }}>
      <span className="round-tip-number">第 {number} 轮</span>
      <span className="round-tip-user">{round.user || '（附件消息）'}</span>
      {round.reply && <span className="round-tip-reply">{round.reply}</span>}
    </span>, document.body)}
  </button>
}

interface ChatTranscriptProps {
  project?: string | null
  active?: boolean
  scrollToLatestRequest?: number
  notificationNavigationRequest?: number
  snapshots?: AgentSnapshot[]
  messages: ChatMessage[]
  pendingMessage: ChatMessage | null
  streamedText?: string
  agentStatus?: string
  isBusy?: boolean
  execution?: { model: string; provider?: ProviderId; startedAt: number; firstMessage: number }
  hasProfile: boolean
  settingsDisabled?: boolean
  onOpenSettings: () => void
}

interface TranscriptRow {
  key: string
  messages: ChatMessage[]
  index: number
  roundIndex: number
  snapshots: AgentSnapshot[]
  kind: 'message' | 'pending' | 'stream'
}

interface ReadingPosition {
  key?: string
  offset: number
  follow: boolean
}

const MessageList = forwardRef<HTMLDivElement, ComponentProps<'div'>>(function MessageList({ className, ...props }, ref) {
  return <div {...props} ref={ref} className={`chat-messages chat-virtual-messages ${className ?? ''}`} />
})
const listComponents = { List: MessageList }

export const ChatTranscript = memo(function ChatTranscript(props: ChatTranscriptProps): React.JSX.Element {
  const { messages, snapshots = NO_SNAPSHOTS, pendingMessage, streamedText = '', isBusy, execution, active = true } = props
  const [store] = useState(() => new TranscriptState())
  const position = useRef<ReadingPosition>({ offset: 0, follow: true })
  const lastLatestRequest = useRef(props.scrollToLatestRequest ?? 0)
  const lastNotificationRequest = useRef(0)
  const previousMessages = useRef(messages)
  const previousGroups = useRef<TranscriptRow[]>([])
  const [revision, setRevision] = useState(0)
  const [viewport, setViewport] = useState<{ range: ListRange | null; visible: string[]; ready: boolean }>({ range: null, visible: [], ready: false })

  const groups = useMemo(() => {
    const groups: TranscriptRow[] = []
    const anchors = new Map<string, number>()
    const messageGroups = new Map<number, TranscriptRow>()
    let roundIndex = 0
    messages.forEach((message, index) => {
      if (message.snapshotHash && !anchors.has(message.snapshotHash)) anchors.set(message.snapshotHash, index)
      if (message.role === 'user') roundIndex = index
      const previous = groups.at(-1)
      if (message.role === 'assistant' && previous?.messages[0].role === 'assistant'
        && (!message.execution?.roundId || !previous.messages[0].execution?.roundId || message.execution.roundId === previous.messages[0].execution?.roundId)) previous.messages.push(message)
      else groups.push({ key: `message:${index}:${message.role}:${message.execution?.roundId ?? ''}`, messages: [message], index, roundIndex, snapshots: [], kind: 'message' })
      messageGroups.set(index, groups.at(-1)!)
    })
    for (const round of snapshots) {
      const target = anchors.get(round.after.hash) ?? round.messageIndex
      if (target !== undefined) messageGroups.get(target)?.snapshots.push(round)
    }
    return groups.map((row, index) => {
      const old = previousGroups.current[index]
      return old?.key === row.key && old.messages.length === row.messages.length && old.messages.every((message, i) => message === row.messages[i])
        && old.snapshots.length === row.snapshots.length && old.snapshots.every((round, i) => round === row.snapshots[i]) ? old : row
    })
  }, [messages, snapshots])
  useLayoutEffect(() => { previousGroups.current = groups }, [groups])

  const hasStream = Boolean(streamedText || isBusy && !messages.slice(execution?.firstMessage ?? messages.length).some(message => message.role === 'assistant'))
  const rows = useMemo(() => {
    if (!pendingMessage && !hasStream) return groups
    const rows = [...groups]
    if (pendingMessage) rows.push({ key: 'pending', messages: [pendingMessage], index: messages.length, roundIndex: messages.length, snapshots: [], kind: 'pending' })
    if (hasStream) {
      rows.push({ key: 'stream', messages: [], index: messages.length, roundIndex: messages.length, snapshots: [], kind: 'stream' })
    }
    return rows
  }, [groups, pendingMessage, hasStream, messages.length])
  const loadedRounds = useMemo(() => active && viewport.range ? rows.slice(viewport.range.startIndex, viewport.range.endIndex + 1).flatMap(row => row.snapshots) : [], [active, rows, viewport.range])
  const changes = useRoundChanges(loadedRounds, viewport.visible, active, Boolean(isBusy || props.settingsDisabled), active && viewport.ready, snapshots)
  const setRange = useCallback((range: ListRange): void => {
    setViewport(previous => previous.range?.startIndex === range.startIndex && previous.range.endIndex === range.endIndex ? previous : { ...previous, range, ready: false })
  }, [])
  const setVisible = useCallback((visible: string[]): void => {
    setViewport(previous => previous.ready && previous.visible.length === visible.length && previous.visible.every((key, index) => key === visible[index]) ? previous : { ...previous, visible, ready: true })
  }, [])
  useLayoutEffect(() => { if (!active) setViewport({ range: null, visible: [], ready: false }) }, [active])

  // 恢复项目会截断消息；重置测量并清理后续轮次的交互状态。
  useLayoutEffect(() => {
    const previous = previousMessages.current
    previousMessages.current = messages
    const replaced = messages.length < previous.length || messages.some((message, index) => {
      const old = previous[index]
      return old && (old.role !== message.role || old.execution?.roundId !== message.execution?.roundId || Boolean(old.content && !message.content.startsWith(old.content)))
    })
    if (replaced) {
      position.current = { offset: 0, follow: true }
      setViewport({ range: null, visible: [], ready: false })
      setRevision(value => value + 1)
    }
    store.retain(new Set(rows.map(row => row.key)))
  }, [messages, rows, store])

  return <TranscriptProvider key={revision} store={store} active={active}>
    {active && (rows.length ? <VirtualTranscript {...props} rows={rows} position={position} lastLatestRequest={lastLatestRequest} lastNotificationRequest={lastNotificationRequest} changes={changes} onRange={setRange} onVisible={setVisible} />
      : <div className="chat-scroll"><div className="chat-welcome">
        <div className="welcome-brand">
          <div className="welcome-mark"><img src="./icons/app-icon.png" alt="" draggable={false} /></div>
          <span className="welcome-app-name">Pi Runner · 行动派</span>
        </div>
        <h1>今天，想完成什么？</h1>
        <p>从一个想法、一个问题，或一项新任务开始。</p>
        {!props.hasProfile && <Button disabled={props.settingsDisabled} onClick={props.onOpenSettings}><Settings2 size={16} />配置模型</Button>}
      </div></div>)}
  </TranscriptProvider>
})

function VirtualTranscript({ rows, position, lastLatestRequest, lastNotificationRequest, changes, onRange, onVisible, project, streamedText = '', agentStatus, isBusy, execution, settingsDisabled, scrollToLatestRequest = 0, notificationNavigationRequest = 0 }: ChatTranscriptProps & {
  rows: TranscriptRow[]
  position: MutableRefObject<ReadingPosition>
  lastLatestRequest: MutableRefObject<number>
  lastNotificationRequest: MutableRefObject<number>
  changes: ReturnType<typeof useRoundChanges>
  onRange: (range: ListRange) => void
  onVisible: (visible: string[]) => void
}): React.JSX.Element {
  const list = useRef<VirtuosoHandle>(null)
  const scroll = useRef<HTMLElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState(600)
  const followLatest = useRef(position.current.follow || lastLatestRequest.current !== scrollToLatestRequest)
  const initialized = useRef(false)
  const lastScrollTop = useRef(0)
  const measuredScrollTop = useRef(0)
  const layoutAnchor = useRef<{ element: HTMLElement; offset: number } | null>(null)
  const resizingAnchor = useRef<{ element: HTMLElement; offset: number; until: number } | null>(null)
  const userInputUntil = useRef(0)
  const dragging = useRef(false)
  const correctedScrollTop = useRef<number | null>(null)
  const navigation = useRef<(() => void) | null>(null)
  const startedNotificationRequest = useRef(0)
  const highlight = useRef<(() => void) | null>(null)
  const highlightRow = useCallback((key: string, onDone?: () => void): void => {
    highlight.current?.()
    const el = scroll.current
    if (el) highlight.current = highlightTranscript(el, key, () => {
      highlight.current = null
      onDone?.()
    })
  }, [])
  useEffect(() => () => {
    highlight.current?.()
  }, [])
  const stopNavigation = useCallback((): void => {
    if (!navigation.current) return
    navigation.current?.()
    navigation.current = null
    layoutAnchor.current = null
    resizingAnchor.current = null
  }, [])
  useEffect(() => stopNavigation, [stopNavigation])
  // 点击导航点后钉住的行位置：跳转后的程序滚动不再改写强调色，用户真实滚动后解除。
  const pinnedRoundRef = useRef<number | null>(null)
  const frame = useRef<number | null>(null)
  const geometry = useRef('')
  const activeStatus = isBusy ? agentStatus || '正在等待模型回复…' : undefined
  const rowMap = useMemo(() => new Map(rows.map(row => [row.key, row])), [rows])
  // 导航点：每条用户消息作为一轮，摘要取本轮回复的第一个助手消息。
  const rounds = useMemo<RoundDot[]>(() => rows.flatMap((row, index) => {
    const message = row.messages[0]
    if (row.kind !== 'message' || message.role !== 'user' || !bubbleText(message.content)) return []
    const replyRow = rows.slice(index + 1).find(item => item.messages[0]?.role === 'assistant')
    const reply = replyRow ? bubbleText(replyRow.messages.map(item => item.content).join(' ')) : ''
    return [{ key: row.key, index, user: clipText(message.content, 160), reply: clipText(reply, 200) }]
  }), [rows])
  // 当前阅读位置对应的导航点：取视口顶部可见行之前最近的一轮，用强调色标出。
  const rowPositions = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows])
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null)
  const activeRoundKey = useMemo(() => {
    if (activeRowIndex === null) return undefined
    let current: string | undefined
    for (const round of rounds) { if (round.index <= activeRowIndex) current = round.key; else break }
    return current
  }, [rounds, activeRowIndex])
  // 轮次过多时导航条超出可视高度：鼠标悬停在列表上时位置只由鼠标决定；
  // 离开后恢复自动模式，让强调色小点随内容居中可见。
  const railRef = useRef<HTMLElement>(null)
  const railTrackRef = useRef<HTMLDivElement>(null)
  const [railShift, setRailShift] = useState(0)
  const [railHover, setRailHover] = useState(false)
  // 按下小点期间冻结列表平移：点击本身不应引起任何滚动。
  const railFreezeRef = useRef(false)
  useEffect(() => {
    const release = (): void => { setTimeout(() => { railFreezeRef.current = false }, 250) }
    window.addEventListener('pointerup', release, { passive: true })
    return () => window.removeEventListener('pointerup', release)
  }, [])
  const activeRoundKeyRef = useRef(activeRoundKey)
  activeRoundKeyRef.current = activeRoundKey
  const centerRail = useCallback((): void => {
    if (railFreezeRef.current) return
    const rail = railRef.current, track = railTrackRef.current
    const key = activeRoundKeyRef.current
    const button = key === undefined ? undefined : track?.querySelector<HTMLElement>(`[data-round-key="${key}"]`)
    if (!rail || !track || !button) return
    const overflow = rail.scrollHeight - rail.clientHeight
    if (overflow <= 0) { setRailShift(previous => previous === 0 ? previous : 0); return }
    const center = button.offsetTop + button.offsetHeight / 2
    const next = Math.round(Math.min(0, Math.max(-overflow, rail.clientHeight / 2 - center)))
    setRailShift(previous => previous === next ? previous : next)
  }, [])
  const handleShellMouseMove = useCallback((event: React.MouseEvent): void => {
    if (railFreezeRef.current || !railHover) return
    const rail = railRef.current
    if (!rail) return
    const target = event.target as HTMLElement
    if (!rail.contains(target)) return
    const overflow = rail.scrollHeight - rail.clientHeight
    if (overflow <= 0) { setRailShift(previous => previous === 0 ? previous : 0); return }
    const bounds = rail.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
    setRailShift(previous => { const next = Math.round(-overflow * ratio); return next === previous ? previous : next })
  }, [railHover])
  // 悬停期间列表只跟鼠标，绝不做内容驱动的平移；离开后按当前内容位置居中。
  useEffect(() => { if (!railHover && pinnedRoundRef.current === null && !railFreezeRef.current) centerRail() }, [railHover, activeRoundKey, centerRail])

  const [initial] = useState(() => {
    const saved = position.current
    const anchorIndex = rows.findIndex(row => row.key === saved.key)
    const follow = followLatest.current || anchorIndex < 0
    followLatest.current = follow
    const location = follow
      ? { index: Math.max(0, rows.length - 1), align: 'end' as const }
      : { index: anchorIndex, align: 'start' as const, offset: -saved.offset }
    return { saved, follow, location }
  })

  const measure = useCallback((): void => {
    const el = scroll.current
    if (!el) return
    const bounds = el.getBoundingClientRect()
    if (bounds.height <= 0) return
    const nextGeometry = `${bounds.width}:${getComputedStyle(el).fontSize}:${getComputedStyle(document.documentElement).fontSize}`
    if (geometry.current && geometry.current !== nextGeometry && initialized.current && !followLatest.current && !navigation.current) {
      const saved = position.current
      const index = rows.findIndex(row => row.key === saved.key)
      if (index >= 0) list.current?.scrollToIndex({ index, align: 'start', offset: -saved.offset })
      geometry.current = nextGeometry
      frame.current = requestAnimationFrame(() => { frame.current = null; measureRef.current() })
      return
    }
    geometry.current = nextGeometry
    if (el.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]')?.style.visibility === 'hidden') {
      frame.current = requestAnimationFrame(() => { frame.current = null; measureRef.current() })
      return
    }
    // 非 React 的尺寸变化（例如字体和资源解码）也只在用户未移动时补偿。
    const pending = resizingAnchor.current
    if (pending && (!canAnchorReading(pending.element) || performance.now() > pending.until)) resizingAnchor.current = null
    const savedLayout = resizingAnchor.current ?? layoutAnchor.current
    // 用户滚动期间，只补偿已确认的内容增高；虚拟列表自己的占位校正不能再次补偿。
    // 静止时仍维护锚点，让会话重开、异步测量完成后保持原来的阅读位置。
    const idle = !dragging.current && performance.now() > userInputUntil.current
    const preserving = !navigation.current && initialized.current && !followLatest.current && (resizingAnchor.current || idle && el.scrollTop === measuredScrollTop.current)
    if (preserving) {
      const saved = savedLayout
      if (saved && canAnchorReading(saved.element)) {
        const delta = saved.element.getBoundingClientRect().top - bounds.top - saved.offset
        if (Math.abs(delta) > 0.5) {
          el.scrollTop += delta
          correctedScrollTop.current = el.scrollTop
          lastScrollTop.current = el.scrollTop
        }
      }
    }
    // 只测量已挂载的少量消息，历史总量不影响每次滚动的工作量。
    const keys: string[] = []
    let anchor: { key: string; offset: number } | undefined
    let visibleRow: HTMLElement | undefined
    for (const item of el.querySelectorAll<HTMLElement>('[data-transcript-key]')) {
      const rect = item.getBoundingClientRect()
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue
      const key = item.dataset.transcriptKey!
      anchor ??= { key, offset: rect.top - bounds.top }
      visibleRow ??= item
      keys.push(...(rowMap.get(key)?.snapshots.map(roundChangesKey) ?? []))
    }
    if (!initialized.current) {
      const ready = initial.follow ? el.scrollHeight - el.clientHeight - el.scrollTop <= 48 : anchor?.key === initial.saved.key
      if (!anchor || !ready) return
      initialized.current = true
      lastScrollTop.current = el.scrollTop
    }
    onVisible(keys)
    // 同步导航点：每次测量都重算；点击跳转后用 pinnedRound 钉住，直到用户再次真实滚动才解除，
    // 避免跳转后的程序滚动与高度校正把强调色拉回上一轮，也避免任何路径下出现无对应小点的空窗。
    {
      // 贴底阅读最后一轮：顶部锚点属于前面的轮次，直接指向最后一行。
      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 48
      const topIndex = pinnedRoundRef.current ?? (atBottom ? rows.length - 1 : anchor ? rowPositions.get(anchor.key) : undefined)
      setActiveRowIndex(previous => (topIndex ?? null) === previous ? previous : topIndex ?? null)
    }
    setViewportHeight(previous => previous === bounds.height ? previous : bounds.height)
    const saved: ReadingPosition = { key: anchor?.key, offset: anchor?.offset ?? 0, follow: followLatest.current }
    position.current = saved
    measuredScrollTop.current = el.scrollTop
    // 行内的卡片也可能变高；优先锚定屏内实际文字，不能只保存整行顶部。
    const candidates = el.querySelectorAll<HTMLElement>('.chat-message :is(p, pre, h1, h2, h3, h4, h5, h6, li, tr), .plan-answer-row, .plan-card-toggle, .chat-round-toggle, .chat-call-toggle, .chat-work-toggle, .round-changes-file')
    let block: HTMLElement | undefined
    for (const candidate of candidates) {
      if (!canAnchorReading(candidate)) continue
      const rect = candidate.getBoundingClientRect()
      if (rect.top >= bounds.top && rect.top < bounds.bottom) { block = candidate; break }
      if (!block && rect.bottom > bounds.top && rect.top < bounds.bottom) block = candidate
    }
    // 纯附件或其他无文字块的消息也要有后备锚点。
    block ??= visibleRow
    layoutAnchor.current = block ? { element: block, offset: preserving && savedLayout?.element === block ? savedLayout.offset : block.getBoundingClientRect().top - bounds.top } : null
    if (resizingAnchor.current && frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; measureRef.current() })
    const width = el.scrollHeight > el.clientHeight ? el.offsetWidth - el.clientWidth : 0
    el.parentElement?.style.setProperty('--chat-scrollbar', `${width}px`)
  }, [position, rowMap, rowPositions, rows, onVisible, initial])
  const measureRef = useRef(measure)
  useLayoutEffect(() => { measureRef.current = measure })
  const scheduleMeasure = useCallback((): void => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => { frame.current = null; measureRef.current() })
  }, [])
  // 胶囊与通知共用到位回调，等目标挂载并稳定后再播放高亮。
  const jumpToRow = useCallback((index: number, onArrival?: () => void): void => {
    stopNavigation()
    layoutAnchor.current = null
    resizingAnchor.current = null
    followLatest.current = false
    pinnedRoundRef.current = index
    setActiveRowIndex(index)
    const el = scroll.current
    const key = rows[index].key
    if (el) navigation.current = navigateTranscript(el, key, rowPositions, () => {
      navigation.current = null
      layoutAnchor.current = null
      resizingAnchor.current = null
      initialized.current = true
      measureRef.current()
      highlightRow(key, onArrival)
    }, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  }, [stopNavigation, rows, rowPositions, highlightRow])
  const setScroller = useCallback((el: HTMLElement | Window | null): void => {
    scroll.current = el instanceof HTMLElement ? el : null
  }, [])

  // Virtuoso 在 effect 中提供 scrollerRef，观察器必须在它之后安装。
  useEffect(() => {
    const el = scroll.current
    if (!el) return
    const observed = new Map<HTMLElement, number>()
    const resized = (): void => {
      let changed = false
      for (const [item, height] of observed) if (el.contains(item)) {
        const next = item.offsetHeight
        if (next !== height) { changed = true; observed.set(item, next) }
      }
      if (changed && initialized.current && !followLatest.current && !navigation.current
        && (el.scrollTop === measuredScrollTop.current || !dragging.current && performance.now() > userInputUntil.current)) {
        const saved = resizingAnchor.current ?? layoutAnchor.current
        if (saved && canAnchorReading(saved.element)) resizingAnchor.current = { ...saved, until: performance.now() + RESIZE_SETTLE_MS }
      }
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { resized(); measureRef.current() })
    observer?.observe(el)
    const items = el.querySelector('[data-testid="virtuoso-item-list"]')
    if (items) observer?.observe(items)
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      resized()
      // 及时解绑卸载的行，ResizeObserver 不能成为历史 DOM 的持有者。
      for (const item of observed.keys()) if (!el.contains(item)) { observer?.unobserve(item); observed.delete(item) }
      for (const item of el.querySelectorAll<HTMLElement>('[data-transcript-key]')) if (!observed.has(item)) { observer?.observe(item); observed.set(item, item.offsetHeight) }
      if (initialized.current && !followLatest.current) measureRef.current()
      else scheduleMeasure()
    })
    // 初次提交时 Virtuoso 可能尚未创建行容器，必须从已存在的滚动容器观察。
    mutations?.observe(el, { subtree: true, childList: true, characterData: true })
    const userInput = (event?: Event): void => {
      stopNavigation()
      resizingAnchor.current = null
      pinnedRoundRef.current = null
      // 按键、滚轮和按下鼠标不等于已经滚动，不能提前丢掉仍然有效的阅读锚点。
      userInputUntil.current = performance.now() + USER_SCROLL_PAUSE_MS
      if (event?.type === 'wheel' && (event as WheelEvent).deltaY < 0
        || event?.type === 'keydown' && ['ArrowUp', 'PageUp', 'Home'].includes((event as KeyboardEvent).key)) followLatest.current = false
    }
    const pointerDown = (): void => { dragging.current = true; userInput() }
    const pointerUp = (): void => { dragging.current = false; userInputUntil.current = performance.now() + USER_SCROLL_PAUSE_MS }
    el.addEventListener('wheel', userInput, { passive: true })
    el.addEventListener('touchmove', userInput, { passive: true })
    el.addEventListener('pointerdown', pointerDown, { passive: true })
    window.addEventListener('pointerup', pointerUp, { passive: true })
    window.addEventListener('pointercancel', pointerUp, { passive: true })
    el.addEventListener('keydown', userInput)
    scheduleMeasure()
    return () => {
      observer?.disconnect()
      mutations?.disconnect()
      el.removeEventListener('wheel', userInput)
      el.removeEventListener('touchmove', userInput)
      el.removeEventListener('pointerdown', pointerDown)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerUp)
      el.removeEventListener('keydown', userInput)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [scheduleMeasure, stopNavigation])
  // DOM 移除前记录阅读锚点；effect 清理时消息已经不可测量。
  useLayoutEffect(() => () => measureRef.current(), [])

  useLayoutEffect(() => {
    if (lastLatestRequest.current !== scrollToLatestRequest) {
      lastLatestRequest.current = scrollToLatestRequest
      stopNavigation()
      followLatest.current = true
      list.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
    }
    scheduleMeasure()
  }, [scrollToLatestRequest, lastLatestRequest, rows, scheduleMeasure, stopNavigation])

  useEffect(() => {
    if (!notificationNavigationRequest || lastNotificationRequest.current === notificationNavigationRequest
      || startedNotificationRequest.current === notificationNavigationRequest) return
    // 后台会话恢复可能晚于通知点击；等用户气泡出现后再消费请求。
    let index = rows.length - 1
    while (index >= 0 && rows[index].messages[0]?.role !== 'user') index--
    if (index < 0 || !scroll.current) return
    startedNotificationRequest.current = notificationNavigationRequest
    // 列表可能因正式历史恢复而重建，只有到位并播放高亮后才消费通知请求。
    jumpToRow(index, () => { lastNotificationRequest.current = notificationNavigationRequest })
  }, [notificationNavigationRequest, lastNotificationRequest, rows, jumpToRow])

  const handleScroll = useCallback((): void => {
    const el = scroll.current
    if (!el) return
    if (navigation.current) { lastScrollTop.current = el.scrollTop; scheduleMeasure(); return }
    if (correctedScrollTop.current !== null && Math.abs(el.scrollTop - correctedScrollTop.current) < 1) {
      correctedScrollTop.current = null
      lastScrollTop.current = el.scrollTop
      scheduleMeasure()
      return
    }
    correctedScrollTop.current = null
    if (resizingAnchor.current && performance.now() > userInputUntil.current) { scheduleMeasure(); return }
    if (initial.follow && el.scrollHeight > 0 && el.scrollHeight - el.clientHeight - el.scrollTop <= 48) initialized.current = true
    if (initialized.current) {
      if (el.scrollHeight - el.clientHeight - el.scrollTop <= 48) followLatest.current = true
      else if (el.scrollTop < lastScrollTop.current - 1) followLatest.current = false
    }
    lastScrollTop.current = el.scrollTop
    // 在下一次异步尺寸回调前更新实际阅读位置，避免补偿覆盖刚发生的滚动。
    if (dragging.current || performance.now() <= userInputUntil.current) measureRef.current()
    else scheduleMeasure()
  }, [scheduleMeasure, initial.follow])
  const handleHeightChange = useCallback((): void => {
    // 流式内容增长不一定增加条目数，也需要在跟随模式下贴住底部。
    if (initialized.current && followLatest.current) list.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
    scheduleMeasure()
  }, [scheduleMeasure])

  return <div className="chat-transcript-shell" onMouseMove={handleShellMouseMove}>
    {rounds.length > 0 && <nav ref={railRef} className="chat-round-rail" aria-label="对话轮次导航"
      onPointerEnter={() => setRailHover(true)} onPointerLeave={() => { railFreezeRef.current = false; setRailHover(false) }}
      onPointerDown={() => { railFreezeRef.current = true }}>
        <div ref={railTrackRef} className="chat-round-rail-track" style={{ transform: `translateY(${railShift}px)` }}>
        {rounds.map((round, number) => <RoundDotButton key={round.key} roundKey={round.key} round={round} number={number + 1} active={round.key === activeRoundKey}
          onJump={jumpToRow} />)}
      </div>
    </nav>}
    <Virtuoso ref={list} className="chat-scroll chat-virtual-scroll" data={rows} components={listComponents}
    scrollerRef={setScroller} computeItemKey={(_, row) => row.key} defaultItemHeight={180}
    initialTopMostItemIndex={initial.location}
    increaseViewportBy={{ top: viewportHeight, bottom: viewportHeight }} atBottomThreshold={48}
    atBottomStateChange={scheduleMeasure}
    followOutput={() => followLatest.current ? 'auto' : false}
    onScroll={handleScroll} rangeChanged={range => { onRange(range); scheduleMeasure() }} totalListHeightChanged={handleHeightChange}
    itemContent={(_, row) => <TranscriptScope id={row.key}>
      <div className={`chat-virtual-row ${row.messages[0]?.role ?? 'assistant'}`} data-transcript-key={row.key}>
        {row.kind === 'stream' ? <article className="chat-message assistant" aria-label="正在生成的回复" aria-live="polite"><ExecutionLabel execution={execution} startedAt={execution?.startedAt} status={activeStatus} busy />{streamedText && <ChatMarkdown project={project} content={streamedText} />}</article>
          : <TranscriptMessage row={row} project={project} isBusy={isBusy} execution={execution} activeStatus={activeStatus} changes={changes} settingsDisabled={settingsDisabled} />}
        {row.kind === 'pending' && !isBusy && <div className="thinking" role="status"><span className="busy-dot" />正在等待模型回复…</div>}
      </div>
    </TranscriptScope>} />
  </div>
}

const TranscriptMessage = memo(function TranscriptMessage({ row, project, isBusy, execution, activeStatus, changes, settingsDisabled }: {
  row: TranscriptRow
  project?: string | null
  isBusy?: boolean
  execution?: ChatTranscriptProps['execution']
  activeStatus?: string
  changes: ReturnType<typeof useRoundChanges>
  settingsDisabled?: boolean
}): React.JSX.Element {
  const message = row.messages[0]
  const busy = Boolean(isBusy && execution && row.index + row.messages.length > execution.firstMessage)
  return <article className={`chat-message ${message.role}`} data-round-index={row.roundIndex}>
    {message.role === 'assistant' && <RoundActivity project={project} messages={row.messages} busy={busy} execution={busy ? execution : row.messages.at(-1)?.execution} startedAt={busy ? execution?.startedAt : undefined} status={busy ? activeStatus : undefined} />}
    {Boolean(message.images?.length) && <ChatImages images={message.images!} />}
    {message.role === 'user' && message.content && <p>{bubbleText(message.content)}</p>}
    {message.role === 'user' && bubbleText(message.content) && <CopyMessageButton text={bubbleText(message.content)} />}
    {row.snapshots.map(round => {
      const key = roundChangesKey(round)
      return <TranscriptScope key={key} id={`snapshot:${key}`}><RoundChanges round={round} data={changes.data[key]} onRetry={() => changes.retry(round)} disabled={isBusy || settingsDisabled} /></TranscriptScope>
    })}
  </article>
}, (previous, next) => previous.row === next.row && previous.project === next.project && previous.isBusy === next.isBusy
  && previous.settingsDisabled === next.settingsDisabled
  && (!(next.isBusy && next.execution && next.row.index + next.row.messages.length > next.execution.firstMessage)
    || previous.execution === next.execution && previous.activeStatus === next.activeStatus)
  && previous.changes.retry === next.changes.retry
  && next.row.snapshots.every(round => previous.changes.data[roundChangesKey(round)] === next.changes.data[roundChangesKey(round)]))
