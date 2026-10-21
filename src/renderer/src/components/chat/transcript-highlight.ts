/** 按可见帧播放到达提示，避免窗口唤起、渲染暂停时定时器提前耗尽。 */
export function highlightTranscript(scroller: HTMLElement, key: string, onDone?: () => void): () => void {
  let frame: number
  let row: HTMLElement | null = null
  let bubble: HTMLElement | null = null
  let elapsed = 0
  let previousTime: number | undefined
  const clear = (): void => {
    row?.classList.remove('chat-arrival-highlight')
    row?.style.removeProperty('--chat-arrival-delay')
  }
  const tick = (time: number): void => {
    if (!scroller.isConnected) { clear(); return }
    // 虚拟列表可能复用或替换节点，不能只持有第一次找到的 DOM。
    const next = Array.from(scroller.querySelectorAll<HTMLElement>('[data-transcript-key]'))
      .find(element => element.dataset.transcriptKey === key) ?? null
    const nextBubble = next?.querySelector<HTMLElement>('.chat-message.user') ?? null
    if (next !== row || nextBubble !== bubble) {
      clear()
      row = next
      bubble = nextBubble
      previousTime = undefined
    }
    const bounds = scroller.getBoundingClientRect()
    const rect = bubble?.getBoundingClientRect()
    const visible = !document.hidden && bounds.height > 0 && bounds.width > 0 && bubble && rect
      && rect.bottom > bounds.top && rect.top < bounds.bottom
      && getComputedStyle(bubble).visibility === 'visible'
    if (!visible) {
      previousTime = undefined
    } else {
      // 长帧间隔表示窗口被遮挡或线程繁忙，不能把不可见的时间计入提示时长。
      elapsed += previousTime === undefined ? 0 : Math.min(32, time - previousTime)
      previousTime = time
      row!.style.setProperty('--chat-arrival-delay', `${-elapsed}ms`)
      if (!row!.classList.contains('chat-arrival-highlight')) row!.classList.add('chat-arrival-highlight')
      if (elapsed >= 1800) { clear(); onDone?.(); return }
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => { cancelAnimationFrame(frame); clear() }
}
