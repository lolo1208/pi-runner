import { useEffect, useState } from 'react'
import { loadSyntax } from '../lib/syntax-worker-client'
import { isInlineFilePath, type SyntaxResult, type SyntaxSource } from '../lib/syntax-types'

export function useSyntaxHighlight({ code, language, path, inline }: SyntaxSource): SyntaxResult | undefined {
  const [highlighted, setHighlighted] = useState<{ key: string; result: SyntaxResult }>()
  const key = JSON.stringify([code, language, path, inline])
  useEffect(() => {
    if (!code || inline && isInlineFilePath(code) || ['text', 'txt', 'plain', 'plaintext'].includes(language?.toLowerCase() ?? '') || typeof Worker === 'undefined') return
    let active = true
    const controller = new AbortController()
    // 流式更新合并到最近一次文本，解析期间原文始终可见。
    const timer = setTimeout(() => {
      void loadSyntax({ code, language, path, inline }, controller.signal).then(result => {
        if (active) setHighlighted({ key, result })
      }).catch(() => { /* 失败时保留原文，不影响消息或文件预览。 */ })
    }, 100)
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [code, language, path, inline, key])
  return highlighted?.key === key ? highlighted.result : undefined
}
