import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SkillStore } from './skill-store'
import { createSkillArchive } from './skill-archive'

describe('SkillStore replacement installation', () => {
  let root: string, source: string, directory: string, store: SkillStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pi-runner-skill-test-'))
    source = path.join(root, 'source')
    directory = path.join(root, 'installed')
    await mkdir(source)
    store = new SkillStore(directory)
  })

  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  const document = (description: string): string => `---\nname: Example\ndescription: ${description}\n---\n\nInstructions\n`

  it('replaces files and metadata while preserving the skill ID and enabled state', async () => {
    await writeFile(path.join(source, 'SKILL.md'), document('old'))
    await writeFile(path.join(source, 'removed.txt'), 'old file')
    const [original] = await store.install(source)
    await store.setEnabled(original.id, false)

    await writeFile(path.join(source, 'SKILL.md'), document('new'))
    await rm(path.join(source, 'removed.txt'))
    await writeFile(path.join(source, 'added.txt'), 'new file')
    const updated = await store.install(source)

    expect(updated).toEqual([{ ...original, description: 'new', enabled: false }])
    expect(await readFile(path.join(directory, original.id, 'added.txt'), 'utf8')).toBe('new file')
    expect(await readdir(path.join(directory, original.id))).not.toContain('removed.txt')
    expect((await readdir(directory)).filter(name => name.startsWith('.install-') || name.startsWith('.replace-'))).toEqual([])
  })

  it('keeps the installed version when replacement source is invalid', async () => {
    await writeFile(path.join(source, 'SKILL.md'), document('old'))
    const [original] = await store.install(source)
    await writeFile(path.join(source, 'SKILL.md'), document('new'))
    await writeFile(path.join(source, 'too-large.bin'), Buffer.alloc(32 * 1024 * 1024 + 1))

    await expect(store.install(source)).rejects.toThrow()
    expect(await store.list()).toEqual([original])
    expect(await readFile(path.join(directory, original.id, 'SKILL.md'), 'utf8')).toBe(document('old'))
    expect((await readdir(directory)).filter(name => name.startsWith('.install-') || name.startsWith('.replace-'))).toEqual([])
  })

  it('restores the installed version when saving updated metadata fails', async () => {
    await writeFile(path.join(source, 'SKILL.md'), document('old'))
    const [original] = await store.install(source)
    await writeFile(path.join(source, 'SKILL.md'), document('new'))
    Object.defineProperty(store, 'save', { value: async () => { throw new Error('save failed') } })

    await expect(store.install(source)).rejects.toThrow()
    expect(await store.list()).toEqual([original])
    expect(await readFile(path.join(directory, original.id, 'SKILL.md'), 'utf8')).toBe(document('old'))
    expect((await readdir(directory)).filter(name => name.startsWith('.install-') || name.startsWith('.replace-'))).toEqual([])
  })

  it('replaces an installed skill from a ZIP archive', async () => {
    await writeFile(path.join(source, 'SKILL.md'), document('old'))
    const [original] = await store.install(source)
    await writeFile(path.join(source, 'SKILL.md'), document('new'))
    const archive = path.join(root, 'skill.zip')
    await writeFile(archive, await createSkillArchive(source))

    const updated = await store.installZip(archive)
    expect(updated).toHaveLength(1)
    expect(updated[0]).toEqual({ ...original, description: 'new' })
    expect((await lstat(path.join(directory, original.id))).isDirectory()).toBe(true)
  })
})
