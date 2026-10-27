import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { useSyntaxHighlight } from '../../hooks/useSyntaxHighlight'
import type { SyntaxResult, SyntaxToken } from '../../lib/syntax-types'

export function SyntaxTokens({ tokens }: { tokens: SyntaxToken[] }): ReactNode {
  return tokens.map((token, index) => token.className ? <span key={index} className={token.className}>{token.text}</span> : <Fragment key={index}>{token.text}</Fragment>)
}

/** 行内和多行代码共享着色，原始文本始终作为加载与失败回退；tokens 用于已经有本地结果的命令等文本。 */
export function SyntaxCode({ code, language, inline = false, copyable = false, tokens }: { code: string; language?: string; inline?: boolean; copyable?: boolean; tokens?: SyntaxResult }): React.JSX.Element {
  const highlighted = useSyntaxHighlight({ code: tokens ? '' : code, language, inline })
  const result = tokens ?? highlighted
  const content = result ? result.lines.map((line, index) => <Fragment key={index}><SyntaxTokens tokens={line.tokens} />{line.ending}</Fragment>) : code
  const element = <code className="syntax-code" data-language={result?.language ?? language}>{content}</code>
  if (inline) return element
  return copyable ? <CopyableCodeBlock code={code}><pre>{element}</pre></CopyableCodeBlock> : <pre>{element}</pre>
}

function CopyableCodeBlock({ code, children }: { code: string; children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  useEffect(() => {
    if (status !== 'copied' && status !== 'error') return
    const timer = setTimeout(() => setStatus('idle'), 2000)
    return () => clearTimeout(timer)
  }, [status])

  const copy = async (): Promise<void> => {
    setStatus('copying')
    try {
      await window.piRunner.copyText(code)
      setStatus('copied')
    } catch {
      setStatus('error')
    }
  }
  const label = status === 'copied' ? '已复制' : status === 'error' ? '复制失败，请重试' : '复制内容'
  return <div className="markdown-code-block">
    {children}
    <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={status === 'copying' ? 0 : undefined}><Button type="button" variant="ghost" size="sm" className="markdown-code-copy" aria-label={label} disabled={status === 'copying'} onClick={() => void copy()}>
      {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span role="status" aria-live="polite">{status === 'copied' || status === 'error' ? label : ''}</span>
    </Button></span></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
  </div>
}
