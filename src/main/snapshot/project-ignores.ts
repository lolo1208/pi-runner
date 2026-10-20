import { readFile, stat, lstat, readdir, open } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import ignore from 'ignore'
import type { ChangedFile } from '../../shared/api'
import { matchingSnapshotProfiles } from './snapshot-project-profiles'

/**
 * 改动列表的展示过滤：只隐藏项目 `.gitignore` 排除的路径。
 * 展示与快照共用规则解析；快照另外使用严格读取和内置排除规则。
 */
type ProjectMatcher = ReturnType<typeof ignore>
interface CachedRules { signature: string; at: number; directories: Map<string, ProjectMatcher> }

const IGNORE_FILE = '.gitignore'
const CACHE_TTL = 5000
const CACHE_LIMIT = 32
const cache = new Map<string, CachedRules>()

/** 与快照存储使用同一套路径规范化方式，避免同一项目出现两份缓存。 */
function canonicalRoot(root: string): string {
  const resolved = path.resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Git 差异列表只有项目相对路径；异常路径一律按未忽略处理，宁可多显示也不隐藏真实改动。 */
function safeRelativePath(value: string): string | null {
  const normalized = value.split('\\').join('/')
  const segments = normalized.split('/')
  if (!normalized || path.isAbsolute(value) || segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null
  return normalized
}

/** 由深到浅列出路径的各级目录，根目录用空字符串表示，对应 Git 的规则优先级。 */
function ancestorDirectories(relative: string): string[] {
  const segments = relative.split('/')
  const directories: string[] = []
  for (let index = segments.length - 1; index > 0; index--) directories.push(segments.slice(0, index).join('/'))
  directories.push('')
  return directories
}

async function readIgnoreFile(root: string, directory: string): Promise<{ content: string; signature: string } | null> {
  const file = path.join(root, ...directory.split('/').filter(Boolean), IGNORE_FILE)
  try {
    const info = await stat(file)
    if (!info.isFile()) return null
    // 目录内规则相对该目录解析，因此每个 .gitignore 单独建立匹配器。
    return { content: await readFile(file, 'utf8'), signature: `${directory}:${info.mtimeMs}:${info.size}` }
  } catch {
    // 读取失败等同于没有规则：界面保持原样，绝不因为过滤器出错而隐藏文件。
    return null
  }
}

/** 某级目录的规则命中情况：true 忽略、false 被否定规则重新包含、undefined 无规则命中。 */
function matchRules(rules: Map<string, ProjectMatcher>, relative: string): boolean | undefined {
  for (const directory of ancestorDirectories(relative)) {
    const entry = rules.get(directory)
    if (!entry) continue
    const scoped = directory ? relative.slice(directory.length + 1) : relative
    const result = entry.test(scoped)
    if (result.ignored) return true
    if (result.unignored) return false
  }
  return undefined
}

/** 父目录本身被排除时，Git 不读取其中的 .gitignore，也不允许重新包含子文件；这里只使用严格上层规则。 */
function directoryIgnored(rules: Map<string, ProjectMatcher>, directory: string): boolean {
  for (const parent of ancestorDirectories(directory)) {
    const entry = rules.get(parent)
    if (!entry) continue
    const scoped = parent ? directory.slice(parent.length + 1) : directory
    const result = entry.test(`${scoped}/`)
    if (result.ignored) return true
    if (result.unignored) return false
  }
  return false
}

function projectIgnored(rules: Map<string, ProjectMatcher>, relative: string): boolean {
  const segments = relative.split('/')
  for (let depth = 1; depth < segments.length; depth++) {
    if (directoryIgnored(rules, segments.slice(0, depth).join('/'))) return true
  }
  return matchRules(rules, relative) === true
}

const EXCLUDED_NAMES = new Set(['.git', '.pi-runner', 'node_modules', 'dist', 'out', 'build-work', 'release', 'exports', '.aws', '.ssh', '.cache', '.tmp', '.turbo', '.next', '.nuxt', 'coverage', '__pycache__', '.pytest_cache'])

// 只排除有明确工具用途的目录名，避免把 src/build、bin、lib 等源码或资源目录整体隐藏。
const EXCLUDED_DIRECTORIES = new Set([
  // Visual Studio、CMake、Autotools、Meson、vcpkg、编译缓存。
  '.vs', 'ipch', 'cmakefiles', '_deps', 'autom4te.cache', '.deps', '.libs',
  'meson-private', 'meson-logs', 'meson-info', 'vcpkg_installed', '.ccache', '.sccache',
  // 常见包管理器、前端、Python、JVM、.NET 工具缓存。
  '.pnpm-store', '.npm', '.yarn-cache', '.parcel-cache', '.svelte-kit', '.angular', '.nyc_output',
  '.mypy_cache', '.ruff_cache', '.hypothesis', '.tox', '.nox', '.venv', '__pypackages__',
  '.gradle', '.kotlin', '.nuget', '.sass-cache', '.eslintcache',
  // Rust、Go、JS/TS 与其他语言的专用构建缓存。
  'target', '.gocache', '.gomodcache', 'go-build', '.vite', '.vite-temp', '.rollup.cache',
  '.rpt2_cache', '.rts2_cache_cjs', '.rts2_cache_es', '.rts2_cache_umd', '.webpack-cache',
  '.docusaurus', '.astro', '.output', '.vercel', '.netlify', '.serverless', '.aws-sam',
  'playwright-report', 'test-results', 'blob-report',
  '.dart_tool', '.pub-cache', '.build', '.swiftpm-cache',
  '.godot', '.expo',
  '.ipynb_checkpoints', '.pyre', '.pytype', '.pdm-build', '.pybuilder', '.webassets-cache',
  '.rproj.user', '.elixir_ls', '.zig-cache', '.cxx', '.externalnativebuild', 'xcuserdata',
  '.terraform', '.buildx-cache', '.react-router', '.vinxi', '.nitro', '.qwik',
])
const EXCLUDED_FILES = new Set([
  'cmakecache.txt', 'cmake_install.cmake', 'install_manifest.txt', 'ctesttestfile.cmake',
  'dartconfiguration.tcl', '.ninja_deps', '.ninja_log',
  '.eslintcache', '.stylelintcache', '.ds_store', 'thumbs.db', 'desktop.ini',
  '.pnp.cjs', '.pnp.loader.mjs', '.pnp.data.json', '.pnp.js',
  '.packages', '.flutter-plugins', '.flutter-plugins-dependencies',
])
const EXCLUDED_FILE_PATTERNS = [
  /\.(?:log|tmp|temp|tsbuildinfo|swp|swo)$/i,
  // MSVC 编译、链接、IntelliSense 及本机用户状态。
  /\.(?:obj|pch|ipch|pdb|idb|ilk|exp|tlog|lastbuildstate|suo|sdf|opensdf|opendb)$/i,
  /\.vc\.db(?:-(?:shm|wal))?$/i,
  /\.(?:vcxproj|csproj|vbproj|fsproj)\.user$/i,
  // GCC、Clang 的目标文件、预编译头、覆盖率、分析与性能采样。
  /\.(?:o|lo|gch|gcda|gcno|gcov|dwo|dwp|profraw|profdata|su)$/i,
  /\.opt-record\.(?:yaml|json)(?:\.gz)?$/i,
  /\.(?:rlib|rmeta|rs\.bk|pyc|pyo|class|msbuild\.binlog)$/i,
  /^(?:vite|vitest|electron\.vite)\.config\..+\.timestamp-\d+-[a-f0-9]+\.(?:mjs|cjs|js)$/i,
  /~$/,
]
const VCPKG_OUTPUT_DIRECTORIES = new Set(['buildtrees', 'packages', 'downloads', 'installed'])
const CACHE_TAG_SIGNATURE = Buffer.from('Signature: 8a477f597d28d172789f06886806bc55', 'ascii')

function builtinExcluded(relative: string, directory: boolean, vcpkgRoots: Set<string>, engineAsset: boolean): boolean {
  const segments = relative.split('/')
  return segments.some((name, index) => {
    const lower = name.toLowerCase()
    const isDirectory = directory || index < segments.length - 1
    if (EXCLUDED_NAMES.has(lower) || /^\.env(?:\.|$)/i.test(name) || name.startsWith('.pi-runner-check-')) return true
    if (isDirectory) {
      if (EXCLUDED_DIRECTORIES.has(lower) || /^cmake-build-.+/i.test(name)) return true
      if (/^go-build\d+$/i.test(name)) return true
      const parent = segments[index - 1]?.toLowerCase()
      if (parent === '.cargo' && ['registry', 'git'].includes(lower)) return true
      if (parent === '.yarn' && ['cache', 'unplugged', 'sdks'].includes(lower)) return true
      if (parent === '.nx' && ['cache', 'workspace-data'].includes(lower)) return true
      if (parent === '.vitepress' && lower === 'cache') return true
      if (parent === '.vuepress' && ['.cache', '.temp'].includes(lower)) return true
      if (VCPKG_OUTPUT_DIRECTORIES.has(lower) && vcpkgRoots.has(segments.slice(0, index).join('/'))) return true
    } else {
      if (lower.endsWith('.obj') && engineAsset) return false
      const parent = segments[index - 1]?.toLowerCase()
      if (parent === '.yarn' && ['install-state.gz', 'build-state.yml'].includes(lower)) return true
      if (parent === '.cargo' && ['.package-cache', '.package-cache-mutate', '.global-cache', '.global-cache-shm', '.global-cache-wal'].includes(lower)) return true
      if (EXCLUDED_FILES.has(lower) || EXCLUDED_FILE_PATTERNS.some(pattern => pattern.test(name))) return true
    }
    return false
  })
}

/** 每次采集或恢复独立加载，规则在操作期间保持不变，不沿用展示缓存。 */
export class SnapshotFileRules {
  private readonly rules = new Map<string, ProjectMatcher>()
  private readonly vcpkgRoots = new Set<string>()
  private readonly projectOutputs = new Map<string, Set<string>>()
  private readonly goRoots = new Set<string>()
  private readonly engineAssets = new Set<string>()
  private readonly projectFiles = new Set<string>()
  private readonly projectEntries = new Set<string>()
  private readonly projectFilePatterns = new Map<string, RegExp[]>()
  private readonly projectDirectoryPatterns = new Map<string, RegExp[]>()
  private readonly taggedCaches = new Set<string>()

  constructor(private readonly root: string) {}

  /** 标准缓存标记覆盖未列举的工具及自定义输出路径，只读取固定长度签名。 */
  async excludesDirectory(relative: string): Promise<boolean> {
    if (this.excludes(relative, true)) return true
    const directory = path.join(this.root, relative)
    try {
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) return false
      const tag = path.join(directory, 'CACHEDIR.TAG')
      const tagInfo = await lstat(tag)
      if (!tagInfo.isFile() || tagInfo.isSymbolicLink()) return false
      const file = await open(tag, 'r')
      try {
        const header = Buffer.alloc(CACHE_TAG_SIGNATURE.length)
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        if (bytesRead !== header.length || !header.equals(CACHE_TAG_SIGNATURE)) return false
        this.taggedCaches.add(relative.toLowerCase())
        return true
      } finally { await file.close() }
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
      throw error
    }
  }

  async loadDirectory(directory: string, entries?: Dirent[]): Promise<void> {
    if (directory) {
      try {
        const parent = await lstat(path.join(this.root, directory))
        if (parent.isSymbolicLink()) throw new Error(`快照规则目录不能是符号链接：${directory}`)
        if (!parent.isDirectory()) return
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return
        throw error
      }
    }
    // 复用采集时的目录清单；恢复历史时才单独列举，避免为每种项目标记增加一次磁盘查询。
    const children = entries ?? await readdir(path.join(this.root, directory), { withFileTypes: true })
    const files = new Set(children.filter(entry => entry.isFile()).map(entry => entry.name.toLowerCase()))
    const directories = new Set(children.filter(entry => entry.isDirectory()).map(entry => entry.name.toLowerCase()))
    // 上层项目可能已为本目录登记嵌套缓存路径，必须保留这些规则。
    const scope = directory.toLowerCase()
    const outputs = this.projectOutputs.get(scope) ?? new Set<string>()
    this.projectOutputs.set(scope, outputs)
    for (const profile of matchingSnapshotProfiles(files, directories)) {
      for (const output of profile.directories ?? []) {
        const parts = output.split('/')
        const name = parts.pop()!
        const parent = [directory, ...parts].filter(Boolean).join('/').toLowerCase()
        const names = this.projectOutputs.get(parent) ?? new Set<string>()
        names.add(name)
        this.projectOutputs.set(parent, names)
      }
      for (const file of profile.files ?? []) this.projectFiles.add([directory, file].filter(Boolean).join('/').toLowerCase())
      if (profile.filePatterns) this.projectFilePatterns.set(scope, [...(this.projectFilePatterns.get(scope) ?? []), ...profile.filePatterns])
      if (profile.directoryPatterns) this.projectDirectoryPatterns.set(scope, [...(this.projectDirectoryPatterns.get(scope) ?? []), ...profile.directoryPatterns])
      for (const asset of profile.assetDirectories ?? []) this.engineAssets.add([directory, asset].filter(Boolean).join('/').toLowerCase())
      if (profile.skipBazelLinks) {
        // Bazel 的工作区链接也属于产物，直接跳过，避免普通链接拒绝逻辑阻止快照。
        for (const entry of children) {
          if (entry.isSymbolicLink() && /^bazel-/i.test(entry.name)) this.projectEntries.add([directory, entry.name].filter(Boolean).join('/').toLowerCase())
        }
      }
    }
    if ([...files].some(name => /\.(?:csproj|fsproj|vbproj|sln|slnx)$/.test(name)) || files.has('directory.build.props')) {
      for (const name of ['bin', 'obj', 'testresults', 'artifacts']) outputs.add(name)
    }
    if (files.has('go.mod') || files.has('go.work')) this.goRoots.add(directory)
    const unity = directories.has('assets') && directories.has('projectsettings')
    let cocos = directories.has('assets') && files.has('project.json')
    if (!cocos && directories.has('assets') && files.has('package.json')) {
      const entry = children.find(entry => entry.isFile() && entry.name.toLowerCase() === 'package.json')!
      try {
        const manifest = JSON.parse(await readFile(path.join(this.root, directory, entry.name), 'utf8'))
        cocos = typeof manifest?.creator?.version === 'string'
      } catch (error) {
        // 尚未完成编辑的清单不作为引擎证据，保留普通目录；读取错误仍中止采集。
        if (!(error instanceof SyntaxError)) throw error
      }
    }
    if (unity) {
      for (const name of ['library', 'temp', 'obj', 'logs', 'usersettings', 'build', 'builds', 'memorycaptures', 'recordings']) outputs.add(name)
    }
    if (cocos) {
      for (const name of ['library', 'temp', 'local', 'build']) outputs.add(name)
    }
    if (files.has('project.godot')) {
      for (const name of ['.import', '.mono']) outputs.add(name)
      // Godot 允许将模型等资源放在项目任意位置。
      this.engineAssets.add(directory.toLowerCase())
    }
    if (unity || cocos) this.engineAssets.add((directory ? `${directory}/assets` : 'assets').toLowerCase())
    this.projectOutputs.set(scope, outputs)
    // 使用普通文件标记识别 SDK 根目录；不全局排除 packages、downloads 或 installed。
    if (files.has('.vcpkg-root')) this.vcpkgRoots.add(directory)
    const file = path.join(this.root, directory, IGNORE_FILE)
    try {
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`快照忽略规则不是普通文件：${file}`)
      const content = await readFile(file, 'utf8')
      this.rules.set(directory, ignore({ ignorecase: process.platform === 'win32' }).add(content))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  excludes(relative: string, directory = false): boolean {
    const segments = relative.split('/')
    if (segments.some((name, index) => (directory || index < segments.length - 1) && this.projectOutputs.get(segments.slice(0, index).join('/').toLowerCase())?.has(name.toLowerCase()))) return true
    const lower = relative.toLowerCase()
    if (segments.some((_, index) => this.taggedCaches.has(segments.slice(0, index + 1).join('/').toLowerCase()))) return true
    if (!directory && this.projectFiles.has(lower)) return true
    if (segments.some((_, index) => this.projectEntries.has(segments.slice(0, index + 1).join('/').toLowerCase()))) return true
    if (segments.some((name, index) => (directory || index < segments.length - 1) && this.projectDirectoryPatterns.get(segments.slice(0, index).join('/').toLowerCase())?.some(pattern => pattern.test(name)))) return true
    if (!directory && this.projectFilePatterns.get(segments.slice(0, -1).join('/').toLowerCase())?.some(pattern => pattern.test(segments.at(-1)!))) return true
    const engineAsset = [...this.engineAssets].some(root => !root || lower.startsWith(`${root}/`))
    if (builtinExcluded(relative, directory, this.vcpkgRoots, engineAsset)) return true
    if (!directory && [...this.goRoots].some(root => !root || relative.startsWith(`${root}/`))) {
      if (/\.(?:test(?:\.exe)?|coverprofile)$/i.test(relative) || /^(?:coverage\.(?:out|txt|html)|covmeta\.[a-f0-9]+|covcounters\.[a-f0-9]+\.\d+\.\d+)$/i.test(segments.at(-1)!)) return true
    }
    return projectIgnored(this.rules, relative) || (directory && directoryIgnored(this.rules, relative))
  }

  /** 预读候选路径的上层规则；不进入已排除目录，也不读取其中的规则。 */
  async filter<T extends { path: string }>(files: T[]): Promise<T[]> {
    const directories = [...new Set(['', ...files.flatMap(file => ancestorDirectories(file.path))])].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    for (const directory of directories) {
      if (directory && await this.excludesDirectory(directory)) continue
      await this.loadDirectory(directory)
    }
    return files.filter(file => !this.excludes(file.path))
  }
}

async function loadRules(root: string, directories: string[]): Promise<Map<string, ProjectMatcher>> {
  const entries = await Promise.all(directories.map(async directory => ({ directory, loaded: await readIgnoreFile(root, directory) })))
  const signature = `${canonicalRoot(root)}\0${entries.map(entry => entry.loaded?.signature ?? `${entry.directory}:-`).join('|')}`
  const key = canonicalRoot(root)
  const cached = cache.get(key)
  if (cached && cached.signature === signature && Date.now() - cached.at < CACHE_TTL) return cached.directories
  const rules = new Map<string, ProjectMatcher>()
  for (const entry of entries) {
    if (!entry.loaded) continue
    // Windows 上 Git 默认忽略大小写，跟随该行为以免同一目录显示不一致。
    const matcher = ignore({ ignorecase: process.platform === 'win32' })
    matcher.add(entry.loaded.content)
    rules.set(entry.directory, matcher)
  }
  cache.delete(key)
  cache.set(key, { signature, at: Date.now(), directories: rules })
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return rules
}

/** 过滤展示用的改动列表；快照、回滚和还原不经过这里。 */
export async function filterIgnoredChanges(root: string, changes: ChangedFile[]): Promise<ChangedFile[]> {
  if (!changes.length) return changes
  const paths = changes.map(change => safeRelativePath(change.path))
  const directories = [...new Set(paths.flatMap(relative => relative ? ancestorDirectories(relative) : []))]
  if (!directories.length) return changes
  const rules = await loadRules(root, directories)
  if (!rules.size) return changes
  return changes.filter((change, index) => {
    const relative = paths[index]
    return !relative || !projectIgnored(rules, relative)
  })
}

/** 移除项目或重建项目存储后丢弃缓存，避免读取到已失效的规则。 */
export function clearProjectIgnoreCache(root: string): void {
  cache.delete(canonicalRoot(root))
}
