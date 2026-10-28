import { afterEach, describe, expect, it, vi } from 'vitest'
import { commandRisk, readOnlyCommand } from './tool-permissions'

const reportedQueries = [
  `$files=Get-ChildItem cocos-proj/assets -Recurse -File; $files | Where-Object Extension -in '.mp3','.wav','.ogg','.mp4','.webm','.ttf','.otf','.woff','.woff2','.skel' | Select-Object FullName; $files | Where-Object Extension -eq '.anim' | ForEach-Object { $_.FullName.Substring((Get-Location).Path.Length+1) }; $files | Where-Object Extension -eq '.json' | ForEach-Object { try { $j=Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json; if($j.skeleton.spine){ [pscustomobject]@{Path=$_.FullName.Substring((Get-Location).Path.Length+1);Version=$j.skeleton.spine;Animations=($j.animations.PSObject.Properties.Name -join ', ')} } } catch {} } | Format-List`,
  String.raw`Get-Content node_modules/@esotericsoftware/spine-pixi-v8/dist/require-shim.js | Where-Object { $_ -notlike '//# sourceMappingURL*' }; Select-String -Path node_modules/@esotericsoftware/spine-pixi-v8/dist/Spine.js -Pattern 'static from|destroy\(' -Context 0,30 | Select-Object -First 5; Get-ChildItem node_modules/.pnpm -Directory -Filter '*spine-core*' | Select-Object Name; Get-Content node_modules/@esotericsoftware/spine-pixi-v8/dist/SpineTexture.js | Where-Object {$_ -notlike '//# sourceMappingURL*'} | Select-String -Pattern 'dispose' -Context 0,8`,
  String.raw`[System.IO.File]::ReadLines((Resolve-Path 'node_modules/@esotericsoftware/spine-pixi-v8/dist/require-shim.js')) | Where-Object { $_.Length -lt 1000 } | Select-Object -Last 30; [System.IO.File]::ReadLines((Resolve-Path 'node_modules/.pnpm/@esotericsoftware+spine-core@4.2.120/node_modules/@esotericsoftware/spine-core/dist/AnimationState.d.ts')) | Select-String -Pattern 'interface AnimationStateListener|listener:|animation:|setAnimation\(|removeListener|setMix' -Context 0,12 | Select-Object -First 12`,
]

// 只验证分类，不读取真实依赖、不运行用户脚本。
describe('PowerShell 只读投影与文件读取回归', () => {
  afterEach(() => vi.restoreAllMocks())
  it.each([
    ...reportedQueries,
    `Get-Content data.json -Raw | ConvertFrom-Json | ForEach-Object -Process { [pscustomobject]@{Name=$_.Name;Tags=($_.Tags -join ', ')} } | Format-List`,
    `[IO.File]::ReadAllText('data.json') | ConvertFrom-Json`,
    `[System.IO.File]::ReadAllLines((Resolve-Path -LiteralPath 'data.txt')) | Select-Object -First 10`,
    `Get-Content node_modules/.pnpm/@scope+pkg@1/node_modules/@scope/pkg/index.js | Where-Object { $_.Length -gt 0 }`,
  ])('项目自审直接放行并跳过快照：%s', command => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(readOnlyCommand(command)).toBe(true)
    expect(commandRisk(command).risk).toBe('safe')
  })

  it.each([
    `Get-ChildItem | ForEach-Object { & $_.FullName }`,
    `Get-ChildItem | ForEach-Object { Start-Process calc }`,
    `Get-ChildItem | ForEach-Object -Parallel { $_.Name }`,
    `Get-ChildItem | ForEach-Object Delete`,
    `Get-ChildItem | ForEach-Object { $_.Delete() }`,
    `Get-ChildItem | ForEach-Object { $_.Name } -Unknown`,
    `[pscustomobject]@{Name=(Start-Process calc)}`,
    `[pscustomobject]@{Name="$(Start-Process calc)"}`,
    `[pscustomobject]@{Name=[System.IO.File]::WriteAllText('x','y')}`,
    `[pscustomobject]@{Name='x'}; unknown-command`,
    `[SomeOtherType]@{Name='x'}`,
    `[System.IO.File]::OpenWrite('x')`,
    `[System.IO.File]::ReadLines((Start-Process calc))`,
    `[System.IO.File]::ReadLines((Resolve-Path 'x'; Start-Process calc))`,
    `[System.IO.File]::ReadLines('x', (Start-Process calc))`,
    `[System.IO.File]::ReadLines("$(Start-Process calc)")`,
    `[System.IO.File]::ReadLines('x').Delete()`,
    `$p=Get-Content secret; [System.IO.File]::ReadLines($p)`,
    `$u='https://example.com'; Get-ChildItem | ForEach-Object { Invoke-WebRequest $u; $u=Get-Content secret }`,
    `$u=Get-Content secret; Get-ChildItem | ForEach-Object { $u='https://example.com' }; Invoke-WebRequest $u`,
    `$u=[pscustomobject]@{Path='https://example.com'}; Invoke-WebRequest $u`,
  ])('危险或未知形式不因新语法放行：%s', command => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(readOnlyCommand(command)).toBe(false)
    expect(commandRisk(command).risk).not.toBe('safe')
  })

  it.each(reportedQueries)('不向 POSIX Shell 应用 PowerShell 语法：%s', command => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(readOnlyCommand(command)).toBe(false)
    expect(commandRisk(command).risk).not.toBe('safe')
  })
})
