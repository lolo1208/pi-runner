import { queryOptions } from './command-query-options'

export type DeveloperToolPolicy = { kind: 'read' | 'develop' }
  | { kind: 'review' | 'block'; reason: string; mustConfirm?: boolean }
const read: DeveloperToolPolicy = { kind: 'read' }
const develop: DeveloperToolPolicy = { kind: 'develop' }
const review = (reason: string, mustConfirm = false): DeveloperToolPolicy => ({ kind: 'review', reason, mustConfirm })
const block = (reason: string): DeveloperToolPolicy => ({ kind: 'block', reason })
const compilers = new Set(['gcc', 'g++', 'clang', 'clang++', 'cc', 'c++', 'cl', 'clang-cl', 'lld', 'lld-link', 'rustc', 'rustdoc', 'rustfmt'])
const installers = new Set(['vs_installer', 'vs_installershell', 'vs_buildtools', 'vs_community', 'vs_professional', 'vs_enterprise'])
const nodeTools = new Set(['node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node', 'ts-node-esm'])
const jsBuildTools = new Set(['tsc', 'vue-tsc', 'svelte-check', 'vite', 'vitest', 'jest', 'mocha', 'eslint', 'prettier', 'biome', 'webpack', 'rollup', 'esbuild', 'parcel', 'rspack', 'rsbuild', 'swc', 'oxlint', 'oxfmt'])

function hasOption(args: string[], name: string): boolean {
  return args.some((value, index) => value.startsWith(`${name}=`) && value.length > name.length + 1
    || value === name && Boolean(args[index + 1]) && !args[index + 1].startsWith('-'))
}

function tauriPolicy(args: string[]): DeveloperToolPolicy {
  if (args[0] === '--') args = args.slice(1)
  if (args.length === 1 && ['--version', '-V', '--help', '-h'].includes(args[0])) return read
  if (args[0] === 'info') return queryOptions(args.slice(1), ['--help', '-h']) ? read : review('Tauri 信息查询包含未知参数，需要审核。')
  if (args.some(value => value === 'signer' || /^--(?:private-key|ci-key)(?:=|$)/.test(value))) return review('Tauri 签名及密钥操作必须人工确认。', true)
  if (args.some(value => /^--config(?:=|$)/.test(value))) return review('Tauri 配置覆盖可能注入构建命令或改变目标路径，需要审核。')
  if (['dev', 'build', 'init', 'icon'].includes(args[0])) return develop
  if (['android', 'ios'].includes(args[0]) && ['dev', 'build', 'init'].includes(args[1])) return develop
  return review('未知 Tauri 子命令或插件管理操作，需要审核。')
}

/** 查询、项目构建、风险操作与直接文件修改分别路由；未知开发子命令不按程序名放行。 */
export function developerToolPolicy(program: string, args: string[]): DeveloperToolPolicy | undefined {
  const supported = compilers.has(program) || jsBuildTools.has(program) || nodeTools.has(program)
    || installers.has(program) || ['link', 'lib', 'llvm-lib', 'dumpbin', 'vswhere', 'devenv', 'msbuild', 'vcpkg', 'cargo', 'rustup', 'cmake', 'tauri', 'npm', 'pnpm', 'yarn', 'npx', 'bunx'].includes(program)
  if (!supported || program === 'link' && process.platform !== 'win32') return undefined
  if (args.some(value => value.startsWith('@'))) return review('响应文件可能隐藏输出路径、插件或执行参数，需要审核。')
  if (installers.has(program)) return review('Visual Studio 安装、修改、修复或卸载会改变本机工具链，必须人工确认。', true)
  if (args.length === 1 && ['--version', '--help', '-h', '-V', '/?'].includes(args[0])) return read
  if (args.length === 1 && args[0] === '-v' && ['node', 'nodejs', 'bun'].includes(program)) return read
  if (['cargo', 'rustc'].includes(program) && args.length === 1 && ['-Vv', '-vV'].includes(args[0])) return read

  if (program === 'vcpkg') {
    if (args[0] === 'integrate') return review('vcpkg 集成会修改用户或 IDE 配置，必须人工确认。', true)
    if (args[0] === 'version' && args.length === 1) return read
    if (args[0] === 'help' && queryOptions(args.slice(1), [], [], true, 1)) return read
    if (['list', 'search', 'owns', 'depend-info'].includes(args[0])) return queryOptions(args.slice(1), ['--x-full-desc', '--show-depth', '--dot', '--dgml'], ['--triplet', '--host-triplet', '--vcpkg-root']) ? read : review('vcpkg 查询包含未知参数，需要审核。')
    if (args[0] === 'install' && hasOption(args, '--x-install-root') && !args.some(value => /^--(?:clean-|recurse|editable)/.test(value))) return develop
    return review('vcpkg 默认安装根、卸载、升级、导出或未知操作需要审核；项目内安装需明确指定 --x-install-root。')
  }
  if (program === 'vswhere') return queryOptions(args, ['-latest', '-all', '-prerelease', '-legacy', '-utf8', '-nologo', '-requiresAny', '-include'], ['-products', '-requires', '-version', '-property', '-format', '-find', '-path']) ? read : review('vswhere 查询包含未知选项，需要审核。')
  if (program === 'dumpbin') {
    if (args.some(value => /^\/out(?::|$)/i.test(value))) return block('dumpbin 输出到文件请使用专用文件工具。')
    return args.every(value => !value.startsWith('/') || /^\/(?:headers|exports|imports|symbols|dependents|all|summary|nologo|rawdata(?::\w+)?)$/i.test(value)) ? read : review('dumpbin 包含未知参数，需要审核。')
  }
  if (['msbuild', 'devenv'].includes(program)) {
    if (args.some(value => /^\/(?:resetsettings|resetuserdata|resetskippkgs|setup|installvstemplates|updateconfiguration)(?::|$)/i.test(value))) return review('Visual Studio 用户配置或全局集成修改必须人工确认。', true)
    if (program === 'devenv') return args.some(value => /^\/(?:build|rebuild)$/i.test(value)) && args.every(value => !value.startsWith('/') || /^\/(?:build|rebuild|project|projectconfig|nosplash)$/i.test(value)) ? develop : review('IDE 启动、自动化、清理、部署、日志落盘或未知操作需要审核。')
    if (args.length === 1 && /^[-/](?:version|ver|help|\?)$/i.test(args[0])) return read
    for (const argument of args) {
      if (/^[-/](?:t|target):/i.test(argument) && argument.replace(/^[-/](?:t|target):/i, '').split(/[;,]/).some(value => !/^(?:build|rebuild|restore|compile|resolvereferences|gettargetpath|pack)$/i.test(value))) return review('MSBuild 清理、发布或自定义目标需要审核。')
      if (/^[-/](?:p|property):/i.test(argument) && argument.replace(/^[-/](?:p|property):/i, '').split(';').some(value => !/^(?:configuration|platform|targetframeworks?|runtimeidentifier|buildprojectreferences|restorepackagesconfig|outdir|intdir|outputpath|baseoutputpath|intermediateoutputpath|baseintermediateoutputpath)=/i.test(value))) return review('MSBuild 自定义属性可能加载脚本或改变执行目标，需要审核。')
      if (/^[-/](?:logger|l|distributedlogger|dl|restoreproperty|rp|toolsversion|tv|noautoresponse|nodeexe|bl|binarylogger|flp\d*|fileloggerparameters\d*)(?::|$)/i.test(argument)) return review('MSBuild 日志器、工具链或恢复属性需要审核。')
      if (/^[-/]/.test(argument) && !/^[-/](?:t|target|p|property|nologo|m|maxcpucount|nr|nodereuse|v|verbosity|r|restore|noconsolelogger|clp|consoleloggerparameters|fl|filelogger|ds|detailedsummary|interactive|graphbuild|isolateprojects)(?::|$)/i.test(argument)) return review('MSBuild 包含未知选项，需要审核。')
    }
    return develop
  }
  if (program === 'cmake') {
    if (args[0] === '-E') {
      if (args.length === 2 && args[1] === 'capabilities') return read
      if (['copy', 'copy_if_different', 'copy_directory', 'copy_directory_if_different', 'rename', 'remove', 'rm', 'remove_directory', 'make_directory', 'touch', 'touch_nocreate', 'create_symlink', 'create_hardlink', 'tar'].includes(args[1])) return block('CMake -E 直接文件操作请使用专用文件工具。')
      return review('CMake -E 执行入口需要审核。')
    }
    if (args.some(value => ['-P', '--install', '--system-information', '--fresh', '--clean-first', '--open'].includes(value) || /^-D(?:CMAKE_(?:PROJECT_.*INCLUDE|.*COMPILER_LAUNCHER|.*LINKER_LAUNCHER|TOOLCHAIN_FILE))[:=]/.test(value))) return review('CMake 脚本、工具链注入、清理、IDE 启动或安装操作需要审核。')
    return develop
  }
  if (program === 'rustup') {
    const query = ['show', 'check'].includes(args[0]) && queryOptions(args.slice(1), ['--verbose', '-v'])
      || args.length === 2 && ['toolchain', 'target', 'component'].includes(args[0]) && args[1] === 'list'
    return query ? read : review('Rust 工具链修改或未知查询参数需要审核。')
  }
  if (program === 'cargo') {
    if (args.length === 1 && args[0] === '--list') return read
    if (args[0] === 'version' && queryOptions(args.slice(1), ['--verbose', '-v'], [], false)) return read
    if (args[0] === 'tauri') return tauriPolicy(args.slice(1))
    if (args.some(value => value.startsWith('+') || /^--(?:config|registry|index)(?:=|$)/.test(value))) return review('Cargo 工具链选择、配置覆盖或注册表变更需要审核。')
    if (args[0] === 'metadata') return args.includes('--locked') && args.includes('--offline') && args.includes('--no-deps') && queryOptions(args.slice(1), ['--locked', '--offline', '--no-deps'], ['--format-version', '--manifest-path', '--filter-platform']) ? read : develop
    if (args[0] === 'locate-project') return queryOptions(args.slice(1), ['--workspace', '--message-format'], ['--message-format', '--manifest-path']) ? read : review('Cargo 项目查询包含未知参数，需要审核。')
    if (['build', 'b', 'check', 'c', 'test', 't', 'run', 'r', 'bench', 'doc', 'fetch', 'update', 'generate-lockfile', 'fmt', 'clippy', 'new', 'init', 'add', 'package'].includes(args[0])) return develop
    return review('Cargo 发布、安装、清理、卸载、未知别名或扩展子命令需要审核。')
  }
  if (program === 'tauri') return tauriPolicy(args)
  if (['npm', 'pnpm', 'yarn', 'npx', 'bunx'].includes(program)) {
    // 直接调用或包管理器脚本转发的 Tauri 子命令均参与风险判断。
    const index = args.findIndex(value => ['tauri', '@tauri-apps/cli'].includes(value))
    if (index >= 0) {
      const forwarded = tauriPolicy(args.slice(index + 1))
      // npm run 的同名脚本仍是项目代码，包执行器也可能安装依赖，不能标记为纯查询。
      return forwarded.kind === 'read' ? develop : forwarded
    }
    if (args.some(value => /^--(?:eval|require|import|loader|experimental-loader)(?:=|$)/.test(value))) return review('包管理器参数中包含内联代码或启动加载器，需要审核。')
    return undefined
  }
  if (compilers.has(program) || ['link', 'lib', 'llvm-lib'].includes(program)) {
    if (['gcc', 'g++', 'clang', 'clang++', 'cc', 'c++'].includes(program) && args.length === 1 && ['-v', '-dumpversion', '-dumpmachine', '-print-search-dirs', '-print-libgcc-file-name', '--print-targets'].includes(args[0])) return read
    if (program === 'rustc' && (args.length === 1 && /^--print=(?:target-list|sysroot|host-tuple|cfg)$/.test(args[0]) || args.length === 2 && args[0] === '--print' && ['target-list', 'sysroot', 'host-tuple', 'cfg'].includes(args[1]))) return read
    if (program === 'cl' && args.length === 1 && args[0] === '/Bv') return read
    if (args.some(value => /^-(?:fplugin|fpass-plugin|load|load-pass-plugin|specs|wrapper|Xclang|Xlinker)(?:=|$)/.test(value) || /^-(?:B|Z|Wl,)/.test(value) || /^--?(?:config|extern)(?:=|$)/.test(value) || /^\/(?:B1|B2|clang:|load|def:|analyze:|sourcedependencies)/i.test(value))) return review('编译器插件、外部后端、链接配置或配置覆盖需要审核。')
    const codegen = args.flatMap((value, index) => ['-C', '--codegen'].includes(value) ? [args[index + 1] ?? ''] : value.startsWith('-C') ? [value.slice(2)] : value.startsWith('--codegen=') ? [value.slice(10)] : [])
    if (codegen.some(value => /^(?:linker|link-args?|linker-plugin-lto)(?:=|$)/.test(value))) return review('Rust 编译器显式覆盖链接器或链接执行参数，需要审核。')
    return develop
  }
  if (jsBuildTools.has(program)) {
    if (args.some(value => /^--(?:clean|init|force|plugin|plugins|require|import|loader)(?:=|$)/.test(value) || /^--(?:config|configLoader)(?:=|$)/.test(value))) return review('JS/TS 工具显式清理、初始化、强制覆盖、插件或配置加载需要审核。')
    return develop
  }
  if (nodeTools.has(program)) {
    if (args.some(value => /^--(?:eval|print|require|import|loader|experimental-loader|preload|inspect(?:-brk|-wait)?|allow-[\w-]+|trust|unsafely-ignore-certificate-errors)(?:=|$)/.test(value) || /^-[^-]*[eprA]/.test(value))) return review('运行时内联代码、启动加载器、调试入口或扩大权限需要审核。')
    if (['node', 'nodejs'].includes(program)) {
      if (args.length === 2 && ['--check', '-c'].includes(args[0]) && !args[1].startsWith('-')) return read
      if (args[0] === '--test') return develop
      if (args[0] === '--watch') return args.length > 1 && /\.[cm]?js$/i.test(args[1]) ? develop : review('Node watch 的执行入口不明确，需要审核。')
      return /\.[cm]?js$/i.test(args[0] ?? '') ? develop : review('Node 的未知选项、标准输入或交互入口需要审核。')
    }
    if (['tsx', 'ts-node', 'ts-node-esm'].includes(program)) return /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(args[0] ?? '') || args[0] === 'watch' && /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(args[1] ?? '') ? develop : review('TS 执行器的配置、加载器或未知入口需要审核。')
    if (['run', 'test', 'build', 'bench', 'task', 'check', 'lint', 'fmt', 'cache', 'install', 'x'].includes(args[0])) return develop
    return review('运行时未知子命令需要审核。')
  }
  return undefined
}

/** 提取 Windows 附着式输出参数和嵌套输出路径，供现有项目外目标检查使用。 */
export function developerToolTargets(program: string, args: string[]): string[] {
  const targets: string[] = []
  for (const value of args) {
    if (['cl', 'clang-cl'].includes(program) && /^\/(?:Fo|Fe|Fd|Fp|Fa|Fi|FR|Fr).+/.test(value)) targets.push(value.slice(3))
    if (['cl', 'clang-cl'].includes(program) && /^\/doc:/.test(value)) targets.push(value.slice(5))
    if (['cl', 'clang-cl', 'link', 'lld-link', 'lib', 'llvm-lib'].includes(program) && /^\/(?:out|pdb|implib):/i.test(value)) targets.push(value.replace(/^\/[^:]+:/, ''))
    if (compilers.has(program) && /^-o.+/.test(value)) targets.push(value.slice(2))
    if (['tsc', 'vue-tsc', 'svelte-check'].includes(program) && /^-p.+/.test(value)) targets.push(value.slice(2))
    if (program === 'rustc' && value.startsWith('--emit=')) for (const output of value.slice(7).split(',')) if (output.includes('=')) targets.push(output.slice(output.indexOf('=') + 1))
    if (program === 'msbuild' && /^[-/](?:p|property):/i.test(value)) for (const property of value.replace(/^[-/](?:p|property):/i, '').split(';')) if (/^(?:outdir|intdir|outputpath|baseoutputpath|intermediateoutputpath|baseintermediateoutputpath)=/i.test(property)) targets.push(property.slice(property.indexOf('=') + 1))
  }
  return targets
}

/** MSVC/MSBuild 的 /c、/t:Build 等是选项；其附着式输出路径另行提取校验。 */
export function windowsDeveloperSwitch(program: string, value: string): boolean {
  return process.platform === 'win32' && ['cl', 'clang-cl', 'link', 'lld-link', 'lib', 'llvm-lib', 'msbuild', 'devenv'].includes(program) && /^\/[^/\\]/.test(value)
}
