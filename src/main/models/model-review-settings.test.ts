import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ModelSettingsStore } from './model-settings-store'
import type { ModelProfile } from '../../shared/models'

const cipher = { isAvailable: () => true, encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() }
describe('review model persistence', () => {
  let directory: string, file: string, store: ModelSettingsStore
  let profiles: ModelProfile[]
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'review-settings-'))
    file = path.join(directory, 'models.json'); store = new ModelSettingsStore(file, cipher)
    const result = await store.syncOllama('http://localhost:11434', [
      { id: 'first', capabilities: ['tools'], maxContextTokens: 8192 },
      { id: 'second', capabilities: ['tools'], maxContextTokens: 8192 }
    ])
    profiles = result.profiles
  })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
  it('follows default until independently selected and persists across reopen', async () => {
    expect((await store.reviewProfile())?.profile.id).toBe(profiles[0].id)
    await store.setReviewModel(profiles[1].id)
    const reopened = new ModelSettingsStore(file, cipher)
    expect((await reopened.list()).reviewProfileId).toBe(profiles[1].id)
    expect((await reopened.reviewProfile())?.profile.id).toBe(profiles[1].id)
    await reopened.setReviewModel(null)
    expect((await reopened.reviewProfile())?.profile.id).toBe(profiles[0].id)
  })
  it('rejects an unknown review model without changing the selection', async () => {
    await store.setReviewModel(profiles[1].id)
    await expect(store.setReviewModel('missing')).rejects.toThrow()
    expect((await store.list()).reviewProfileId).toBe(profiles[1].id)
  })
  it('clears the independent selection when the selected model becomes unavailable', async () => {
    await store.setReviewModel(profiles[1].id)
    const next = await store.syncOllama('http://localhost:11434', [{ id: 'first', capabilities: ['tools'], maxContextTokens: 8192 }])
    expect(next.reviewProfileId).toBeNull()
    expect((await store.reviewProfile())?.profile.id).toBe(profiles[0].id)
  })
  it('reads an older settings file without an independent reviewer', async () => {
    await writeFile(file, JSON.stringify({ version: 1, activeProfileId: profiles[0].id, profiles: profiles.map(profile => ({ profile })) }))
    expect((await store.list()).reviewProfileId).toBeNull()
    expect((await store.reviewProfile())?.profile.id).toBe(profiles[0].id)
  })
})
