import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** 标题与关闭按钮之间的附加内容（如步骤指示） */
  headingExtra?: ReactNode
  /** 紧邻关闭按钮的操作，也适用于图片灯箱。 */
  closeExtra?: ReactNode
  closeLabel?: string
  closeDisabled?: boolean
  /** 点击遮罩或简易模式面板的空白区域关闭。 */
  closeOnBackdropClick?: boolean
  /** 关闭按钮的附加类名（如绝对定位到内容右上角） */
  closeClassName?: string
  /** 简易模式：不渲染面板标题栏，仅保留无障碍标题和关闭按钮，内容由调用方完全接管（如图片预览灯箱） */
  bare?: boolean
  contentClassName?: string
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
  children: ReactNode
}

/**
 * 通用模态弹窗：统一的背景遮罩、居中面板、标题栏和关闭按钮。
 * 默认点击遮罩不会关闭，可通过 closeOnBackdropClick 启用；Escape 关闭（busy 时可通过 closeDisabled 阻止）。
 */
export function Modal({ open, onOpenChange, title, description, headingExtra, closeExtra, closeLabel = '关闭', closeDisabled = false, closeOnBackdropClick = false, closeClassName, bare = false, contentClassName, onOpenAutoFocus, onCloseAutoFocus, children }: ModalProps): React.JSX.Element {
  const previousElementRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open) previousElementRef.current = document.activeElement as HTMLElement | null
  }, [open])
  const closeButton = <Dialog.Close asChild>
    <Button type="button" variant="ghost" className={`modal-close${closeClassName ? ` ${closeClassName}` : ''}`} disabled={closeDisabled} aria-label={closeLabel}><X size={16} /></Button>
  </Dialog.Close>
  return <Dialog.Root open={open} onOpenChange={next => { if (!next && closeDisabled) return; onOpenChange(next) }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content
        className={`modal-panel${bare ? ' modal-bare' : ''}${contentClassName ? ` ${contentClassName}` : ''}`}
        aria-describedby={description ? undefined : undefined}
        onEscapeKeyDown={event => { if (closeDisabled) event.preventDefault() }}
        onPointerDownOutside={event => { if (!closeOnBackdropClick || closeDisabled) event.preventDefault() }}
        onFocusOutside={event => event.preventDefault()}
        onOpenAutoFocus={onOpenAutoFocus}
        onClick={event => {
          if (bare && closeOnBackdropClick && !closeDisabled && event.target === event.currentTarget) onOpenChange(false)
        }}
        onCloseAutoFocus={event => {
          onCloseAutoFocus?.(event)
          if (!event.defaultPrevented) previousElementRef.current?.focus()
        }}
      >
        {bare ? <>
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {closeExtra}
          {closeButton}
        </> : <>
          <header className="modal-heading">
            <Dialog.Title className="modal-title">{title}</Dialog.Title>
            {headingExtra}
            {closeExtra}
            {closeButton}
          </header>
          {description && <Dialog.Description className="modal-description">{description}</Dialog.Description>}
        </>}
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
