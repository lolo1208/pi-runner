import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { cn } from '../../lib/utils'

export const Tabs = TabsPrimitive.Root

export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: 'default' | 'line' }>(({ className, variant = 'default', ...props }, ref) => (
  <TabsPrimitive.List ref={ref} data-slot="tabs-list" data-variant={variant} className={cn('group/tabs-list inline-flex h-9 items-center justify-center rounded-lg p-1 text-[var(--muted)]', variant === 'default' ? 'bg-[var(--hover)]' : 'rounded-none bg-transparent p-0', className)} {...props} />
))
TabsList.displayName = TabsPrimitive.List.displayName

export const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} data-slot="tabs-trigger" className={cn('relative inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-[var(--surface)] data-[state=active]:text-[var(--text)] data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:py-2 group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[variant=line]/tabs-list:after:bottom-0 group-data-[variant=line]/tabs-list:after:h-0.5 group-data-[variant=line]/tabs-list:after:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:after:bg-[var(--text)]', className)} {...props} />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

export const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} data-slot="tabs-content" className={cn('outline-none', className)} {...props} />
))
TabsContent.displayName = TabsPrimitive.Content.displayName
