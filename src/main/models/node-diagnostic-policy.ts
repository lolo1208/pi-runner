/** 仅识别固定的包定位/加载诊断，不求值代码。加载项目依赖仍按开发操作保存快照。 */
export function nodePackageDiagnostic(args: string[]): boolean {
  if (args.length !== 2 || !['-e', '--eval'].includes(args[0])) return false
  const code = args[1]
  // 字符串只允许静态包名，不能携带路径、转义、空白或额外代码。
  const strings = code.match(/(['"])[^'"]*\1/g) ?? []
  if (!strings.length || strings.some(value => !/^(['"])(?:@[\w.-]+\/)?[a-zA-Z0-9_][\w.-]*\1$/.test(value))) return false
  const normalized = code.replace(/\s+/g, '').replace(/"/g, "'")
  const module = normalized.match(/require(?:\.resolve)?\('((?:@[\w.-]+\/)?[a-zA-Z0-9_][\w.-]*)'\)/)?.[1]
  if (!module) return false
  const resolve = `console.log(require.resolve('${module}'))`
  const load = `console.log(require('${module}'))`
  return [resolve, `${resolve};`, load, `${load};`,
    `${resolve};try{${load}}catch(e){console.error(e.message);process.exitCode=1}`,
    `${resolve};try{${load};}catch(e){console.error(e.message);process.exitCode=1}`,
  ].includes(normalized.replace(/;$/, ''))
}
