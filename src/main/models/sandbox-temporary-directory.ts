import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ModelError } from './model-validation'

/** 只删除本应用分配的普通目录；目录被替换为链接时保留现场。 */
export async function removeSandboxTemporaryDirectory(directory: string, prefix: string): Promise<void> {
  if (!path.isAbsolute(directory) || path.parse(directory).root === directory || !path.basename(directory).startsWith(prefix)) throw new ModelError(`临时目录清理边界无效：${directory}`)
  const actual = await realpath(directory).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
  if (!actual) return
  if (actual !== directory) throw new ModelError(`临时目录已被重定向，停止清理：${directory}`)
  await rm(directory, { recursive: true, force: true })
}

/** 每次分配新目录；拒绝把命令写入区放到应用保护目录内。 */
export async function createSandboxTemporaryDirectory(prefix: string, protectedDirectories: string[] = []): Promise<string> {
  const temporary = os.tmpdir()
  let directory: string | undefined
  try {
    const parent = await realpath(temporary)
    for (const entry of protectedDirectories) {
      const protectedRoot = await realpath(entry).catch(error => { if (error.code === 'ENOENT') return path.resolve(entry); throw error })
      const relative = path.relative(protectedRoot, parent)
      if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
        throw new Error(`临时目录位于应用保护目录内：${protectedRoot}`)
      }
    }
    directory = await mkdtemp(path.join(parent, prefix))
    if (await realpath(directory) !== directory) throw new Error('新临时目录发生重定向')
    const file = path.join(directory, 'write-check.txt')
    await writeFile(file, 'pi-runner', { flag: 'wx' })
    if (await readFile(file, 'utf8') !== 'pi-runner') throw new Error('临时文件读写结果不一致')
    await rm(file)
    return directory
  } catch (error) {
    if (directory) await removeSandboxTemporaryDirectory(directory, prefix).catch(() => {})
    throw new ModelError(`无法准备沙箱临时目录 ${temporary}：${error instanceof Error ? error.message : String(error)}。请检查 TEMP、TMP 与该目录的访问权限`)
  }
}
