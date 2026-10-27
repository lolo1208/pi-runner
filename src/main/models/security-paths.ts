import { realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

export const hiddenData = new Set(['.git', '.pi-runner'])
export const hiddenProjectData = (name: string): boolean => hiddenData.has(name.toLowerCase()) || name.startsWith('.pi-runner-check-')

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
