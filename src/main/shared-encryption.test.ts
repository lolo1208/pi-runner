import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { shareWindowsEncryptionKey } from './shared-encryption'

it('只同步正式版包装密钥，保留开发版其他状态且不修改正式版', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pi-encryption-'))
  const source = path.join(root, 'prod'), destination = path.join(root, 'dev')
  try {
    mkdirSync(source); mkdirSync(destination)
    const production = JSON.stringify({ os_crypt: { encrypted_key: 'production-wrapped-key' }, browser: 'production' })
    writeFileSync(path.join(source, 'Local State'), production)
    writeFileSync(path.join(destination, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: 'old', other: true }, browser: 'development' }))
    shareWindowsEncryptionKey(source, destination)
    expect(JSON.parse(readFileSync(path.join(destination, 'Local State'), 'utf8'))).toEqual({ os_crypt: { encrypted_key: 'production-wrapped-key', other: true }, browser: 'development' })
    expect(readFileSync(path.join(source, 'Local State'), 'utf8')).toBe(production)
    shareWindowsEncryptionKey(source, destination)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('正式版尚无 Local State 时不创建或覆盖开发版状态', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pi-encryption-empty-'))
  try { expect(() => shareWindowsEncryptionKey(path.join(root, 'prod'), path.join(root, 'dev'))).not.toThrow() }
  finally { rmSync(root, { recursive: true, force: true }) }
})
