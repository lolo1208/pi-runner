const fs = require('node:fs/promises')
const path = require('node:path')
const { build, createTargets, Platform } = require('electron-builder')
const { packageWindows, assertX64, getCompiler } = require('./native-windows.cjs')
const { verifyPackagedRuntime } = require('./verify-packaged-runtime.cjs')
const { getSevenZip, compressDirectory } = require('./seven-zip.cjs')

const projectDir = path.resolve(__dirname, '..')

function getExportOptions(mode, host = process.platform) {
  const options = {
    win: { host: 'win32', platform: Platform.WINDOWS, target: 'nsis' },
    'win-all': { host: 'win32', platform: Platform.WINDOWS, target: 'dir' },
    'win-portable': { host: 'win32', platform: Platform.WINDOWS, target: 'portable' },
    'win-zip': { host: 'win32', platform: Platform.WINDOWS, target: 'zip' },
    mac: { host: 'darwin', platform: Platform.MAC, target: 'dmg' },
    dir: { host, platform: Platform.current(), target: 'dir' },
  }
  if (!Object.hasOwn(options, mode)) throw new Error('请选择有效的导出类型：win-all、win、win-portable、win-zip、mac、dir。')
  const option = options[mode]
  if (option.host !== host) throw new Error('请在对应系统上导出发行包：Windows 使用 win-all / win / win-portable / win-zip，macOS 使用 mac。')
  return option
}

async function copyArtifacts(artifacts, destination) {
  const releaseFiles = artifacts.filter(artifact => /\.(exe|dmg|zip|pkg)$/i.test(artifact))
  if (releaseFiles.length === 0) throw new Error('未找到可导出的发行文件，请检查打包输出。')
  await fs.mkdir(destination, { recursive: true })
  const exported = []
  for (const artifact of releaseFiles) {
    let output = path.join(destination, path.basename(artifact))
    try {
      await fs.copyFile(artifact, output)
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error
      throw new Error(`无法写入发行文件 ${output}，请关闭正在运行的同名程序并确认目录可写后重试。已生成的文件保留在 ${artifact}。`, { cause: error })
    }
    exported.push(output)
  }
  return exported
}

async function exportRelease(mode) {
  const started = performance.now()
  const option = getExportOptions(mode)
  const stagingDir = path.join(projectDir, 'build-work', mode)
  const destination = path.join(projectDir, 'release')
  const windowsRelease = ['win-all', 'win', 'win-portable', 'win-zip'].includes(mode)
  const nativeWindows = windowsRelease && mode !== 'win-zip'
  const config = { directories: { output: stagingDir }, afterPack: verifyPackagedRuntime }
  if (option.platform === Platform.WINDOWS) {
    // 直接使用已安装的 Electron，避免依赖下载缓存或联网获取运行时。
    const electronDist = path.join(path.dirname(require.resolve('electron/package.json')), 'dist')
    await assertX64(path.join(electronDist, 'electron.exe'))
    if (nativeWindows) await getCompiler(projectDir)
    if (windowsRelease) await getSevenZip(projectDir)
    config.electronDist = electronDist
    config.npmRebuild = false
    // 图标与版本信息仍由本地资源编辑器处理，不查询签名证书或下载签名工具。
    config.win = {
      signExecutable: false,
    }
  }
  let artifacts = await build({
    projectDir,
    targets: createTargets([option.platform], windowsRelease ? 'dir' : option.target, option.platform === Platform.MAC ? process.arch : 'x64'),
    publish: 'never',
    config,
  })

  if (windowsRelease) {
    const tasks = []
    if (nativeWindows) {
      tasks.push((async () => {
        const payload = await compressDirectory({ projectDir, stagingDir })
        const variants = mode === 'win-all' ? [false, true] : [mode === 'win-portable']
        const results = await Promise.allSettled(variants.map(portable => packageWindows({ projectDir, stagingDir, portable, payload })))
        const failed = results.find(result => result.status === 'rejected')
        if (failed) throw failed.reason
        return results.map(result => result.value)
      })())
    }
    if (mode === 'win-all' || mode === 'win-zip') {
      tasks.push(compressDirectory({ projectDir, stagingDir, zip: true }).then(file => [file]))
    }
    // 等待全部子进程结束后再报告失败，避免后台仍在写入产物。
    const results = await Promise.allSettled(tasks)
    const failed = results.find(result => result.status === 'rejected')
    if (failed) throw failed.reason
    artifacts = results.flatMap(result => result.value)
  }

  // release 仅平铺发行文件；目录版、更新文件和调试配置留在 build-work。
  if (mode === 'dir') {
    console.log(`\n免安装目录版已生成到：${stagingDir}`)
    return
  }
  await copyArtifacts(artifacts, destination)
  console.log(`\n发行内容已导出到：${destination}`)
  console.log(`打包与导出用时：${((performance.now() - started) / 1000).toFixed(1)} 秒（不含前置编译）`)
}

if (require.main === module) {
  exportRelease(process.argv[2]).catch(error => {
    console.error(`导出失败：${error.message}`)
    // electron-builder 注册了退出回调，显式传入失败码以免失败被报告为成功。
    process.exit(1)
  })
}

module.exports = { getExportOptions, copyArtifacts, exportRelease }
