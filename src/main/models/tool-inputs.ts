import { asRecord, ModelError } from './model-validation'
import { validateToolPathSyntax } from './security-paths'

/** execute 也可由批量工具直接调用，不依赖外部 SDK 代为校验。 */
export function validateToolInput(name: string, value: unknown): Record<string, unknown> {
  const input = asRecord(value)
  if (['bash', 'powershell'].includes(name)) {
    if (typeof input.command !== 'string' || !input.command.trim() || input.command.includes('\0') || input.command.length > 64000) throw new ModelError('command 必须是 1–64000 字符且不包含空字符的命令')
    if (input.timeout !== undefined && (typeof input.timeout !== 'number' || !Number.isFinite(input.timeout) || input.timeout <= 0 || input.timeout > 86400)) throw new ModelError('timeout 必须是大于 0 且不超过 86400 的秒数')
    return input
  }
  const optionalPath = ['ls', 'find', 'grep'].includes(name)
  if (input.path === undefined && optionalPath) input.path = '.'
  if (typeof input.path !== 'string') throw new ModelError('请提供确切的文件或目录路径')
  validateToolPathSyntax(input.path)
  if (['move', 'copy'].includes(name)) {
    if (typeof input.destination !== 'string') throw new ModelError('请提供确切的目标路径')
    validateToolPathSyntax(input.destination)
  }
  if (input.recursive !== undefined && typeof input.recursive !== 'boolean') throw new ModelError('recursive 必须是布尔值，删除非空目录必须显式传入 true')
  if (['ls', 'find', 'grep'].includes(name)) {
    if (input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000)) throw new ModelError('limit 必须是 1–1000 的整数')
  }
  if (['find', 'grep'].includes(name)) {
    if (typeof input.pattern !== 'string' || !input.pattern.length || input.pattern.length > 4096 || input.pattern.includes('\0')) throw new ModelError('pattern 必须是 1–4096 字符且不包含空字符的搜索模式')
    if (input.glob !== undefined && (typeof input.glob !== 'string' || !input.glob.length || input.glob.length > 4096)) throw new ModelError('glob 必须是 1–4096 字符的匹配模式')
    for (const key of ['literal', 'ignoreCase']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new ModelError(`${key} 必须是布尔值`)
    if (input.context !== undefined && (typeof input.context !== 'number' || !Number.isSafeInteger(input.context) || input.context < 0 || input.context > 10)) throw new ModelError('context 必须是 0–10 的整数')
  }
  return input
}
