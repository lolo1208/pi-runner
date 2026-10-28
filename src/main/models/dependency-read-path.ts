import path from 'node:path'
import { canonicalToolPath, within } from './security-paths'
import { validateOrdinaryPath } from './filesystem-tools'
import { ModelError } from './model-validation'

/** pnpm 的项目内依赖链接仅用于读取；不放开任意链接、项目外存储或写入。 */
export async function dependencyReadPath(root: string, requested: string): Promise<string> {
  const dependencies = path.join(root, 'node_modules')
  if (!within(dependencies, requested) || requested === dependencies) {
    await validateOrdinaryPath(requested, true)
    return requested
  }
  await validateOrdinaryPath(dependencies, true)
  const resolved = await canonicalToolPath(requested)
  const actualDependencies = await canonicalToolPath(dependencies)
  if (!within(actualDependencies, resolved)) throw new ModelError('依赖读取链接不能指向项目 node_modules 之外')
  await validateOrdinaryPath(resolved, true)
  return resolved
}
