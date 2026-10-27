/** 保守解析完整的单条 PowerShell 字面量命令，不执行脚本或展开表达式。 */
export function literalCommand(command: string): string[] | undefined {
  if (!command.trim() || command.length > 16000 || /[\r\n`$\0]/.test(command)) return undefined
  const source = command.trim().replace(/^&[ \t]+/, '')
  const tokens: string[] = []
  let index = 0
  while (index < source.length) {
    while (/[ \t]/.test(source[index] ?? '') && index < source.length) index++
    if (index === source.length) break
    const quote = source[index] === "'" || source[index] === '"' ? source[index++] : undefined
    let value = '', closed = !quote
    while (index < source.length) {
      const character = source[index++]
      if (quote) {
        if (character === quote) {
          if (quote === "'" && source[index] === "'") { value += "'"; index++; continue }
          closed = true; break
        }
        value += character
      } else {
        if (/[ \t]/.test(character)) break
        if (/[;&|<>"'(){}\[\]@,#]/.test(character)) return undefined
        value += character
      }
    }
    if (!closed || (quote && index < source.length && !/[ \t]/.test(source[index]))) return undefined
    tokens.push(value)
  }
  return tokens.length && !tokens.includes('--%') ? tokens : undefined
}
