const path = require('node:path')
const { spawnSync } = require('node:child_process')

// 使用包内 Electron 和 app.asar 验证依赖，避免开发机 node_modules 掩盖打包缺失。
const verificationCode = `
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const main = process.argv[1];
const parent = pathToFileURL(main).href;
const source = readFileSync(main, 'utf8');
const imports = [...source.matchAll(/^import\\s+.*?\\s+from\\s+['"]([^'"]+)['"]/gm)];
if (!imports.length) throw new Error('未找到主进程依赖，无法验证打包内容');
for (const [, specifier] of imports) {
  if (specifier === 'electron' || specifier.startsWith('node:')) continue;
  await import(import.meta.resolve(specifier, parent));
}
console.log('打包后的主进程依赖加载验证通过');
process.exit(0);
`

function verifyRuntime(executable, main) {
  const result = spawnSync(executable, [
    '--experimental-import-meta-resolve', '--input-type=module', '--eval', verificationCode, main,
  ], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`打包后的主进程依赖加载失败：\n${result.error?.message || result.stderr || result.stdout || `退出码 ${result.status}`}`)
  }
  console.log(result.stdout.trim())
}

async function verifyPackagedRuntime({ appOutDir, electronPlatformName, packager }) {
  const product = packager.appInfo.productFilename
  const executable = electronPlatformName === 'darwin'
    ? path.join(appOutDir, `${product}.app`, 'Contents', 'MacOS', product)
    : path.join(appOutDir, electronPlatformName === 'win32' ? `${product}.exe` : packager.appInfo.executableName)
  const main = path.join(packager.getResourcesDir(appOutDir), 'app.asar', 'out', 'main', 'index.mjs')
  verifyRuntime(executable, main)
}

module.exports = { verifyRuntime, verifyPackagedRuntime }
