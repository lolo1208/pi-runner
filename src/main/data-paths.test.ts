import { describe, expect, it } from 'vitest'
import { dataPaths } from './data-paths'
import { withSharedFileLock } from './models/shared-file-lock'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('版本存储隔离', () => {
  it('模型只采用正式版路径，工作区与浏览器数据隔离', () => {
    const production = dataPaths('/app', '/home', true)
    const development = dataPaths('/app', '/home', false)
    expect(development.models).toBe(production.models)
    expect(production.models).toBe(path.join('/app', 'pi-runner'))
    expect(development.workspace).not.toBe(production.workspace)
    expect(development.userData).not.toBe(production.userData)
    expect(production.workspace).toBe(path.join('/home', '.pi-runner'))
  })
  it('独立调用的读改写互斥且异常后释放', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pi-shared-test-'))
    const file = path.join(directory, 'settings')
    let count = 0
    try {
      await Promise.all(Array.from({ length: 8 }, () => withSharedFileLock(file, async () => {
        const previous = count
        await new Promise(resolve => setTimeout(resolve, 5))
        count = previous + 1
      })))
      expect(count).toBe(8)
      await expect(withSharedFileLock(file, async () => { throw new Error('test') })).rejects.toThrow('test')
      await expect(withSharedFileLock(file, async () => 42)).resolves.toBe(42)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
