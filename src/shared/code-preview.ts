export interface CodeLineRange { start: number; end: number }
export interface CodeReference { path: string; ranges: CodeLineRange[] }
export interface CodePreview {
  path: string
  totalLines: number
  /** 用于语法解析；快照中未保存的行补为空白，界面只展示 sections 中的片段。 */
  content: string
  sections: { start: number; lines: string[] }[]
  capturedAt?: string
}

/** 收集报告中的定位，供主进程在回复完成时保存代码片段。 */
export function collectCodeReferences(source: string): CodeReference[] {
  return [...source.matchAll(new RegExp(CODE_REFERENCE_SOURCE, 'gu'))].flatMap(match => {
    const parsed = parseCodeReference(match[0])
    return parsed ? [parsed.reference] : []
  })
}

/** 排序并合并相邻定位，限制异常模型输出和 IPC 参数。 */
export function normalizeCodeRanges(input: unknown): CodeLineRange[] {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('代码行号无效')
  const sorted = input.map(range => {
    if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 1 || range.end < range.start) throw new Error('代码行号无效')
    return { start: range.start as number, end: range.end as number }
  }).sort((a, b) => a.start - b.start)
  const result: CodeLineRange[] = []
  for (const range of sorted) {
    const last = result.at(-1)
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end)
    else result.push(range)
  }
  return result
}

// 兼容中文行号及 path:10、path:10–25 等冒号定位。
const LINE_RANGE_SOURCE = String.raw`\d+(?:\s*(?:行\s*)?[-–—~～至到]\s*(?:第\s*)?\d+)?`
export const CODE_REFERENCE_SOURCE = String.raw`(?:\x60\[?|\[\x60?|)?((?:[A-Za-z]:[\\/]|/|\.{1,2}[\\/])?[\p{L}\p{N}_@.+/\\-]+\.[\p{L}\p{N}_-]+?)(?:\]\x60?|\x60\]?|)?(?:\s*第\s*(${LINE_RANGE_SOURCE}(?:\s*(?:行\s*)?[、,，]\s*(?:第\s*)?${LINE_RANGE_SOURCE})*)\s*行|[:：](\d+(?:\s*[-–—~～]\s*\d+)?))(?:\x60\]?|\]\x60?)?`

export function parseCodeReference(source: string): { raw: string; reference: CodeReference } | undefined {
  const match = new RegExp(`^${CODE_REFERENCE_SOURCE}`, 'u').exec(source)
  if (!match) return
  try {
    const ranges = normalizeCodeRanges((match[2] ?? match[3]).split(/[、,，]/).map(part => {
      const [start, end = start] = part.replace(/[第行\s]/g, '').split(/[-–—~～至到]/).map(Number)
      return { start, end }
    }))
    return { raw: match[0], reference: { path: match[1], ranges } }
  } catch { return }
}
