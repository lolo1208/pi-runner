import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { SandboxBackend } from '../../shared/sandbox'

const cachedFingerprints = new Map<string, { stamp: string; fingerprint: string }>()

/** 不记录文件内容；系统、宿主、项目身份和关键目录权限变化时让检测记录失效。 */
export async function sandboxVerificationFingerprint(options: { runtimeDirectory: string; dataDirectory: string; protectedDirectories: string[] }, backend: SandboxBackend, project?: string): Promise<string> {
  const directories = [...new Set([options.runtimeDirectory, options.dataDirectory, ...options.protectedDirectories, ...(project ? [project, ...['.git', '.agents', '.codex', '.aws', '.pi-runner'].map(name => path.join(project, name))] : [])])]
  const identities = await Promise.all(directories.map(async directory => {
    try { const actual = await realpath(directory), info = await stat(actual, { bigint: true }); return { path: actual, dev: String(info.dev), ino: String(info.ino), created: String(info.birthtimeNs), changed: String(info.ctimeNs) } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { path: path.resolve(directory), missing: true } }
  }))
  // 兼容后端也可能使用 MXC 执行开发命令，两个运行时的变化均须使证明失效。
  const runtimes = await Promise.all((['mxc', 'appcontainer'] as const).map(async kind => {
    try {
      const manifest = await readFile(path.join(options.runtimeDirectory, kind === 'mxc' ? 'manifest.json' : 'appcontainer-manifest.json'), 'utf8')
      const info = await stat(path.join(options.runtimeDirectory, 'bin', kind === 'mxc' ? 'codex.exe' : 'pi-runner-appcontainer.exe'), { bigint: true })
      return { kind, manifest, file: [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String) }
    } catch (error) { if (kind === backend || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { kind, missing: true } }
  }))
  const environment = { policy: 4, platform: process.platform, release: os.release(), arch: process.arch, user: os.userInfo().username, backend, runtimes, temporaryDirectory: os.tmpdir() }
  const key = JSON.stringify([backend, directories])
  const stamp = JSON.stringify({ ...environment, identities })
  const cached = cachedFingerprints.get(key)
  if (cached?.stamp === stamp) return cached.fingerprint
  const existing = identities.filter(item => !('missing' in item)).map(item => "'" + item.path.replace(/'/g, "''") + "'")
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; @(${existing.join(',')}) | ForEach-Object { (Get-Acl -LiteralPath $_).Sddl } | ConvertTo-Json -Compress`
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000, encoding: 'utf8' })
  // 目录内容变化会改变 ctime，用于决定是否重读 ACL；普通新增文件不撤销隔离证明。
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...environment, identities: identities.map(({ changed: _changed, ...identity }) => identity), permissions: JSON.parse(stdout.trim()) })).digest('hex')
  if (cachedFingerprints.size >= 256) cachedFingerprints.delete(cachedFingerprints.keys().next().value!)
  cachedFingerprints.set(key, { stamp, fingerprint })
  return fingerprint
}
