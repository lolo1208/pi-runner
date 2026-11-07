import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createEditToolDefinition, createWriteToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { ModelError } from './model-validation'
import { validateOrdinaryPath } from './filesystem-tools'

import { FileMutationUncertain } from './tool-execution-errors'
import { validateToolPathSyntax } from './security-paths'
import { pick, type PromptLang } from '../../shared/prompt-lang'
export { FileMutationUncertain, FileSnapshotStopped } from './tool-execution-errors'
export { validateToolPathSyntax as validateMutationPathSyntax } from './security-paths'

/** 单项和批量入口共用参数校验，避免直接调用 execute 时绕过 schema。 */
export function validateTextMutationInput(name: string, input: Record<string, unknown>): void {
  if (typeof input.path !== 'string' || !input.path.trim() || input.path.includes('\0')) throw new ModelError('请提供不包含空字符的确切文件路径')
  if (name === 'write' && (typeof input.content !== 'string' || input.content.includes('\0'))) throw new ModelError('content 必须是不包含空字符的文本字符串；二进制文件请使用 download')
  if (name === 'edit' && (!Array.isArray(input.edits) || !input.edits.length || input.edits.some(edit => !edit || typeof edit !== 'object' || Array.isArray(edit) || typeof edit.oldText !== 'string' || !edit.oldText.length || typeof edit.newText !== 'string' || edit.oldText.includes('\0') || edit.newText.includes('\0')))) {
    throw new ModelError('edits 必须包含至少一项文本替换；oldText 必须非空，newText 必须是字符串，均不可包含空字符')
  }
}

/** 禁止硬链接让不同输入意外修改同一个或项目外的文件。 */
export async function validateTextMutationTarget(target: string): Promise<void> {
  validateToolPathSyntax(target)
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (info && (!info.isFile() || info.nlink > 1)) throw new ModelError('写入和编辑只允许普通文件，不允许目录、链接或多重硬链接文件')
}

/** 在真正写入的边界跟踪状态，不依赖异常文案或 errno 猜测文件是否已经改变。 */
export function textMutationToolDefinitions(root: string, protectPath: (target: string) => Promise<void>, lang: PromptLang = 'zh'): ToolDefinition<any, any, any>[] {
  return ['write', 'edit'].map(name => {
    const base: ToolDefinition<any, any, any> = name === 'write' ? createWriteToolDefinition(root) : createEditToolDefinition(root)
    return { ...base,
      description: name === 'write'
        ? pick(lang, '创建或完整覆盖 UTF-8 文本文件，自动创建父目录；局部修改用 edit，多个文件优先 write_many。仅允许普通文件，不写图片或二进制内容；已有文件会被覆盖。', 'Create or fully overwrite a UTF-8 text file, creating parent directories automatically; use edit for partial changes, prefer write_many for multiple files. Ordinary files only; do not write image or binary content; existing files are overwritten.')
        : pick(lang, '精确替换单个文本文件，多文件优先 edit_many。每项 oldText 必须在修改前的原文件中唯一匹配；各项区域不可重叠，且均针对修改前的原文件匹配（不按 edits 顺序累积）。相邻或同块修改合并，不为连接远处改动夹入大段无关文本。全部匹配校验通过才保存。', 'Precisely replace in a single text file; prefer edit_many for multiple files. Each oldText must match uniquely in the original file before modification; regions must not overlap, and each is matched against the original file (matched against the original file, not applied sequentially). Merge adjacent or same-block changes; do not pad with large unrelated text to connect distant changes. Save only after all matches validate.'),
      execute: async (id, args, signal, update, context) => {
      let writeStarted = false
      const trackedWrite = async (target: string, content: string): Promise<void> => {
        await validateOrdinaryPath(target)
        await validateTextMutationTarget(target)
        await protectPath(target)
        signal?.throwIfAborted()
        writeStarted = true
        await writeFile(target, content, 'utf8')
      }
      const tool: ToolDefinition<any, any, any> = name === 'write'
        ? createWriteToolDefinition(root, { operations: {
          mkdir: async directory => {
            await validateOrdinaryPath(directory)
            await protectPath(directory)
            signal?.throwIfAborted()
            try {
              const created = await mkdir(directory, { recursive: true })
              if (created !== undefined) writeStarted = true
            } catch (error) {
              // recursive mkdir 可能先创建了部分父目录才失败。
              writeStarted = true
              throw error
            }
          },
          writeFile: trackedWrite
        } })
        : createEditToolDefinition(root, { operations: {
          access: target => access(target, constants.R_OK | constants.W_OK),
          readFile: async target => {
            await validateOrdinaryPath(target, true)
            await validateTextMutationTarget(target)
            await protectPath(target)
            return readFile(target)
          },
          writeFile: trackedWrite
        } })
      try { return await tool.execute(id, args, signal, update, context) }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (writeStarted) throw new FileMutationUncertain(`文件或父目录可能已改变，请先读取或用 stat 核对：${message}`)
        throw new ModelError(message)
      }
    } } satisfies ToolDefinition<any, any, any>
  })
}
