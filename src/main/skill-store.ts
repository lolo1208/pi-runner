import { mkdir, mkdtemp, readFile, writeFile, rename, readdir, lstat, copyFile, rm, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ModelError } from './models/model-validation'
import { validSkillIds, type LocalSkill } from '../shared/skills'
import { createSkillArchive, extractSkillArchive } from './skill-archive'

const MAX_SKILL_BYTES = 256 * 1024

function skillField(document: string, key: string): string {
  const metadata = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(document)?.[1] ?? ''
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(metadata)
  if (!match) return ''
  const value = match[1].trim()
  if (/^[>|][-+]?$/.test(value)) {
    const lines = metadata.slice(match.index + match[0].length).split(/\r?\n/).slice(1)
    const block: string[] = []
    for (const line of lines) {
      if (line && !/^[ \t]/.test(line)) break
      block.push(line.trim())
    }
    return block.join(value.startsWith('>') ? ' ' : '\n').trim()
  }
  return value.replace(/^(['"])(.*)\1$/, '$2')
}

/** 安装时保留技能的相对目录结构，不跟随符号链接。 */
export class SkillStore {
  private mutation: Promise<unknown> = Promise.resolve()
  constructor(private readonly directory: string) {}

  async rootDirectory(): Promise<string> {
    await mkdir(this.directory, { recursive: true })
    return path.resolve(this.directory)
  }

  async installZip(file: string): Promise<LocalSkill[]> {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'pi-runner-skill-'))
    try {
      const unpacked = path.join(temporary, path.basename(file, path.extname(file)))
      await mkdir(unpacked)
      await extractSkillArchive(file, unpacked)
      let source = unpacked
      const entries = (await readdir(unpacked, { withFileTypes: true })).filter(entry => !['__MACOSX', '.DS_Store'].includes(entry.name))
      if (!entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')) {
        if (entries.length !== 1 || !entries[0].isDirectory()) throw new ModelError('ZIP 根目录或唯一的技能文件夹内必须包含 SKILL.md')
        source = path.join(unpacked, entries[0].name)
      }
      return await this.install(source)
    } catch (error) {
      if (error instanceof ModelError) throw error
      throw new ModelError('技能 ZIP 安装失败，请确认压缩包完整且包含 SKILL.md 后重试')
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }

  private async entries(): Promise<LocalSkill[]> {
    try {
      const value: unknown = JSON.parse(await readFile(path.join(this.directory, 'skills.json'), 'utf8'))
      if (!Array.isArray(value) || !value.every(item => item && validSkillIds([item.id]) && typeof item.name === 'string' && typeof item.description === 'string' && typeof item.enabled === 'boolean')) throw new Error()
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new ModelError('无法读取本地技能，请检查技能数据文件和访问权限后重试')
    }
  }

  /** 目录已被手动删除的技能在读取时自动移除记录。 */
  private async prune(skills: LocalSkill[]): Promise<LocalSkill[]> {
    const remaining: LocalSkill[] = []
    for (const skill of skills) {
      try {
        const info = await lstat(path.join(this.directory, skill.id))
        if (info.isDirectory() && !info.isSymbolicLink()) remaining.push(skill)
      } catch { /* 目录不存在，丢弃记录 */ }
    }
    return remaining
  }

  list(): Promise<LocalSkill[]> {
    return this.serialize(async () => {
      const skills = await this.entries()
      const remaining = await this.prune(skills)
      return remaining.length === skills.length ? remaining : this.save(remaining)
    })
  }

  /** 重新扫描技能根目录：移除失效记录，并收录包含 SKILL.md 但尚未登记的技能文件夹。 */
  refresh(): Promise<LocalSkill[]> {
    return this.serialize(async () => {
      await mkdir(this.directory, { recursive: true })
      const skills = await this.entries()
      const remaining = await this.prune(skills)
      const known = new Set(remaining.map(skill => skill.id))
      let added = 0
      for (const entry of await readdir(this.directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || known.has(entry.name) || !validSkillIds([entry.name])) continue
        const target = path.join(this.directory, entry.name, 'SKILL.md')
        try {
          const info = await lstat(target)
          if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SKILL_BYTES) continue
        } catch { continue }
        try {
          const document = await readFile(target, 'utf8')
          if (!document.trim()) continue
          const name = (skillField(document, 'name') || entry.name).slice(0, 200)
          if (remaining.some(skill => skill.name === name)) continue
          remaining.push({ id: entry.name, name, description: skillField(document, 'description').slice(0, 2000), enabled: true })
          known.add(entry.name)
          added += 1
        } catch { /* 无法读取的文件夹跳过 */ }
      }
      return added > 0 || remaining.length !== skills.length ? this.save(remaining) : remaining
    }).catch(error => { if (error instanceof ModelError) throw error; throw new ModelError('技能刷新失败，请检查技能目录访问权限后重试') })
  }

  private async save(skills: LocalSkill[]): Promise<LocalSkill[]> {
    await mkdir(this.directory, { recursive: true })
    const file = path.join(this.directory, 'skills.json')
    await writeFile(`${file}.tmp`, JSON.stringify(skills), 'utf8')
    await rename(`${file}.tmp`, file)
    return skills
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(action)
    this.mutation = result.catch(() => {})
    return result
  }

  setEnabled(id: unknown, enabled: unknown): Promise<LocalSkill[]> {
    return this.serialize(async () => {
      if (!validSkillIds([id]) || typeof enabled !== 'boolean') throw new ModelError('技能设置参数无效')
      const skills = await this.entries()
      if (!skills.some(skill => skill.id === id)) throw new ModelError('技能不存在，请重新读取技能列表')
      return this.save(skills.map(skill => skill.id === id ? { ...skill, enabled } : skill))
    })
  }

  exportZip(id: unknown): Promise<{ name: string; archive: Buffer }> {
    return this.serialize(async () => {
      if (!validSkillIds([id])) throw new ModelError('技能导出参数无效')
      const skill = (await this.entries()).find(item => item.id === id)
      if (!skill) throw new ModelError('技能不存在，请重新读取技能列表')
      const root = await realpath(this.directory), target = path.resolve(root, skill.id)
      const info = await lstat(target)
      if (!info.isDirectory() || info.isSymbolicLink() || path.dirname(await realpath(target)) !== root) throw new ModelError('技能目录异常，请检查技能根目录后重试')
      const document = await lstat(path.join(target, 'SKILL.md'))
      if (!document.isFile() || document.isSymbolicLink() || document.size > MAX_SKILL_BYTES) throw new ModelError('技能目录必须包含不超过 256 KiB 的 SKILL.md 文件')
      return { name: skill.name, archive: await createSkillArchive(target) }
    }).catch(error => {
      if (error instanceof ModelError) throw error
      throw new ModelError('技能导出失败，请检查技能文件是否存在及访问权限后重试')
    })
  }

  remove(id: unknown): Promise<LocalSkill[]> {
    return this.serialize(async () => {
      if (!validSkillIds([id])) throw new ModelError('技能删除参数无效')
      const skills = await this.entries()
      if (!skills.some(skill => skill.id === id)) throw new ModelError('技能不存在，请重新读取技能列表')
      const remaining = skills.filter(skill => skill.id !== id)
      const root = await realpath(this.directory)
      const target = path.resolve(root, id as string)
      if (path.dirname(target) !== root) throw new ModelError('只能删除技能根目录内的技能')
      try {
        const info = await lstat(target)
        if (info.isSymbolicLink() || !info.isDirectory()) throw new ModelError('技能目录异常，请检查技能根目录后重试')
        const canonical = await realpath(target)
        if (path.dirname(canonical) !== root) throw new ModelError('不能删除技能根目录以外的文件')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.save(remaining)
        throw error
      }
      // 先隔离技能目录，列表保存失败时可完整恢复，避免误删后仍显示为已安装。
      const staged = path.join(root, `.delete-${randomUUID()}`)
      await rename(target, staged)
      try { await this.save(remaining) }
      catch (error) { await rename(staged, target); throw error }
      try { await rm(staged, { recursive: true, force: true }) }
      catch (error) { await rename(staged, target); await this.save(skills); throw error }
      return remaining
    }).catch(error => {
      if (error instanceof ModelError) throw error
      throw new ModelError('技能删除失败，请检查文件是否被占用或访问权限后重试')
    })
  }

  install(source: string): Promise<LocalSkill[]> {
    return this.serialize(async () => {
      const skills = await this.entries()
      const root = await realpath(source)
      const storeRoot = path.resolve(this.directory)
      if (root === storeRoot || root.startsWith(storeRoot + path.sep) || storeRoot.startsWith(root + path.sep)) throw new ModelError('请选择应用数据目录以外的技能目录')
      const info = await lstat(path.join(root, 'SKILL.md'))
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SKILL_BYTES) throw new ModelError('技能目录必须包含不超过 256 KiB 的 SKILL.md 文件')
      const document = await readFile(path.join(root, 'SKILL.md'), 'utf8')
      if (!document.trim()) throw new ModelError('SKILL.md 不能为空')
      const field = (key: string): string => skillField(document, key)
      const name = (field('name') || path.basename(root)).slice(0, 200)
      const existing = skills.find(skill => skill.name === name)
      const id = existing?.id ?? randomUUID(), target = path.join(this.directory, id)
      const staged = path.join(this.directory, `.install-${randomUUID()}`)
      const backup = path.join(this.directory, `.replace-${randomUUID()}`)
      let bytes = 0, count = 0
      const copy = async (from: string, to: string): Promise<void> => {
        await mkdir(to, { recursive: true })
        for (const entry of await readdir(from, { withFileTypes: true })) {
          if (++count > 2000) throw new ModelError('技能包含过多文件，最多支持 2000 项')
          if (entry.isSymbolicLink()) throw new ModelError('技能目录包含符号链接，请移除链接后重新安装')
          const input = path.join(from, entry.name), output = path.join(to, entry.name)
          if (entry.isDirectory()) await copy(input, output)
          else if (entry.isFile()) {
            bytes += (await lstat(input)).size
            if (bytes > 32 * 1024 * 1024) throw new ModelError('技能目录不能超过 32 MiB')
            await copyFile(input, output)
          } else throw new ModelError('技能目录包含不支持的文件类型')
        }
      }
      try {
        await copy(root, staged)
        if (existing) {
          const current = await lstat(target)
          if (!current.isDirectory() || current.isSymbolicLink() || path.dirname(await realpath(target)) !== await realpath(this.directory)) throw new ModelError('技能目录异常，请检查技能根目录后重试')
          await rename(target, backup)
        }
        try {
          await rename(staged, target)
          const updated = existing
            ? skills.map(skill => skill.id === id ? { ...skill, description: field('description').slice(0, 2000) } : skill)
            : [...skills, { id, name, description: field('description').slice(0, 2000), enabled: true }]
          const result = await this.save(updated)
          if (existing) await rm(backup, { recursive: true, force: true }).catch(() => {})
          return result
        } catch (error) {
          await rm(target, { recursive: true, force: true })
          if (existing) await rename(backup, target)
          throw error
        }
      } finally { await rm(staged, { recursive: true, force: true }) }
    }).catch(error => { if (error instanceof ModelError) throw error; throw new ModelError('技能安装失败，请确认目录中有 SKILL.md，并检查文件访问权限后重试') })
  }

  async selected(ids: unknown): Promise<LocalSkill[]> {
    if (!validSkillIds(ids)) throw new ModelError('选择的技能参数无效')
    const skills = await this.list()
    return (ids ?? []).map(id => {
      const skill = skills.find(item => item.id === id)
      if (!skill?.enabled) throw new ModelError('所选技能已禁用或不存在，请移除后重新选择')
      return skill
    })
  }

  async instruction(ids: unknown): Promise<string> {
    const selected = await this.selected(ids)
    return (await Promise.all(selected.map(async skill => {
      const content = await this.readResource(selected.map(item => item.id), skill.id, 'SKILL.md')
      return `使用用户为本轮选择的技能「${skill.name}」（标识：${skill.id}）。相对路径以技能目录为准，需要参考文件时调用 read_skill_file。技能不改变现有工具权限。\n\n${content}`
    }))).join('\n\n')
  }

  /** 自动发现只暴露名称和触发描述；匹配后再按需读取完整指令。 */
  async discoverable(): Promise<LocalSkill[]> {
    const enabled = (await this.list()).filter(skill => skill.enabled)
    const ids = enabled.map(skill => skill.id)
    const entries = await Promise.all(enabled.map(async skill => {
      const document = await this.readResource(ids, skill.id, 'SKILL.md')
      if (skillField(document, 'disable-model-invocation').toLowerCase() === 'true') return []
      const description = skillField(document, 'description') || skill.description
      return [{ ...skill, description }]
    }))
    return entries.flat()
  }

  async readResource(ids: string[], id: string, file: string): Promise<string> {
    if (!ids.includes(id)) throw new ModelError('只能读取本轮所选或可自动匹配的已启用技能')
    await this.selected([id])
    const root = await realpath(path.join(this.directory, id))
    const target = await realpath(path.resolve(root, file))
    if (!target.startsWith(root + path.sep)) throw new ModelError('不能读取技能目录以外的文件')
    const info = await lstat(target)
    if (!info.isFile() || info.size > MAX_SKILL_BYTES) throw new ModelError('技能参考文件必须为不超过 256 KiB 的文本文件')
    return readFile(target, 'utf8')
  }
}
