import { ModelError } from './model-validation'

/** 批量工具直接调用单项 execute，也必须显式校验分页参数。 */
export function validateReadArgs(input: Record<string, unknown>): void {
  if (typeof input.path !== 'string' || !input.path.trim() || input.path.includes('\0')) throw new ModelError('请提供不包含空字符的确切文件路径')
  for (const key of ['offset', 'limit'] as const) {
    const value = input[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)) throw new ModelError(`${key} 必须是大于等于 1 的安全整数`)
  }
}
