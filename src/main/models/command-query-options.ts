/** 参数白名单：区分无值开关、带值选项及 -- 后的字面量操作数。 */
export function queryOptions(args: string[], flags: string[], values: string[] = [], operands = true, maxOperands = Infinity): boolean {
  let literal = false
  let operandCount = 0
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (literal) { if (!operands) return false; operandCount++; continue }
    if (argument === '--') { literal = true; continue }
    if (!argument.startsWith('-')) { if (!operands) return false; operandCount++; continue }
    if (flags.includes(argument)) continue
    if (/^-[^-]{2,}$/.test(argument) && [...argument.slice(1)].every(value => flags.includes(`-${value}`) && !values.includes(`-${value}`))) continue
    const equal = argument.indexOf('=')
    if (equal > 0 && values.includes(argument.slice(0, equal)) && argument.slice(equal + 1)) continue
    if (values.includes(argument) && args[index + 1] && !args[index + 1].startsWith('-')) { index++; continue }
    return false
  }
  return operandCount <= maxOperands
}
