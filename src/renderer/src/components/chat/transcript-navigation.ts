/** 沿已挂载内容推进，避免虚拟列表用预估高度一次定位后再反向修正。 */
export function navigateTranscript(
  scroller: HTMLElement,
  targetKey: string,
  positions: ReadonlyMap<string, number>,
  onDone: () => void,
  reducedMotion = false
): () => void {
  let frame: number
  let previousTime: number | undefined
  let settledSince: number | undefined
  let anchor: { element: HTMLElement; top: number } | undefined
  let direction = 0
  const targetIndex = positions.get(targetKey)!

  const tick = (time: number): void => {
    const bounds = scroller.getBoundingClientRect()
    // 通知唤起窗口时可能仍在后台或尚无可见布局，不能提前结束导航和播放提示。
    if (document.hidden || bounds.height <= 0 || bounds.width <= 0) {
      previousTime = undefined
      settledSince = undefined
      frame = requestAnimationFrame(tick)
      return
    }
    const elapsed = Math.min(32, previousTime === undefined ? 16 : time - previousTime)
    previousTime = time
    // 保留上一帧的视觉位置，消除新行测量及虚拟列表自身高度校正造成的位移。
    if (anchor?.element.isConnected) {
      const drift = anchor.element.getBoundingClientRect().top - anchor.top
      if (Math.abs(drift) > 0.5) scroller.scrollTop += drift
    }
    const items = Array.from(scroller.querySelectorAll<HTMLElement>('[data-transcript-key]'))
    const first = items[0], last = items.at(-1)
    if (!first || !last) { frame = requestAnimationFrame(tick); return }
    const firstIndex = positions.get(first.dataset.transcriptKey!)!
    const lastIndex = positions.get(last.dataset.transcriptKey!)!
    const firstRect = first.getBoundingClientRect(), lastRect = last.getBoundingClientRect()
    const target = items.find(item => item.dataset.transcriptKey === targetKey)
    const averageHeight = (lastRect.bottom - firstRect.top) / (lastIndex - firstIndex + 1)
    const distance = target
      ? target.getBoundingClientRect().top - bounds.top - 12
      : firstRect.top - bounds.top + (targetIndex - firstIndex) * averageHeight - 12
    // 首尾消息可能无法顶端对齐，按滚动容器实际边界收敛。
    const remaining = Math.max(-scroller.scrollTop, Math.min(distance, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop))
    if (!direction) direction = Math.sign(remaining)
    // 浏览器按物理像素量化 scrollTop，半像素残差可能永远无法继续靠近。
    // 容许 1 CSS 像素误差，确保首次与重复定位都能进入完成回调。
    if (target && (Math.abs(remaining) <= 1 || direction * remaining <= 0)) {
      settledSince ??= time
      anchor = { element: target, top: target.getBoundingClientRect().top }
      // 目标刚挂载时仍会测量正文，短暂等待稳定后再交回阅读锚点。
      if (time - settledSince >= 100) { onDone(); return }
    } else {
      settledSince = undefined
      const edge = direction > 0 ? last : first
      const edgeRect = edge.getBoundingClientRect()
      // 未加载的目标只能从当前渲染范围靠近；绝不越过未测量的目标。
      const available = target ? Math.abs(remaining) : Math.max(0, direction > 0
        ? edgeRect.bottom - bounds.top - 12
        : bounds.top + 12 - edgeRect.top)
      // 每次至少推进 1 CSS 像素，避免缓动末段的小步长被取整为零而停滞。
      const step = direction * Math.min(available, Math.max(0, direction * remaining), reducedMotion ? Math.abs(remaining) : Math.max(1, Math.abs(remaining) * (1 - Math.exp(-elapsed / 90))))
      const before = scroller.scrollTop
      scroller.scrollTo({ top: before + step, behavior: 'instant' })
      anchor = { element: edge, top: edgeRect.top - (scroller.scrollTop - before) }
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}
