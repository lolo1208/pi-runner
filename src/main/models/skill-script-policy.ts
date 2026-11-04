import path from 'node:path'

/** 仅描述可受信任的技能脚本类型，不单独授予执行权限。 */
export function skillScriptExtension(file: string): boolean {
  return /^(?:|\.(?:[cm]?js|cmd|bat|ps1|sh|bash|zsh|fish|py|rb|pl))$/i.test(path.extname(file))
}

/** 解释器只接受脚本路径和普通参数，不接受 -c、-e 等求值参数。 */
export function skillInterpreterScript(words: string[]): string | undefined {
  if (words.length < 2 || !path.isAbsolute(words[1])) return undefined
  const interpreter = words[0].toLowerCase().replace(/\.exe$/, '')
  const extension = path.extname(words[1]).toLowerCase()
  const types: Record<string, string[]> = {
    node: ['.js', '.mjs', '.cjs'],
    python: ['.py', ''], python3: ['.py', ''],
    ruby: ['.rb', ''], perl: ['.pl', ''],
    sh: ['.sh', ''], bash: ['.sh', '.bash', ''],
    zsh: ['.sh', '.zsh', ''], fish: ['.fish', ''],
  }
  return types[interpreter]?.includes(extension) ? words[1] : undefined
}
