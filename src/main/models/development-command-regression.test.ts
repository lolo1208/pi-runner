import { afterEach, describe, expect, it, vi } from 'vitest'
import { commandRisk, readOnlyCommand } from './tool-permissions'

// 分类测试不联网、不安装依赖，也不执行打包或项目脚本。
describe('开发命令审核回归', () => {
  afterEach(() => vi.restoreAllMocks())

  const queries = [
    'node --version; npm --version; npm view electron version; npm view electron-vite version engines peerDependencies --json; npm view vite version engines --json; npm view react version; npm view react-dom version; npm view pixi.js version; npm view electron-builder version; npm view typescript version; npm view @vitejs/plugin-react version engines peerDependencies --json',
    'npm view electron-vite@5.0.0 peerDependencies engines --json; npm view vite@7.3.1 version; npm view @vitejs/plugin-react@5.1.4 peerDependencies --json; npm view typescript@5.9.3 version; npm view @types/node@24 version --json; npm view @types/react version; npm view @types/react-dom version',
    'npm view vite@7.3.7 dependencies --json; npm view electron-vite@5.0.0 dependencies --json',
    'pnpm view pnpm@12.6.0 engines --json; pnpm help approve-builds; pnpm help import',
    'npm audit --json',
    'pnpm audit --json --audit-level high',
    'npm.cmd view @types/node@24 version --json',
    'pnpm.cmd info @vitejs/plugin-react@5.1.4 peerDependencies --json',
    'node -v; nodejs --help; bun --version; deno --version',
  ]
  it.each(queries)('直接放行查询：%s', command => {
    expect(commandRisk(command).risk).toBe('safe')
    expect(readOnlyCommand(command)).toBe(true)
  })

  it.each([
    'pnpm exec electron --version',
    'pnpm exec electron-vite --version',
    'npm exec electron --version',
    'node -e "console.log(require.resolve(\'electron\')); try { console.log(require(\'electron\')) } catch(e) { console.error(e.message); process.exitCode=1 }"',
    'node .tmp/step2/smoke.cjs',
    'node scripts/smoke.mjs',
    'pnpm install --frozen-lockfile',
    'npm ci',
    'pnpm import',
    'pnpm run pack:win',
    'pnpm install --frozen-lockfile && pnpm run pack:win',
  ])('开发操作放行但保留快照：%s', command => {
    expect(commandRisk(command).risk).toBe('safe')
    expect(readOnlyCommand(command)).toBe(false)
  })

  it('识别 PowerShell 查询管道和混合查询', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const command = 'npm ls --depth=0; Get-ChildItem release -File | Select-Object Name,Length; Get-Content out/preload/index.js; Get-ChildItem resources/game -File | Select-Object Name'
    expect(commandRisk(command).risk).toBe('safe')
    expect(readOnlyCommand(command)).toBe(true)
  })

  it.each([
    `pnpm exec electron --version; node -e "console.log(require.resolve('electron')); try { console.log(require('electron')) } catch(e) { console.error(e.message); process.exitCode=1 }"; Get-ChildItem node_modules/electron -Force | Select-Object Name; Get-ChildItem Env:ELECTRON*`,
    `Get-ChildItem node_modules/electron-vite/dist -File | Select-String -Pattern 'Electron uninstall' -Context 12,10; Get-Content node_modules/electron/package.json -Raw | ConvertFrom-Json | Select-Object scripts | ConvertTo-Json; pnpm dev`,
  ])('放行 Electron 混合诊断：%s', command => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(commandRisk(command).risk).toBe('safe')
    expect(readOnlyCommand(command)).toBe(false)
  })

  it.each([
    'pnpm install --frozen-lockfile; if ($LASTEXITCODE -eq 0) { pnpm run pack:win }',
    'npm ci; if ($LASTEXITCODE -eq 0) { npm run build; npm test }',
    'pnpm install; if ($?) { pnpm build }',
    'pnpm run core:check; if ($LASTEXITCODE -eq 0) { pnpm run storage:check }; if ($LASTEXITCODE -eq 0) { pnpm run build }',
    'npm ci; if ($?) { npm test }; if ($LASTEXITCODE -eq 0) { npm run build; npm run lint };',
    'pnpm test;\nif ($LASTEXITCODE -eq 0) { pnpm typecheck };\nif ($?) { pnpm build }',
  ])('放行成功条件尾块：%s', command => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(commandRisk(command).risk).toBe('safe')
    expect(readOnlyCommand(command)).toBe(false)
  })

  it.each([
    'npm view @packages version',
    'npm view $(danger) version',
    'pnpm view electron --unknown-option',
    'npm audit fix --json',
    'pnpm audit --fix',
    'node --require hook.cjs script.cjs',
    'node --version --eval danger',
    `node -e "console.log(require('electron')); require('fs').writeFileSync('x', 'y')"`,
    `node -e "console.log(require('../outside'))"`,
    `node -e "console.log(require.resolve('electron')); try { console.log(require('other')) } catch(e) { console.error(e.message); process.exitCode=1 }"`,
    'pnpm exec electron --version --require hook.cjs',
    'npm ci; if ($LASTEXITCODE -eq 0) { unknown-command }',
    'pnpm test; if ($LASTEXITCODE -eq 0) { unknown-command }; if ($LASTEXITCODE -eq 0) { pnpm build }',
    'pnpm test; if ($(danger) -eq 0) { pnpm lint }; if ($LASTEXITCODE -eq 0) { pnpm build }',
    'pnpm test; if ($LASTEXITCODE -eq 0) { pnpm lint }; if ($LASTEXITCODE -eq 0) { unknown-command }',
    'pnpm test; if ($LASTEXITCODE -eq 0) { pnpm lint }; if ($LASTEXITCODE -eq 0) { pnpm build }; unknown-command',
    'pnpm test; if ($LASTEXITCODE -eq 0) { pnpm install --global typescript }; if ($LASTEXITCODE -eq 0) { pnpm build }',
    'npm ci; if ($(danger) -eq 0) { npm run build }',
    'npm ci; if ($LASTEXITCODE -eq 0) { npm run build }; unknown-command',
    'Get-ChildItem | unknown-command',
    'pnpm install --global typescript',
  ])('未知语法及风险操作仍需审核：%s', command => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(commandRisk(command).risk).toBe('approve')
  })

  it('连续条件块仍检查项目外目标及人工确认操作', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(commandRisk('pnpm test; if ($LASTEXITCODE -eq 0) { pnpm --dir ".." build }; if ($LASTEXITCODE -eq 0) { pnpm lint }', process.cwd()).risk).toBe('approve')
    const risk = commandRisk('pnpm test; if ($LASTEXITCODE -eq 0) { chmod 777 folder }; if ($LASTEXITCODE -eq 0) { pnpm build }')
    expect(risk.risk).toBe('approve')
    expect(risk.mustConfirm).toBe(true)
  })

  it('连续 PowerShell 条件块不适用于 POSIX Shell', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(commandRisk('pnpm test; if ($LASTEXITCODE -eq 0) { pnpm lint }; if ($LASTEXITCODE -eq 0) { pnpm build }').risk).toBe('approve')
  })

  it.each([
    'npm ci; if ($LASTEXITCODE -eq 0) { Set-Content output.txt data }',
    'pnpm test; if ($LASTEXITCODE -eq 0) { Set-Content x y }; if ($LASTEXITCODE -eq 0) { pnpm build }',
    'npm view electron version > output.txt',
    'Get-ChildItem | Remove-Item',
  ])('直接文件写入仍拦截：%s', command => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(commandRisk(command).risk).toBe('block')
  })
})
