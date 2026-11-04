import { useId, useMemo } from 'react'
import { Lexer, Marked } from 'marked'
import { CODE_REFERENCE_SOURCE, parseCodeReference, type CodeReference } from '../../../../shared/code-preview'
import { PlanContent } from './PlanContent'
import { CodePreviewDialog } from './CodePreviewDialog'
import { useTranscriptOverlay } from './TranscriptState'

const referenceMarkdown = new Marked({ gfm: true }).use({ extensions: [{
  name: 'codeReference', level: 'inline',
  start(source) { return new RegExp(CODE_REFERENCE_SOURCE, 'u').exec(source)?.index },
  tokenizer(source) {
    const parsed = parseCodeReference(source)
    if (parsed) return { type: 'codeReference', raw: parsed.raw, reference: parsed.reference, label: parsed.raw.slice(parsed.raw.indexOf(parsed.reference.path) + parsed.reference.path.length).replace(/^[`\]]+|[`\]]+$/g, '') }
  }
}] })

/** 复用计划正文的安全渲染方式，模型输出中的 HTML 仅作为文字显示。 */
export function ChatMarkdown({ content, project, snapshotId }: { content: string; project?: string | null; snapshotId?: string }): React.JSX.Element {
  const prefix = useId()
  const tokens = useMemo(() => project ? referenceMarkdown.lexer(content) : Lexer.lex(content, { gfm: true }), [content, project])
  const { showOverlay, overlay } = useTranscriptOverlay()
  const preview = (reference: CodeReference): void => {
    if (project) showOverlay(close => <CodePreviewDialog project={project} reference={reference} snapshotId={snapshotId} onClose={close} />)
  }
  return <>
    <PlanContent tokens={tokens} className="plan-document chat-markdown" prefix={prefix} onCodeReference={project && snapshotId !== 'pending' ? preview : undefined} />
    {overlay}
  </>
}
