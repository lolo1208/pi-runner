import { Fragment, createElement, type ReactNode } from 'react'
import { Lexer, type Token, type Tokens } from 'marked'
import type { CodeReference } from '../../../../shared/code-preview'
import { SyntaxCode } from './SyntaxCode'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface PlanSection { id: string; text: string }
export function parsePlan(content: string): { tokens: Token[]; sections: PlanSection[] } {
  const tokens = Lexer.lex(content, { gfm: true })
  const sections = tokens.flatMap((token, index) => token.type === 'heading'
    ? [{ id: `plan-section-${index}`, text: plainText((token as Tokens.Heading).tokens) }] : [])
  return { tokens, sections }
}

function plainText(tokens: Token[]): string {
  return tokens.map(token => 'tokens' in token && token.tokens ? plainText(token.tokens) : 'text' in token ? String(token.text ?? '') : '').join('')
}

function safeHref(href: string): string | undefined {
  return /^(?:https?:\/\/|mailto:|#)/i.test(href.trim()) ? href : undefined
}

/** 用 React 元素呈现解析结果，模型正文中的 HTML 不作为可执行内容注入页面。 */
function renderTokens(tokens: Token[], prefix = 'plan', onCodeReference?: (reference: CodeReference) => void): ReactNode {
  return tokens.map((token, index) => {
    const key = `${prefix}-${index}`
    const children = 'tokens' in token && token.tokens ? renderTokens(token.tokens, key, token.type === 'link' ? undefined : onCodeReference) : 'text' in token ? String(token.text ?? '') : ''
    switch (token.type) {
      case 'codeReference': {
        const reference = token.reference as CodeReference
        return onCodeReference ? <Tooltip key={key}><TooltipTrigger asChild><button type="button" className="code-reference" onClick={() => onCodeReference(reference)}><code>{reference.path}</code><span>{String(token.label)}</span></button></TooltipTrigger><TooltipContent>查看代码及前后 10 行</TooltipContent></Tooltip> : <Fragment key={key}>{token.raw}</Fragment>
      }
      case 'space': case 'def': return null
      case 'heading': return createElement(`h${(token as Tokens.Heading).depth}`, { key, id: `${prefix}-section-${index}` }, children)
      case 'paragraph': return <p key={key}>{children}</p>
      case 'text': case 'escape': return <Fragment key={key}>{children}</Fragment>
      case 'strong': return <strong key={key}>{children}</strong>
      case 'em': return <em key={key}>{children}</em>
      case 'del': return <del key={key}>{children}</del>
      case 'codespan': return <SyntaxCode key={key} code={token.text} inline />
      case 'code': return <SyntaxCode key={key} code={token.text} language={(token as Tokens.Code).lang} copyable={(token as Tokens.Code).codeBlockStyle !== 'indented'} />
      case 'br': return <br key={key} />
      case 'hr': return <hr key={key} />
      case 'blockquote': return <blockquote key={key}>{children}</blockquote>
      case 'link': {
        const link = token as Tokens.Link
        const href = safeHref(link.href)
        return href ? <a key={key} href={href} title={link.title ?? undefined} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a> : <Fragment key={key}>{children}</Fragment>
      }
      case 'image': return <span key={key}>{(token as Tokens.Image).text}</span>
      case 'list': {
        const list = token as Tokens.List
        const items = list.items.map((item, itemIndex) => <li key={itemIndex}>{item.task && <input type="checkbox" checked={!!item.checked} disabled aria-label={plainText(item.tokens)} />}{renderTokens(item.tokens, `${key}-${itemIndex}`, onCodeReference)}</li>)
        return list.ordered ? <ol key={key} start={typeof list.start === 'number' ? list.start : undefined}>{items}</ol> : <ul key={key}>{items}</ul>
      }
      case 'table': {
        const table = token as Tokens.Table
        return <div className="plan-table" key={key}><table><thead><tr>{table.header.map((cell, cellIndex) => <th key={cellIndex} style={{ textAlign: cell.align ?? undefined }}>{renderTokens(cell.tokens, `${key}-header-${cellIndex}`, onCodeReference)}</th>)}</tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} style={{ textAlign: cell.align ?? undefined }}>{renderTokens(cell.tokens, `${key}-${rowIndex}-${cellIndex}`, onCodeReference)}</td>)}</tr>)}</tbody></table></div>
      }
      case 'html': return <Fragment key={key}>{token.text}</Fragment>
      default: return <Fragment key={key}>{children}</Fragment>
    }
  })
}

export function PlanContent({ tokens, className = 'plan-document', prefix = 'plan', onCodeReference }: { tokens: Token[]; className?: string; prefix?: string; onCodeReference?: (reference: CodeReference) => void }): React.JSX.Element {
  return <div className={className}>{renderTokens(tokens, prefix, onCodeReference)}</div>
}
