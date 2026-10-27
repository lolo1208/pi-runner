import { afterEach, describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ConversationWorkspace } from './conversation-workspace'
import { agentSystemPrompt } from './pi-system-prompt'

const workspaces: ConversationWorkspace[] = []
const ids = ['first', 'second']
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) for (const id of ids) await workspace.remove(id)
})

describe('ordinary conversation workspace', () => {
  function workspace(data = path.join(os.tmpdir(), `pi-runner-test-${crypto.randomUUID()}`)) {
    const value = new ConversationWorkspace(data)
    workspaces.push(value)
    return value
  }

  it('separates conversations and installations, and reuses the directory after restart', async () => {
    const data = path.join(os.tmpdir(), `pi-runner-test-${crypto.randomUUID()}`)
    const first = workspace(data)
    const directory = await first.ensure('first')
    await writeFile(path.join(directory, 'kept.txt'), 'kept')
    expect(await first.ensure('second')).not.toBe(directory)
    expect(await workspace().ensure('first')).not.toBe(directory)
    const restored = await workspace(data).ensure('first')
    expect(restored).toBe(directory)
    expect(await readFile(path.join(restored, 'kept.txt'), 'utf8')).toBe('kept')
    expect(path.relative(os.tmpdir(), directory).startsWith('..')).toBe(false)
  })

  it('recreates a cleaned directory and removes only the requested conversation', async () => {
    const value = workspace()
    const directory = await value.ensure('first')
    const other = await value.ensure('second')
    await writeFile(path.join(other, 'kept.txt'), 'kept')
    await value.remove('first')
    expect(await value.ensure('first')).toBe(directory)
    expect(await readFile(path.join(other, 'kept.txt'), 'utf8')).toBe('kept')
    await value.remove('first')
    await value.remove('first')
  })

  it('rejects invalid identifiers before creating or removing directories', async () => {
    const value = workspace()
    await expect(value.ensure('')).rejects.toThrow()
    await expect(value.remove('')).rejects.toThrow()
  })

  it('tells the agent its real working directory without a project', () => {
    const prompt = agentSystemPrompt({ instruction: '', mode: 'auto', cwd: '/tmp/conversation', planning: false })
    expect(prompt).toContain('无项目目录')
    expect(prompt).toContain('当前工作目录：/tmp/conversation')
    expect(prompt).toContain('规则或 AI 审核')
  })
})
