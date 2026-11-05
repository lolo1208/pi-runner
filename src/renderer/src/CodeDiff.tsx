import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DiffFile, disableCache } from '@git-diff-view/core'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import { Button } from '@/components/ui/button'
import { alignTopInScroller } from './components/PagedList'
import { loadPreparedDiff } from './lib/diff-worker-client'
import type { DiffSource, DiffStats, PreparedDiff } from './lib/diff-processing'
import './components/paged-list.css'

disableCache()

export interface CodeDiffProps extends DiffSource {
  mode: 'unified' | 'split'
  theme: 'light' | 'dark'
  onStats?(stats: DiffStats): void
}

/** 使用库默认的行底色、增删符号、词级高亮和上下文展开控件。 */
export default function CodeDiff({ path, before, after, hunks, mode, theme, onStats }: CodeDiffProps): React.JSX.Element {
  const [result, setResult] = useState<PreparedDiff>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selectedPage, setPage] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const turning = useRef(false)
  const changePage = (next: number): void => { turning.current = true; setPage(next) }
  useLayoutEffect(() => {
    if (turning.current) { turning.current = false; if (root.current) alignTopInScroller(root.current) }
  })
  const statsCallback = useRef(onStats)
  statsCallback.current = onStats
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setResult(undefined)
    setError('')
    setPage(null)
    void loadPreparedDiff({ path, before, after, hunks }, theme, controller.signal).then(value => {
      if (!active) return
      setResult(value)
      statsCallback.current?.(value.stats)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '文件对比加载失败') })
    return () => { active = false; controller.abort() }
  }, [path, before, after, hunks, theme, retry])
  const lineCount = result ? mode === 'split' ? result.bundle.splitLineLength : result.bundle.unifiedLineLength : 0
  const paginated = lineCount > 1000
  const pages = Math.max(1, Math.ceil(lineCount / 200))
  const firstVisible = useMemo(() => {
    if (!result || !paginated) return 0
    const bundle = result.bundle
    const index = mode === 'unified' ? bundle.unifiedLines.findIndex(line => !line.isHidden)
      : bundle.splitLeftLines.findIndex((line, offset) => !line.isHidden || !bundle.splitRightLines[offset]?.isHidden)
    return Math.floor(Math.max(0, index) / 200)
  }, [result, mode, paginated])
  const page = Math.min(selectedPage ?? firstVisible, pages - 1)
  const file = useMemo(() => {
    if (!result) return undefined
    if (!paginated) return DiffFile.createInstance({}, result.bundle)
    // 保留完整文件的行号、高亮和总统计，仅将当前页的对比行交给库挂载。
    // 大文件的未改动上下文也可翻页查看，避免库的“展开全部”重新挂载整个文件。
    const bundle = result.bundle
    const start = page * 200, end = start + 200
    const left = bundle.splitLeftLines.slice(start, end).map(line => ({ ...line, isHidden: false }))
    const right = bundle.splitRightLines.slice(start, end).map(line => ({ ...line, isHidden: false }))
    const unified = bundle.unifiedLines.slice(start, end).map(line => ({ ...line, isHidden: false }))
    return DiffFile.createInstance({}, { ...bundle, composeByRange: true, splitHunkLines: {}, unifiedHunkLines: {}, splitLeftLines: left, splitRightLines: right, splitLineLength: left.length, unifiedLines: unified, unifiedLineLength: unified.length })
  }, [result, paginated, page])
  useEffect(() => () => { file?._destroy() }, [file])
  if (error) return <div className="tool-approval-preview-state" role="alert">{error}<Button variant="outline" onClick={() => setRetry(value => value + 1)}>重试</Button></div>
  if (!file) return <div className="tool-approval-preview-state" role="status">正在准备文件对比…</div>
  if (result?.stats.added === 0 && result.stats.removed === 0) return <div className="tool-approval-preview-state">文件内容没有变化</div>
  return <div ref={root}>
    <DiffView diffFile={file} diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified} diffViewTheme={theme} diffViewHighlight diffViewFontSize={12} diffViewAddWidget={false} />
    {paginated && <nav className="list-pagination" aria-label="文件内容分页">
      <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => changePage(0)}>首页</Button>
      <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => changePage(page - 1)}>上一页</Button>
      <span role="status">{page + 1} / {pages} 页 · 含未改动上下文</span>
      <Button type="button" variant="outline" size="sm" disabled={page === pages - 1} onClick={() => changePage(page + 1)}>下一页</Button>
      <Button type="button" variant="outline" size="sm" disabled={page === pages - 1} onClick={() => changePage(pages - 1)}>末页</Button>
    </nav>}
  </div>
}
