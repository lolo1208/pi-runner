import * as React from 'react'
import { cn } from '../../lib/utils'

export function Table({ className, ...props }: React.ComponentProps<'table'>): React.JSX.Element {
  return <div data-slot="table-container" className="relative w-full overflow-x-auto"><table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} /></div>
}
export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>): React.JSX.Element {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
}
export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>): React.JSX.Element {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}
export function TableRow({ className, ...props }: React.ComponentProps<'tr'>): React.JSX.Element {
  return <tr data-slot="table-row" className={cn('border-b transition-colors hover:bg-[var(--surface)]', className)} {...props} />
}
export function TableHead({ className, ...props }: React.ComponentProps<'th'>): React.JSX.Element {
  return <th data-slot="table-head" className={cn('h-10 px-2 text-left align-middle font-medium whitespace-nowrap', className)} {...props} />
}
export function TableCell({ className, ...props }: React.ComponentProps<'td'>): React.JSX.Element {
  return <td data-slot="table-cell" className={cn('p-2 align-middle whitespace-nowrap', className)} {...props} />
}
