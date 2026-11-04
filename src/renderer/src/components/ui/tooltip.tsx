import * as React from "react"
import { cn } from '@/lib/utils'
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const open = controlledOpen ?? internalOpen
  const changeOpen = React.useCallback((next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }, [controlledOpen, onOpenChange])

  // 在捕获阶段关闭，避免打开弹窗等操作拦截事件后留下提示。
  React.useEffect(() => {
    if (!open) return
    const dismiss = (): void => changeOpen(false)
    const dismissOnKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') dismiss()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('click', dismiss, true)
    document.addEventListener('scroll', dismiss, true)
    document.addEventListener('keydown', dismissOnKey, true)
    document.addEventListener('visibilitychange', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('click', dismiss, true)
      document.removeEventListener('scroll', dismiss, true)
      document.removeEventListener('keydown', dismissOnKey, true)
      document.removeEventListener('visibilitychange', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [open, changeOpen])

  return <TooltipPrimitive.Root data-slot="tooltip" {...props} open={open} onOpenChange={changeOpen} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "ui-tooltip-content z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
