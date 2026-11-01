import * as React from 'react'
import { cn } from '@/lib/utils'

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>): React.JSX.Element {
  return <kbd data-slot="kbd" className={cn('pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm bg-[var(--surface)] px-1 font-sans text-xs font-medium text-[var(--muted)] [&_svg:not([class*=\'size-\'])]:size-3', className)} {...props} />
}
