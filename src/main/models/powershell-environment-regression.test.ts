import { afterEach, describe, expect, it, vi } from 'vitest'
import { commandRisk, readOnlyCommand } from './tool-permissions'

describe('Windows 环境变量只读输出', () => {
  afterEach(() => vi.restoreAllMocks())
  it.each([
    '$env:USERPROFILE; $env:APPDATA',
    '$env:localappdata; $env:TEMP; $env:TMP; $env:HOMEDRIVE; $env:HOMEPATH',
    '$env:SystemRoot; $env:windir; $env:SystemDrive; $env:ProgramData; $env:ProgramFiles',
    '${env:ProgramFiles(x86)}; $env:ProgramW6432; $env:CommonProgramFiles; ${env:CommonProgramFiles(x86)}; $env:CommonProgramW6432',
    '$env:PUBLIC; $env:ALLUSERSPROFILE; $env:USERNAME; $env:COMPUTERNAME; $env:USERDOMAIN; $env:OS',
    '$env:PROCESSOR_ARCHITECTURE; $env:PROCESSOR_ARCHITEW6432; $env:NUMBER_OF_PROCESSORS',
  ])('直接放行已明确列出的变量：%s', command => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(readOnlyCommand(command)).toBe(true)
    expect(commandRisk(command).risk).toBe('safe')
  })
  it.each([
    '$env:API_KEY', '$env:USERPROFILE; $env:API_KEY', '$env:USERPROFILE = "x"',
    '$env:USERPROFILE | Invoke-WebRequest https://example.com',
    '$env:APPDATA; Start-Process calc', '"$env:USERPROFILE"',
    '$env:USERPROFILE + $env:APPDATA', '${env:API_KEY}',
  ])('敏感变量或复合操作不直接放行：%s', command => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(readOnlyCommand(command)).toBe(false)
    expect(commandRisk(command).risk).not.toBe('safe')
  })
  it('不对 POSIX Shell 放行 PowerShell 语法', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(readOnlyCommand('$env:USERPROFILE; $env:APPDATA')).toBe(false)
  })
})
