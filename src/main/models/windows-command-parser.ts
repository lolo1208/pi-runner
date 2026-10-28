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
        if (/[;&|<>"'(){}\[\]#]/.test(character)) return undefined
        value += character
      }
    }
    if (!closed || (quote && index < source.length && !/[ \t]/.test(source[index]))) return undefined
    // 逗号数组只支持查询显示中的静态属性名，不能将一般 Shell 数组当作单个参数。
    if (!quote && value.includes(',') && !(process.platform === 'win32'
      && (/^(?:select-object|select|format-table|ft|format-list|fl)$/i.test(tokens[0] ?? '')
        && /^[a-z_][\w.-]*(?:,[a-z_][\w.-]*)+$/i.test(value)
        || /^(?:select-string|sls)$/i.test(tokens[0] ?? '') && tokens.at(-1)?.toLowerCase() === '-context'
        && /^\d+,\d+$/.test(value)))) return undefined
    // npm 的 scoped 包名及 package@version 是字面量；其他 @ 前缀仍可能是 PowerShell splatting。
    if (!quote && value.startsWith('@') && !/^@[\w.-]+\/[\w.-]+(?:@[^\s]+)?$/.test(value)) return undefined
    tokens.push(value)
  }
  return tokens.length && !tokens.includes('--%') ? tokens : undefined
}
