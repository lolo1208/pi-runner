import { realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ModelError } from './model-validation'

/** 所有文件工具共用，防止 Windows 设备路径、数据流及路径别名绕过边界检查。 */
export function validateToolPathSyntax(target: string): void {
  if (typeof target !== 'string' || !target.trim() || target.includes('\0')) throw new ModelError('请提供不包含空字符的确切路径')
  if (process.platform !== 'win32') return
  if (/^(?:\\\\[.?]\\|\\\?\?\\)/.test(target)) throw new ModelError('文件工具不支持 Windows 设备命名空间路径')
  const resolved = path.resolve(target)
  const parts = resolved.slice(path.parse(resolved).root.length).split(/[\\/]/)
  if (parts.some(part => /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part.split('.')[0].replace(/[ .]+$/, '')))) {
    throw new ModelError('文件路径不能包含 Windows 设备名、数据流、通配符或末尾空格和句点')
  }
}

/** 判断 target 是否位于 root 内（跨平台防逃逸）。 */
export function within(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** 对不存在的文件也解析最近的已有父目录，防止通过链接目标绕过审批。 */
export async function canonicalToolPath(target: string): Promise<string> {
  try { return await realpath(target) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    if (parent === target) return target
    return path.join(await canonicalToolPath(parent), path.basename(target))
  }
}

export const hiddenData = new Set(['.git', '.pi-runner', '.pi-runner-dev'])
export const hiddenProjectData = (name: string): boolean => hiddenData.has(name.toLowerCase()) || name.toLowerCase().startsWith('.pi-runner-check-')

/** 即使当前用户可读，也不允许 Agent 读取的高危凭证目录。 */
export function credentialBlacklist(): string[] {
  const home = os.homedir()
  return [
    path.join(home, '.ssh'),
    path.join(home, '.aws'),
    path.join(home, '.gnupg'),
    path.join(home, '.azure'),
    path.join(home, '.kube')
  ].map(value => path.resolve(value))
}
