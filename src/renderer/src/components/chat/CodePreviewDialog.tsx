import { useEffect, useMemo, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { FileCode2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { CodePreview, CodeReference } from '../../../../shared/code-preview'
import { useSyntaxHighlight } from '../../hooks/useSyntaxHighlight'
import { SyntaxTokens } from './SyntaxCode'

export function CodePreviewDialog({ project, reference, snapshotId, onClose }: { project: string; reference: CodeReference; snapshotId?: string; onClose(): void }): React.JSX.Element {
  const [preview, setPreview] = useState<CodePreview>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const highlighted = useSyntaxHighlight({ code: preview?.content ?? '', path: preview?.path ?? reference.path })
  const rows = useMemo(() => preview?.sections.flatMap((section, index) => [
    ...(index ? [{ number: 0, line: `省略第 ${preview.sections[index - 1].start + preview.sections[index - 1].lines.length}–${section.start - 1} 行` }] : []),
    ...section.lines.map((line, offset) => ({ number: section.start + offset, line }))
  ]) ?? [], [preview])
  const renderLine = (number: number, line: string): React.JSX.Element => {
    const selected = reference.ranges.some(range => number >= range.start && number <= range.end)
    const tokens = highlighted?.lines[number - 1]?.tokens
    return <span key={number} className={`code-preview-line${selected ? ' is-selected' : ''}`} data-line={number} aria-label={selected ? `第 ${number} 行，代码定位` : undefined}><span className="code-preview-number" aria-hidden="true">{number}</span><span>{tokens?.length ? <SyntaxTokens tokens={tokens} /> : line || ' '}</span>{'\n'}</span>
  }
  useEffect(() => {
    let active = true
    setError('')
    setPreview(undefined)
    const request = snapshotId
      ? window.piRunner.readCodePreview(project, reference.path, reference.ranges, snapshotId)
      : window.piRunner.readCodePreview(project, reference.path, reference.ranges)
    void request.then(value => {
      if (active) setPreview(value)
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : '代码加载失败，请重试')
    })
    return () => { active = false }
  }, [project, reference, snapshotId, retry])
  const lineLabel = reference.ranges.map(range => range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`).join('、')
  return <Modal open onOpenChange={open => { if (!open) onClose() }} closeOnBackdropClick title={<span className="code-preview-title"><FileCode2 size={18} aria-hidden="true" /><span>{reference.path}</span></span>} description={`第 ${lineLabel} 行 · ${snapshotId ? '审查时代码快照' : '实时文件内容'}`} contentClassName="code-preview-dialog">
    {error ? <div className="code-preview-state" role="alert"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>重试</Button></div>
      : !preview ? <div className="code-preview-state" role="status">正在加载代码…</div>
        : rows.length > 200 ? <Virtuoso className="code-preview-scroll" tabIndex={0} aria-label="代码预览" data={rows} defaultItemHeight={22} increaseViewportBy={200}
          computeItemKey={(_, row) => row.number || row.line}
          itemContent={(_, row) => row.number ? <pre className="code-preview-lines code-preview-virtual-line"><code className="syntax-code" data-language={highlighted?.language}>{renderLine(row.number, row.line)}</code></pre> : <div className="code-preview-gap">{row.line}</div>}
        /> : <div className="code-preview-scroll" tabIndex={0} aria-label="代码预览">
          {preview.sections.map((section, index) => <section key={section.start} aria-label={`第 ${section.start}–${section.start + section.lines.length - 1} 行`}>
            {index > 0 && <div className="code-preview-gap">省略第 {preview.sections[index - 1].start + preview.sections[index - 1].lines.length}–{section.start - 1} 行</div>}
            <pre className="code-preview-lines"><code className="syntax-code" data-language={highlighted?.language}>{section.lines.map((line, offset) => {
              return renderLine(section.start + offset, line)
            })}</code></pre>
          </section>)}
        </div>}
  </Modal>
}
