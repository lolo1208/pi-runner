import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ModelError } from './model-validation'

export function normalizeClaudeProxy(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new ModelError('请输入有效的 HTTP 代理地址')
  const input = value.trim()
  if (!input) return ''
  try {
    const url = new URL(input.includes('://') ? input : `http://${input}`)
    if (url.protocol !== 'http:' || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error()
    return url.origin
  } catch { throw new ModelError('HTTP 代理格式无效，例如 127.0.0.1:7890 或 http://127.0.0.1:7890；不支持账号密码、路径或其他协议') }
}
const directory = () => join(homedir(), '.claude')
const settingsPath = () => join(directory(), 'settings.json')
async function assertOrdinary(path: string, directory = false): Promise<void> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw new ModelError('Claude 配置路径不是普通文件或目录，请手动检查后重试')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
async function readSettings(): Promise<Record<string, unknown>> {
  await assertOrdinary(directory(), true)
  await assertOrdinary(settingsPath())
  let text: string
  try { text = await readFile(settingsPath(), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new ModelError('无法读取 Claude settings.json，请检查权限') }
  try {
    const settings = JSON.parse(text.replace(/^\uFEFF/, ''))
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error()
    if (settings.env !== undefined && (!settings.env || typeof settings.env !== 'object' || Array.isArray(settings.env))) throw new Error()
    return settings
  } catch { throw new ModelError('Claude settings.json 不是有效的 JSON 配置；为避免覆盖其他设置，未作修改') }
}
export async function readClaudeProxy(): Promise<string> {
  const settings = await readSettings()
  const env = settings.env as Record<string, unknown> | undefined
  const saved = env?.HTTP_PROXY ?? env?.HTTPS_PROXY
  return typeof saved === 'string' ? saved : process.env.HTTP_PROXY ?? ''
}
export async function saveClaudeProxy(value: unknown): Promise<string> {
  const proxy = normalizeClaudeProxy(value)
  const settings = await readSettings()
  const original = JSON.stringify(settings)
  const env = { ...(settings.env as Record<string, unknown> | undefined) }
  if (proxy) { env.HTTP_PROXY = proxy; env.HTTPS_PROXY = proxy }
  else { delete env.HTTP_PROXY; delete env.HTTPS_PROXY }
  if (Object.keys(env).length) settings.env = env
  else delete settings.env
  // 空值且文件不存在时不创建无意义的空配置。
  if (!proxy && !Object.keys(settings).length) {
    try { await lstat(settingsPath()) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
  }
  await mkdir(directory(), { recursive: true })
  const temporary = join(directory(), `.settings-proxy-${randomUUID()}.tmp`)
  try {
    // 同目录临时文件保证替换不跨文件系统；保留未知字段，不回传整个配置。
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await assertOrdinary(settingsPath())
    if (JSON.stringify(await readSettings()) !== original) throw new ModelError('Claude 配置已被其他程序修改，请重新保存')
    await rename(temporary, settingsPath())
  } catch { throw new ModelError('Claude 代理配置保存失败，请检查文件权限；原配置或同目录临时文件可能仍在，请核对后重试') }
  return proxy
}
