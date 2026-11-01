import { clipboard, ClipboardItem, shell } from 'electron'
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { FileAction } from '../shared/api'

const execute = promisify(execFile)

/** 文件通过参数或环境变量传递，避免路径中的引号被当作脚本执行。 */
async function copyFile(file: string): Promise<void> {
  if (process.platform === 'win32') {
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; $files = New-Object System.Collections.Specialized.StringCollection; [void]$files.Add($env:PI_RUNNER_CLIPBOARD_FILE); [System.Windows.Forms.Clipboard]::SetFileDropList($files)"], {
      windowsHide: true, timeout: 10000, env: { ...process.env, PI_RUNNER_CLIPBOARD_FILE: file }
    })
  } else if (process.platform === 'darwin') {
    await execute('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'set the clipboard to POSIX file (item 1 of argv)', '-e', 'end run', file], { timeout: 10000 })
  } else {
    const uri = pathToFileURL(file).href
    await clipboard.write([new ClipboardItem({
      'text/uri-list': new Blob([`${uri}\r\n`], { type: 'text/uri-list' }),
      'electron application/osclipboard;format="x-special/gnome-copied-files"': new Blob([`copy\n${uri}`])
    })])
  }
}

export async function performFileAction(project: string, relativePath: string, action: FileAction): Promise<void> {
  if (!['copy-file', 'copy-path', 'open-directory', 'open-file'].includes(action)) throw new Error('无效的文件操作')
  if (!path.isAbsolute(project) || !relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) throw new Error('文件路径无效')
  const file = path.resolve(project, relativePath)
  const relative = path.relative(project, file)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文件路径必须位于所属项目内')
  if (action === 'copy-path') {
    await clipboard.writeText(file)
    return
  }
  if (action === 'open-directory') {
    const error = await shell.openPath(path.dirname(file))
    if (error) throw new Error('无法打开所在目录，请检查目录是否存在后重试')
    return
  }
  const info = await stat(file).catch(() => { throw new Error('文件不存在或无法访问，请确认文件已恢复到本地后重试') })
  if (!info.isFile() && !info.isDirectory()) throw new Error('所选路径不是文件或目录')
  if (action === 'open-file') {
    const error = await shell.openPath(file)
    if (error) throw new Error('无法打开文件，请检查文件的默认打开方式后重试')
  } else {
    await copyFile(file).catch(() => { throw new Error('复制文件失败，请检查系统剪贴板是否被占用后重试') })
  }
}
