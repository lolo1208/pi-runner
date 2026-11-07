import { lstat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'
import { validateToolPathSyntax } from './security-paths'
import { validateToolInput } from './tool-inputs'
import { pick, type PromptLang } from '../../shared/prompt-lang'

/** 删除只接受普通文件；逐层检查，避免通过符号链接或目录联接删除其他位置的文件。 */
export async function validateDeleteFile(target: string): Promise<void> {
  validateToolPathSyntax(target)
  target = path.resolve(target)
  let current = target
  while (true) {
    const info = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ModelError('待删除的文件不存在，请先查找并确认具体文件路径')
      throw error
    })
    if (info.isSymbolicLink()) throw new ModelError('删除工具不能访问符号链接或目录联接')
    if (current === target && !info.isFile()) throw new ModelError('删除工具只允许删除普通文件，不能删除目录')
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

export function createDeleteToolDefinition(lang: PromptLang = 'zh'): ToolDefinition {
  return {
    name: 'delete', label: pick(lang, '删除文件', 'Delete file'), executionMode: 'sequential',
    description: pick(lang, '删除一个普通文件，path 必须是确切的相对或绝对路径，不展开通配符。批量删除时先用 find 列出匹配文件，再逐个调用 delete。删除文件必须使用此工具，不要使用终端命令。权限检查及修改前快照由应用执行；不允许删除目录、符号链接或目录联接。', 'Delete a single ordinary file; path must be an exact relative or absolute path, no wildcards. For batch deletion, list matches with find first, then call delete per file. Deleting files must use this tool, not terminal commands. Permission checks and pre-modification snapshots are performed by the app; deleting directories, symlinks, or junctions is not allowed.'),
    parameters: { type: 'object', properties: { path: { type: 'string', minLength: 1, description: pick(lang, '待删除普通文件的确切路径，不支持通配符', 'Exact path of the ordinary file to delete, no wildcards') } }, required: ['path'], additionalProperties: false } as ToolDefinition['parameters'],
    execute: async (_id, args, signal) => {
      const target = validateToolInput('delete', args).path as string
      // 快照或审批可能让执行延后，真正删除前再次检查路径。
      await validateDeleteFile(target)
      signal?.throwIfAborted()
      await unlink(target)
      return { content: [{ type: 'text', text: `已删除文件：${target}` }], details: { path: target } }
    }
  }
}
