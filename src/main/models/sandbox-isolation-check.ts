import { SANDBOX_CHECKS } from '../../shared/sandbox'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, realpath, rm, rmdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TerminalSandbox } from './terminal-sandbox'
import { ModelError } from './model-validation'
import { createSandboxCheckWorkspace } from './sandbox-check-workspace'

const literal = (value: string): string => "'" + value.replace(/'/g, "''") + "'"
// PowerShell 会包装 .NET 异常；只有明确的权限异常才证明边界生效。
const denied = (marker: string): string => `$denied=$_.Exception; while ($denied -and -not ($denied -is [UnauthorizedAccessException]) -and -not ($denied -is [Security.SecurityException])) { $denied=$denied.InnerException }; if (-not $denied) { throw }; Write-Output '${marker}'`
/** 从真实项目启动隔离进程，校验项目读写与两个外部边界，不信任磁盘上的通过标记。 */
export async function checkCachedSandboxIsolation(sandbox: TerminalSandbox, project: string, dataDirectory: string, signal: AbortSignal): Promise<void> {
  const workspace = await createSandboxCheckWorkspace()
  const { outside } = workspace
  const outsideFile = path.join(outside, 'outside.txt'), privateFile = path.join(dataDirectory, `isolation-check-${randomUUID()}.txt`)
  const token = randomUUID(), temporary = path.join(project, '.tmp')
  const probe = path.join(temporary, `pi-runner-check-${randomUUID()}`), file = path.join(probe, 'probe.txt')
  let created = false, createdTemporary = false, createdProbe = false
  try {
    await sandbox.prepare(project, signal)
    // 必须验证真实项目的写权限；探针只放在明确的临时目录中，不跟随已有链接。
    createdTemporary = await mkdir(temporary, { recursive: true }) !== undefined
    if (await realpath(temporary) !== temporary) throw new ModelError('项目临时目录发生重定向，停止边界校验')
    await mkdir(probe); createdProbe = true
    await writeFile(file, 'probe', { flag: 'wx' }); created = true
    await mkdir(dataDirectory, { recursive: true })
    await writeFile(outsideFile, token); await writeFile(privateFile, token)
    const blocked = (command: string): string => `try { ${command}; exit 23 } catch { ${denied('ACCESS_BLOCKED')} }`
    const command = `[IO.File]::WriteAllText(${literal(file)},'ok'); if ([IO.File]::ReadAllText(${literal(file)}) -ne 'ok') { exit 24 }; [IO.File]::Delete(${literal(file)}); ${blocked(`[IO.File]::ReadAllText(${literal(outsideFile)}) | Out-Null`)}; ${blocked(`[IO.File]::WriteAllText(${literal(outsideFile)},'unexpected')`)}; ${blocked(`[IO.File]::ReadAllText(${literal(privateFile)}) | Out-Null`)}; Write-Output '${token}'`
    let output = ''
    const result = await sandbox.exec(command, project, { signal, timeout: 20, onData: data => { output = (output + data.toString('utf8')).slice(-8000) } })
    if (result.exitCode !== 0 || !output.includes(token) || await readFile(outsideFile, 'utf8') !== token) throw new ModelError('已有隔离环境未通过快速边界校验，请重新检测')
  } finally {
    try {
      await Promise.all([workspace.cleanup(), rm(privateFile, { force: true }), ...(created ? [rm(file, { force: true })] : [])])
    } finally {
      // 仅删除空目录，保留检测期间其他进程写入的内容以及原有 .tmp。
      for (const directory of [...(createdProbe ? [probe] : []), ...(createdTemporary ? [temporary] : [])]) {
        await rmdir(directory).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error })
      }
    }
  }
}
/** 所有探针只接触本次创建的测试文件；拒绝必须有来自隔离进程的明确标记。 */
export async function checkSandboxIsolation(sandbox: TerminalSandbox, _project: string, dataDirectory: string, signal: AbortSignal, check: (id: string, label: string, action: () => Promise<void>) => Promise<void>): Promise<void> {
  const workspace = await createSandboxCheckWorkspace()
  const { project: projectProbe, outside } = workspace
  const privateFile = path.join(dataDirectory, `isolation-check-${randomUUID()}.txt`)
  const outsideFile = path.join(outside, 'outside.txt')
  const token = randomUUID()
  try {
    await sandbox.prepare(projectProbe, signal)
    await mkdir(dataDirectory, { recursive: true })
    await writeFile(outsideFile, token); await writeFile(privateFile, token)
    const run = async (command: string, marker: string): Promise<void> => {
      signal.throwIfAborted()
      let output = ''
      const result = await sandbox.exec(command, projectProbe, { signal, timeout: 25, onData: data => { output = (output + data.toString('utf8')).slice(-16000) } })
      if (result.exitCode !== 0 || !output.includes(marker)) throw new ModelError(`隔离测试未通过：${output.trim().slice(-1800) || '隔离进程未返回有效测试结果'}`)
    }
    const blocked = (command: string): Promise<void> => run(`try { ${command}; Write-Output 'UNEXPECTED_ACCESS'; exit 23 } catch { ${denied('ACCESS_BLOCKED')} }`, 'ACCESS_BLOCKED')
    await check('project', SANDBOX_CHECKS.project.label, async () => {
      const folder = path.join(projectProbe, 'files'), file = path.join(folder, 'example.txt')
      await run(`[IO.Directory]::CreateDirectory(${literal(folder)}) | Out-Null; [IO.File]::WriteAllText(${literal(file)},'first'); [IO.File]::WriteAllText(${literal(file)},'second'); if ([IO.File]::ReadAllText(${literal(file)}) -ne 'second') { throw '内容不一致' }; [IO.Directory]::Delete(${literal(folder)},$true); Write-Output 'PROJECT_OK'`, 'PROJECT_OK')
    })
    await check('outside', SANDBOX_CHECKS.outside.label, async () => {
      await blocked(`[IO.File]::ReadAllText(${literal(outsideFile)}) | Out-Null`)
      await blocked(`[IO.File]::WriteAllText(${literal(outsideFile)},'unexpected')`)
      if (await readFile(outsideFile, 'utf8') !== token) throw new ModelError('项目外写入隔离无效，已禁用自动终端执行')
    })
    await check('private', SANDBOX_CHECKS.private.label, async () => { await blocked(`[IO.File]::ReadAllText(${literal(privateFile)}) | Out-Null`) })
    await check('links', SANDBOX_CHECKS.links.label, async () => {
      const link = path.join(projectProbe, 'outside-link')
      await symlink(outside, link, 'junction')
      await blocked(`[IO.File]::ReadAllText(${literal(path.join(link, 'outside.txt'))}) | Out-Null`)
      await blocked(`[IO.File]::WriteAllText(${literal(path.join(link, 'outside.txt'))},'unexpected')`)
      if (await readFile(outsideFile, 'utf8') !== token) throw new ModelError('目录联接隔离无效，已禁用自动终端执行')
    })
    await check('children', SANDBOX_CHECKS.children.label, async () => {
      const shell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
      const script = `$ErrorActionPreference='Stop'; try { [IO.File]::WriteAllText(${literal(outsideFile)},'unexpected'); exit 23 } catch { ${denied('CHILD_BLOCKED')}; exit 0 }`
      await run(`& ${literal(shell)} -NoProfile -NonInteractive -EncodedCommand '${Buffer.from(script, 'utf16le').toString('base64')}'`, 'CHILD_BLOCKED')
      if (await readFile(outsideFile, 'utf8') !== token) throw new ModelError('子进程隔离无效，已禁用自动终端执行')
    })
  } finally {
    await Promise.all([workspace.cleanup(), rm(privateFile, { force: true })])
  }
}

/** 开发能力单独验证，不把 MXC 的可用性当作 AppContainer 文件隔离的前提。 */
export async function checkSandboxDeveloperNetwork(sandbox: TerminalSandbox, project: string, signal: AbortSignal): Promise<void> {
  const token = randomUUID()
  let requests = 0
  const server = createServer((_request, response) => { requests++; response.setHeader('Content-Type', 'text/plain'); response.end(token) })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  try {
    const address = server.address() as { port: number }
    // 使用无代理的本地请求，避免宿主代理设置影响回环能力判断。
    const command = `$client=New-Object Net.WebClient; $client.Proxy=$null; try { $body=$client.DownloadString('http://127.0.0.1:${address.port}'); if ($body -ne '${token}') { throw '网络响应不一致' }; Write-Output '${token}' } finally { $client.Dispose() }`
    let output = ''
    // 显式设置网络权限；普通 PowerShell 脚本不会被开发命令分类器识别。
    const result = await sandbox.exec(command, project, { signal, timeout: 15, onData: data => { output = (output + data.toString('utf8')).slice(-8000) } })
    if (result.exitCode !== 0 || !output.includes(token) || requests !== 1) throw new ModelError(`MXC 开发工具网络能力未通过验证：${output.trim() || `退出码 ${result.exitCode}`}`)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
