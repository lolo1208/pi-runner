import { useEffect, useRef, type JSX } from 'react'

interface PanelResizerProps {
  className: string
  label: string
  onResize: (clientX: number) => void
  onReset: () => void
}

export function PanelResizer({ className, label, onResize, onReset }: PanelResizerProps): JSX.Element {
  const frame = useRef<number | null>(null)
  const latestX = useRef<number | null>(null)
  const restoreStyles = useRef<(() => void) | null>(null)
  const cancelFrame = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }
  const finish = (): void => {
    cancelFrame()
    if (latestX.current !== null) onResize(latestX.current)
    latestX.current = null
    restoreStyles.current?.()
    restoreStyles.current = null
  }
  useEffect(() => () => {
    cancelFrame()
    restoreStyles.current?.()
  }, [])

  return <div
    className={`panel-resizer ${className}`}
    role="separator"
    aria-label={label}
    aria-orientation="vertical"
    tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const { style } = document.body
      const cursor = style.cursor
      const userSelect = style.userSelect
      style.cursor = 'col-resize'
      style.userSelect = 'none'
      restoreStyles.current = () => {
        style.cursor = cursor
        style.userSelect = userSelect
      }
    }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      latestX.current = event.clientX
      if (frame.current !== null) return
      // 同一帧只处理最后一个位置，避免重复布局和会话组件重渲染。
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        if (latestX.current !== null) onResize(latestX.current)
      })
    }}
    onPointerUp={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      latestX.current = event.clientX
      finish()
      event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onDoubleClick={() => {
      cancelFrame()
      latestX.current = null
      onReset()
    }}
    onPointerCancel={finish}
    onLostPointerCapture={finish}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      onResize(bounds.left + bounds.width / 2 + (event.key === 'ArrowLeft' ? -16 : 16))
    }}
  />
}
