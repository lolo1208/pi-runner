import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ChatgptCredentials } from './chatgpt-credentials'

it('两个实例共享授权、串行刷新，退出对另一实例立即可见', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'shared-auth-'))
  const cipher = { isAvailable: () => true, encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() }
  const file = path.join(directory, 'auth.enc')
  const a = new ChatgptCredentials(file, cipher)
  const b = new ChatgptCredentials(file, cipher)
  const provider = 'openai-codex'
  try {
    expect(await b.read(provider)).toBeUndefined()
    await a.modify(provider, async () => ({ type: 'oauth', access: 'initial', refresh: 'refresh', expires: 1 }))
    expect((await b.read(provider))?.type).toBe('oauth')
    await Promise.all([a, b].map(store => store.modify(provider, async current => {
      if (current?.type !== 'oauth') throw new Error('missing')
      await new Promise(resolve => setTimeout(resolve, 5))
      return { ...current, expires: current.expires + 1 }
    })))
    expect(await a.read(provider)).toMatchObject({ expires: 3 })
    await b.delete(provider)
    expect(await a.read(provider)).toBeUndefined()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
