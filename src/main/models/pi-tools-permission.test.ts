import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { piProjectTools } from './pi-tools'
import { blockShellFileMutation, commandRisk, isDestructiveCommand, readOnlyCommand, safeDeveloperCommand, ToolApprovalManager } from './tool-permissions'
import type { AgentEvent, PermissionMode } from '../../shared/models'

const approve = vi.fn(async (..._args: unknown[]) => { throw new Error('approval requested') })

describe('command risk routing', () => {
  it('blocks shell file mutation via redirection and file cmdlets', () => {
    expect(commandRisk('echo hi > out.txt').risk).toBe('block')
    expect(commandRisk('npm run build >> log.txt').risk).toBe('block')
    expect(commandRisk('sort -ooutput input').risk).toBe('block')
    expect(blockShellFileMutation('Set-Content file.txt hello')).toBeTruthy()
    expect(blockShellFileMutation('rm -rf node_modules')).toBeTruthy()
    expect(blockShellFileMutation('pwd; rm file.txt')).toBeTruthy()
    expect(blockShellFileMutation('npm test 2>&1 > out.txt')).toBeTruthy()
  })

  it('allows descriptor redirection like 2>&1', () => {
    expect(blockShellFileMutation('npm test 2>&1')).toBeUndefined()
  })

  it('blocks destructive commands', () => {
    expect(commandRisk('rm -rf /').risk).toBe('block')
    expect(commandRisk('format C:').risk).toBe('block')
    expect(isDestructiveCommand('dd if=/dev/zero of=/dev/sda')).toBeTruthy()
  })

  it('treats common development commands as safe', () => {
    expect(commandRisk('npm install').risk).toBe('safe')
    expect(commandRisk('pytest -q').risk).toBe('safe')
    expect(commandRisk('git commit -m test').risk).toBe('safe')
    expect(commandRisk('git status').risk).toBe('safe')
    expect(safeDeveloperCommand('pnpm run build && pnpm test')).toBe(true)
  })

  it('requires approval for unknown or inline-eval commands', () => {
    expect(commandRisk('node -e "require(\'fs\').writeFileSync(\'x\', \'y\')"').risk).toBe('approve')
    expect(commandRisk('python -c "print(1)"').risk).toBe('approve')
    expect(commandRisk('some-unknown-tool --flag').risk).toBe('approve')
  })
})

describe('file tool permission boundaries', () => {
  let root: string
  let outside: string
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pi-runner-perm-'))
    await mkdir(path.join(process.cwd(), '.tmp'), { recursive: true })
    outside = await mkdtemp(path.join(process.cwd(), '.tmp', 'pi-runner-outside-'))
    approve.mockClear()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  const tool = (name: string, mode: 'default' | 'auto' | 'full') => piProjectTools(root, async () => {}, { mode, project: root, protectedDirectories: [], approve }).find(item => item.name === name)!

  it.each(['default', 'auto', 'full'] as const)('supports ordinary conversation tools in %s mode', async mode => {
    const tools = piProjectTools(root, async () => {}, { mode, protectedDirectories: [], approve })
    const write = tools.find(item => item.name === 'write')!
    const operation = write.execute('ordinary-write', { path: 'ordinary.txt', content: 'hello' }, undefined, undefined, undefined as never)
    if (mode === 'default') await expect(operation).rejects.toThrow('approval requested')
    else {
      await operation
      expect(await readFile(path.join(root, 'ordinary.txt'), 'utf8')).toBe('hello')
      expect(approve).not.toHaveBeenCalled()
    }
    approve.mockClear()
    const terminal = tools.find(item => item.name === (process.platform === 'win32' ? 'powershell' : 'bash'))!
    const command = terminal.execute('ordinary-command', { command: 'git --version' }, undefined, undefined, undefined as never)
    if (mode === 'default') await expect(command).rejects.toThrow('approval requested')
    else {
      expect(JSON.stringify(await command)).toContain('git version')
      expect(approve).not.toHaveBeenCalled()
    }
  }, 15000)

  it('reviews ordinary conversation writes outside system temporary directories', async () => {
    const write = piProjectTools(root, async () => {}, { mode: 'auto', protectedDirectories: [], approve }).find(item => item.name === 'write')!
    await expect(write.execute('ordinary-write', { path: path.join(outside, 'ordinary.txt'), content: 'hello' }, undefined, undefined, undefined as never)).rejects.toThrow('approval requested')
    expect(approve).toHaveBeenCalledOnce()
  })

  it('writes inside the project without approval in project review mode', async () => {
    await tool('write', 'auto').execute('t', { path: 'hello.txt', content: 'hi' } as never, undefined, undefined, undefined as never)
    expect(await readFile(path.join(root, 'hello.txt'), 'utf8')).toBe('hi')
    expect(approve).not.toHaveBeenCalled()
  })

  it('writes to the system temp directory without approval in project review mode', async () => {
    const tempFile = path.join(os.tmpdir(), `pi-runner-temp-${Date.now()}.txt`)
    try {
      await tool('write', 'auto').execute('t', { path: tempFile, content: 'tmp' } as never, undefined, undefined, undefined as never)
      expect(await readFile(tempFile, 'utf8')).toBe('tmp')
      expect(approve).not.toHaveBeenCalled()
    } finally { await rm(tempFile, { force: true }) }
  })

  it('requires review to write outside the project in project review mode', async () => {
    await expect(tool('write', 'auto').execute('t', { path: path.join(outside, 'x.txt'), content: 'x' } as never, undefined, undefined, undefined as never)).rejects.toThrow('approval requested')
    expect(approve).toHaveBeenCalledTimes(1)
  })

  it('requires approval for every mutation in ask mode', async () => {
    await expect(tool('write', 'default').execute('t', { path: 'hello.txt', content: 'hi' } as never, undefined, undefined, undefined as never)).rejects.toThrow('approval requested')
    expect(approve).toHaveBeenCalledTimes(1)
  })

  it('writes outside the project without approval in full mode', async () => {
    const target = path.join(outside, 'full.txt')
    await tool('write', 'full').execute('t', { path: target, content: 'full' } as never, undefined, undefined, undefined as never)
    expect(await readFile(target, 'utf8')).toBe('full')
    expect(approve).not.toHaveBeenCalled()
  })

  const execute = (name: string, mode: PermissionMode, args: Record<string, unknown>, signal?: AbortSignal) => tool(name, mode).execute('t', args as never, signal, undefined, undefined as never)
  it.each(['default', 'auto', 'full'] as const)('reads project files without approval in %s', async mode => {
    await writeFile(path.join(root, 'read.txt'), 'visible')
    expect(JSON.stringify(await execute('read', mode, { path: 'read.txt' }))).toContain('visible')
    expect(approve).not.toHaveBeenCalled()
  })
  it('asks for outside reads only in default mode', async () => {
    const target = path.join(outside, 'read.txt'); await writeFile(target, 'outside')
    await expect(execute('read', 'default', { path: target })).rejects.toThrow('approval requested')
    approve.mockClear()
    for (const mode of ['auto', 'full'] as const) expect(JSON.stringify(await execute('read', mode, { path: target }))).toContain('outside')
    expect(approve).not.toHaveBeenCalled()
  })
  it.each(['default', 'auto', 'full'] as const)('blocks internal metadata in %s', async mode => {
    await mkdir(path.join(root, '.git')); await writeFile(path.join(root, '.git', 'config'), 'secret')
    await expect(execute('read', mode, { path: '.git/config' })).rejects.toThrow('元数据')
    await expect(execute('write', mode, { path: '.pi-runner/data', content: 'x' })).rejects.toThrow('内部数据')
  })
  it('excludes credential descendants while searching and listing a parent', async () => {
    const home = path.join(root, 'home'); await mkdir(path.join(home, '.ssh'), { recursive: true })
    await writeFile(path.join(home, '.ssh', 'key'), 'SECRET'); await writeFile(path.join(home, 'public.txt'), 'SECRET public')
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(home)
    try {
      const grep = JSON.stringify(await execute('grep', 'auto', { path: home, pattern: 'SECRET' }))
      expect(grep).toContain('public.txt'); expect(grep).not.toContain('.ssh')
      expect(JSON.stringify(await execute('find', 'auto', { path: home, pattern: '**/*' }))).not.toContain('.ssh')
      expect(JSON.stringify(await execute('ls', 'auto', { path: home }))).not.toContain('.ssh')
      await expect(execute('read', 'full', { path: path.join(home, '.ssh', 'key') })).rejects.toThrow('凭据')
    } finally { homeSpy.mockRestore() }
  })
  it('rejects a junction before reading, searching or writing', async () => {
    await symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(path.join(outside, 'file.txt'), 'secret')
    for (const name of ['read', 'ls', 'find', 'grep', 'write']) {
      await expect(execute(name, 'full', { path: name === 'read' || name === 'write' ? 'link/file.txt' : 'link', content: 'x', pattern: '*' })).rejects.toThrow(/链接|联接/)
    }
    expect(await readFile(path.join(outside, 'file.txt'), 'utf8')).toBe('secret')
  })
  it('reviews an outside move source even with an inside destination', async () => {
    const source = path.join(outside, 'source.txt'); await writeFile(source, 'original')
    await expect(execute('move', 'auto', { path: source, destination: path.join(root, 'dest.txt') })).rejects.toThrow('approval requested')
    expect(await readFile(source, 'utf8')).toBe('original')
  })
  it('reviews an outside copy destination', async () => {
    await writeFile(path.join(root, 'source.txt'), 'original')
    await expect(execute('copy', 'auto', { path: 'source.txt', destination: path.join(outside, 'dest.txt') })).rejects.toThrow('approval requested')
  })
  it('rejects an entire tree containing metadata before deleting anything', async () => {
    await mkdir(path.join(root, 'tree', '.git'), { recursive: true }); await writeFile(path.join(root, 'tree', 'safe.txt'), 'keep')
    await expect(execute('rmdir', 'full', { path: 'tree', recursive: true })).rejects.toThrow('元数据')
    expect(await readFile(path.join(root, 'tree', 'safe.txt'), 'utf8')).toBe('keep')
  })
  it('honors cancellation before creating a file', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(execute('write', 'full', { path: 'cancel.txt', content: 'x' }, controller.signal)).rejects.toThrow()
    await expect(readFile(path.join(root, 'cancel.txt'))).rejects.toThrow()
  })
  it('uses a real terminal for a common query in auto and full modes', async () => {
    for (const mode of ['auto', 'full'] as const) {
      const response = await execute(process.platform === 'win32' ? 'powershell' : 'bash', mode, { command: 'git --version' })
      expect(JSON.stringify(response)).toContain('git version')
    }
    expect(approve).not.toHaveBeenCalled()
  }, 15000)
  it('asks before even a read-only terminal command in default mode', async () => {
    await expect(execute(process.platform === 'win32' ? 'powershell' : 'bash', 'default', { command: 'git --version' })).rejects.toThrow('approval requested')
  })

  it.skipIf(process.platform !== 'win32')('executes a PowerShell query pipeline without approval or a mutation snapshot', async () => {
    await writeFile(path.join(root, 'query.txt'), 'hello')
    const beforeMutation = vi.fn(async () => {})
    const terminal = piProjectTools(root, beforeMutation, { mode: 'auto', project: root, protectedDirectories: [], approve }).find(item => item.name === 'powershell')!
    const response = await terminal.execute('query-pipeline', {
      command: `$files=Get-ChildItem -File; $files | Where-Object { $_.Extension -eq '.txt' } | Group-Object Extension | Select-Object Name,Count | ConvertTo-Json`,
    }, undefined, undefined, undefined as never)
    expect(JSON.stringify(response)).toContain('.txt')
    expect(approve).not.toHaveBeenCalled()
    expect(beforeMutation).not.toHaveBeenCalled()
  })
  it('marks ACL changes as requiring human confirmation', async () => {
    await expect(execute(process.platform === 'win32' ? 'powershell' : 'bash', 'auto', { command: 'chmod 777 folder' })).rejects.toThrow('approval requested')
    expect(approve.mock.calls[0]?.[5]).toBe(true)
  })
  it('reviews explicit external targets of common development commands', () => {
    expect(commandRisk(`pnpm --dir "${outside}" build`, root).risk).toBe('approve')
    expect(commandRisk('npm install --global typescript', root).risk).toBe('approve')
    expect(commandRisk(`pnpm --dir "${root}" build`, root).risk).toBe('safe')
  })
  it.each(['auto', 'full'] as const)('creates, copies, moves and removes ordinary directories in %s', async mode => {
    await execute('mkdir', mode, { path: 'tree' })
    await execute('write', mode, { path: 'tree/a.txt', content: 'a' })
    await execute('copy', mode, { path: 'tree', destination: 'copied' })
    await execute('move', mode, { path: 'copied', destination: 'moved' })
    expect(await readFile(path.join(root, 'moved', 'a.txt'), 'utf8')).toBe('a')
    await execute('rmdir', mode, { path: 'moved', recursive: true })
    await expect(readFile(path.join(root, 'moved', 'a.txt'))).rejects.toThrow()
  })
})

describe('conservative command classification', () => {
  it('allows Node type stripping without treating script execution as read-only', () => {
    const command = 'node --experimental-strip-types tools/check-schedule.mts'
    expect(commandRisk(command).risk).toBe('safe')
    expect(readOnlyCommand(command)).toBe(false)
  })
  it.each([
    'node --experimental-strip-types',
    'node --experimental-strip-types --unknown tools/check-schedule.mts',
    'node --experimental-strip-types --eval=process.exit()',
    'node --experimental-strip-types --import=hook.mjs tools/check-schedule.mts'
  ])('reviews unsafe or ambiguous type stripping invocation %s', command => {
    expect(commandRisk(command).risk).toBe('approve')
  })
  it.each(['node --eval=process.exit()', 'node -eprocess.exit()', 'python -cprint(1)', 'deno eval "1"', 'bun --eval=1', 'git reset --hard', 'git clean -fd', 'git push --force', 'git unknown-alias', 'git -c alias.x=!danger x', 'sed "w file" source', 'uniq input output', 'date 010100002026', 'hostname renamed-host', 'diff --output=out.txt a b'])('reviews %s', command => {
    expect(commandRisk(command).risk).toBe('approve')
  })
  it.each(['git --no-pager diff --stat', 'pnpm typecheck && pnpm test', 'pwd; git status', 'whoami', 'date -u', 'node --version', 'python script.py'])('allows common command %s', command => {
    expect(commandRisk(command).risk).toBe('safe')
  })
  it('does not classify a modifying compound as read-only', () => {
    expect(readOnlyCommand('git status; npm install')).toBe(false)
  })
})

describe('approval lifecycle', () => {
  it('rejects mismatched responses, then resolves only the current request', async () => {
    const events: AgentEvent[] = []
    const manager = new ToolApprovalManager(event => events.push(event))
    const pending = manager.ask('r', 'c', { tool: 'write', toolCallId: 't', args: {}, cwd: '', reason: 'test' }, new AbortController().signal, () => {})
    const event = events[0]; if (event.type !== 'approval' || !event.approval) throw new Error('missing approval')
    const approvalId = event.approval.id
    expect(() => manager.respond('wrong', 'c', approvalId, true)).toThrow()
    manager.respond('r', 'c', approvalId, true)
    expect(await pending).toBe(true)
    expect(() => manager.respond('r', 'c', approvalId, true)).toThrow()
  })
  it('invalidates waiting approval when the task is cancelled', async () => {
    const controller = new AbortController(); const events: AgentEvent[] = []
    const manager = new ToolApprovalManager(event => events.push(event))
    const pending = manager.ask('r', 'c', { tool: 'write', toolCallId: 't', args: {}, cwd: '', reason: 'test' }, controller.signal, () => {})
    const rejected = expect(pending).rejects.toThrow('取消'); controller.abort(); await rejected
    const event = events[0]; if (event.type !== 'approval' || !event.approval) throw new Error('missing approval')
    const approvalId = event.approval.id
    expect(() => manager.respond('r', 'c', approvalId, true)).toThrow()
  })
})
