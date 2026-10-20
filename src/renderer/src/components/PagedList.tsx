import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import './paged-list.css'

/** 仅在最近的滚动容器内把元素顶部滚入视野；不用 scrollIntoView，避免连带滚动 overflow:hidden 的弹窗面板（标题会被顶出去且无法滚回）。 */
export function alignTopInScroller(el: HTMLElement): void {
  let scroller: HTMLElement | null = el.parentElement
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
  if (!scroller) { if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', inline: 'nearest' }); return }
  const style = getComputedStyle(scroller)
  const border = parseFloat(style.borderTopWidth) || 0
  const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - border
  scroller.scrollTop = Math.max(0, scroller.scrollTop + offset)
}

/** 限制每次挂载的条目数，翻页替换内容，避免“加载更多”最终仍挂载全部条目。 */
export function PagedList<T>({ items, children, label, resetKey = '', pageSize = 40, page: externalPage, onPageChange }: {
  items: readonly T[]
  children(items: readonly T[]): ReactNode
  label: string
  resetKey?: string
  pageSize?: number
  page?: number
  onPageChange?(page: number): void
}): React.JSX.Element {
  const [selection, setSelection] = useState({ key: resetKey, page: 0 })
  const root = useRef<HTMLDivElement>(null)
  const turning = useRef(false)
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.max(0, Math.min(externalPage ?? (selection.key === resetKey ? selection.page : 0), pages - 1))
  const changePage = (next: number): void => {
    // 弹窗和长页面均将新一页移到可见范围，避免停留在上一页底部。
    turning.current = true
    setSelection({ key: resetKey, page: next })
    onPageChange?.(next)
  }
  useLayoutEffect(() => {
    if (turning.current) { turning.current = false; if (root.current) alignTopInScroller(root.current) }
  })
  return <div ref={root} className="paged-list">
    {children(items.slice(page * pageSize, (page + 1) * pageSize))}
    {pages > 1 && <nav className="list-pagination" aria-label={`${label}分页`}>
      <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => changePage(page - 1)}>上一页</Button>
      <span role="status">{page + 1} / {pages} 页 · 共 {items.length} 项</span>
      <Button type="button" variant="outline" size="sm" disabled={page === pages - 1} onClick={() => changePage(page + 1)}>下一页</Button>
    </nav>}
  </div>
}
