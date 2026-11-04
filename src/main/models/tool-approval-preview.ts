import { open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { validateOrdinaryPath } from './filesystem-tools'
import { validateTextMutationTarget } from './text-mutation-tools'
import { createEditToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ToolApproval, ToolApprovalPreview } from '../../shared/models'
import { ModelError } from './model-validation'

const limit = 512 * 1024

/** 只读取待审批操作已校验的文件；编辑预览复用 SDK 的匹配规则，写入留在内存。 */
export async function toolApprovalPreview(approval: ToolApproval): Promise<ToolApprovalPreview> {
  if (!['edit', 'write'].includes(approval.tool) || typeof approval.args.path !== 'string') throw new ModelError('此操作没有可预览的文件修改')
  const target = approval.args.path
  let before = ''
  try {
    await validateOrdinaryPath(target)
    await validateTextMutationTarget(target)
    if (await realpath(target) !== target) throw new ModelError('目标路径已变化，请重新请求操作')
    const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const info = await file.stat()
      if (!info.isFile()) throw new ModelError('只能预览普通文件')
      if (info.size > limit) throw new ModelError('文件超过 512 KiB，无法显示完整对比')
      const buffer = Buffer.alloc(limit + 1)
      let size = 0
      while (size < buffer.length) { const read = await file.read(buffer, size, buffer.length - size, size); if (!read.bytesRead) break; size += read.bytesRead }
      if (size > limit) throw new ModelError('文件超过 512 KiB，无法显示完整对比')
      if (buffer.subarray(0, size).includes(0)) throw new ModelError('二进制文件无法显示文本对比')
      before = buffer.subarray(0, size).toString('utf8')
    } finally { await file.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || approval.tool !== 'write') {
      if (error instanceof ModelError) throw error
      throw new ModelError('无法读取待修改文件，请检查文件是否存在及访问权限')
    }
  }
  let after = ''
  if (approval.tool === 'write') after = String(approval.args.content ?? '')
  else {
    const tool = createEditToolDefinition(approval.cwd, { operations: {
      readFile: async () => Buffer.from(before), access: async () => {}, writeFile: async (_path, content) => { after = content }
    } })
    try { await tool.execute('preview', structuredClone(approval.args) as never, undefined, undefined, undefined as never) }
    catch { throw new ModelError('无法应用拟修改内容；文件可能已变化，建议拒绝并重新生成修改') }
  }
  if (Buffer.byteLength(after) > limit) throw new ModelError('拟修改内容超过 512 KiB，无法显示完整对比')
  return { before, after, path: target }
}
