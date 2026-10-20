/** 按项目标记启用的规则，只作用于标记所在目录；不排除整个仓库中的同名路径。 */
export interface SnapshotProjectProfile {
  name: string
  anyFiles?: string[]
  filePattern?: RegExp
  allDirectories?: string[]
  directoryMarker?: RegExp
  directories?: string[]
  directoryPatterns?: RegExp[]
  files?: string[]
  filePatterns?: RegExp[]
  assetDirectories?: string[]
  skipBazelLinks?: boolean
}

// 所有标记与固定路径均使用小写；路径相对项目根目录，支持嵌套缓存目录。
export const SNAPSHOT_PROJECT_PROFILES: readonly SnapshotProjectProfile[] = [
  { name: 'Gradle / Android / Kotlin', anyFiles: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'], directories: ['build', '.gradle', '.kotlin', '.cxx', '.externalnativebuild'] },
  { name: 'sbt / Scala', anyFiles: ['build.sbt'], directories: ['target', '.bloop', '.metals'] },
  { name: 'Bazel', anyFiles: ['workspace', 'workspace.bazel', 'module.bazel'], directories: ['bazel-bin', 'bazel-out', 'bazel-testlogs'], skipBazelLinks: true },
  { name: 'Buck', anyFiles: ['buck', '.buckconfig'], directories: ['buck-out', '.buckd'] },
  { name: 'SCons', anyFiles: ['sconstruct'], directories: ['.sconf_temp'], files: ['.sconsign.dblite'] },
  { name: 'Python / Django / Flask', anyFiles: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'pipfile', 'tox.ini'], directories: ['build', '.eggs', 'htmlcov', '.pdm-build'], directoryPatterns: [/\.egg-info$/i], files: ['.coverage', '.pdm-python'], filePatterns: [/^\.coverage\./i] },
  { name: 'Sphinx', anyFiles: ['conf.py'], directories: ['_build'] },
  { name: 'Bundler / Ruby', anyFiles: ['gemfile'], directories: ['.bundle/cache', 'vendor/bundle', '.yardoc', '_yardoc'], files: ['.byebug_history'] },
  { name: 'Rails', anyFiles: ['gemfile'], allDirectories: ['app', 'config'], directories: ['tmp/cache', 'tmp/pids', 'tmp/sockets', 'log'] },
  { name: 'Composer / PHP', anyFiles: ['composer.json'], directories: ['vendor', '.phpunit.cache'], files: ['.phpunit.result.cache'] },
  { name: 'Laravel', anyFiles: ['artisan'], directories: ['bootstrap/cache', 'storage/framework/cache', 'storage/framework/sessions', 'storage/framework/views', 'storage/logs', 'public/build'], files: ['public/hot'] },
  { name: 'Symfony', anyFiles: ['symfony.lock'], directories: ['var/cache', 'var/log'] },
  { name: 'Elixir / Phoenix', anyFiles: ['mix.exs'], directories: ['_build', 'deps', '.elixir_ls', 'cover'], files: ['erl_crash.dump'], filePatterns: [/\.beam$/i] },
  { name: 'Erlang / rebar3', anyFiles: ['rebar.config'], directories: ['_build', '.rebar3', 'ebin'], files: ['erl_crash.dump'], filePatterns: [/\.beam$/i] },
  { name: 'Haskell', anyFiles: ['stack.yaml', 'cabal.project'], filePattern: /\.cabal$/i, directories: ['.stack-work', 'dist-newstyle', '.hpc', '.cabal-sandbox'], filePatterns: [/\.(?:hi|hie|dyn_hi|dyn_o|eventlog)$/i] },
  { name: 'OCaml / Dune', anyFiles: ['dune-project', 'dune-workspace'], filePattern: /\.opam$/i, directories: ['_build', '_opam'], filePatterns: [/\.(?:cmo|cmi|cmx|cmxs|cmxa|cmt|cmti|annot)$/i] },
  { name: 'Clojure / Leiningen / shadow-cljs', anyFiles: ['deps.edn', 'project.clj', 'shadow-cljs.edn'], directories: ['.cpcache', '.clj-kondo/.cache', '.shadow-cljs', 'target'] },
  { name: 'R / RStudio', anyFiles: ['description'], filePattern: /\.rproj$/i, directories: ['.rproj.user'], directoryPatterns: [/\.rcheck$/i], files: ['.rhistory', '.rapp.history'] },
  { name: 'renv', anyFiles: ['renv.lock'], directories: ['renv/library', 'renv/staging', 'renv/cache'] },
  { name: 'Julia', anyFiles: ['project.toml', 'juliaproject.toml'], directories: ['.julia/compiled', '.julia/logs', '.julia/scratchspaces', '.condapkg'], filePatterns: [/\.jl(?:\.\d+)?\.(?:cov|mem)$/i] },
  { name: 'Zig', anyFiles: ['build.zig', 'build.zig.zon'], directories: ['.zig-cache', 'zig-cache', 'zig-out'] },
  { name: 'Nim', anyFiles: ['nim.cfg', 'config.nims'], filePattern: /\.nimble$/i, directories: ['nimcache', '.nimcache', 'nimblecache'] },
  { name: 'D / Dub', anyFiles: ['dub.json', 'dub.sdl'], directories: ['.dub'] },
  { name: 'Fortran / fpm', anyFiles: ['fpm.toml'], directories: ['build'] },
  { name: 'Xcode', directoryMarker: /\.xcodeproj$/i, directories: ['deriveddata'], filePatterns: [/\.xcuserstate$/i] },
  // 保留 Pods 和 Carthage 的源码、补丁、配置；这里只排除可再生成的编译结果。
  { name: 'Carthage', anyFiles: ['cartfile', 'cartfile.resolved'], directories: ['carthage/build'] },
  { name: 'Qt / qmake', filePattern: /\.pro$/i, files: ['.qmake.stash', '.qmake.cache'], filePatterns: [/^moc_.+\.cpp$/i, /^qrc_.+\.cpp$/i, /^ui_.+\.h$/i, /\.moc$/i] },
  { name: 'LaTeX', filePattern: /\.(?:tex|ltx)$/i, directories: ['latex.out'], directoryPatterns: [/^_minted/i], filePatterns: [/\.(?:aux|fls|fdb_latexmk|toc|lof|lot|bcf|blg|synctex(?:\.gz)?)$/i] },
  { name: 'Unreal Engine', filePattern: /\.(?:uproject|uplugin)$/i, directories: ['intermediate', 'deriveddatacache', 'saved/logs', 'saved/cooked', 'saved/stagedbuilds', 'saved/shaderdebuginfo', 'saved/crashes'], assetDirectories: ['content', 'sourceart'] },
  // 无源码的插件可能依赖预编译二进制，因此只对含 Source 的项目排除 Binaries。
  { name: 'Unreal Engine 源码构建', filePattern: /\.(?:uproject|uplugin)$/i, allDirectories: ['source'], directories: ['binaries'] },
  { name: 'Defold', anyFiles: ['game.project'], directories: ['build', '.internal'] },
  { name: "Ren'Py", filePattern: /\.rpy$/i, directories: ['cache'], filePatterns: [/\.rpyc$/i] },
  { name: 'Hugo', anyFiles: ['hugo.toml', 'hugo.yaml', 'hugo.json'], directories: ['public', 'resources/_gen'], files: ['.hugo_build.lock'] },
  { name: 'Jekyll', anyFiles: ['_config.yml'], directories: ['_site', '.jekyll-cache', '.sass-cache'], files: ['.jekyll-metadata'] },
  { name: 'Docusaurus', filePattern: /^docusaurus\.config\.(?:js|ts|mjs|cjs)$/i, directories: ['build', '.docusaurus'] },
  { name: 'Gatsby', filePattern: /^gatsby-config\.(?:js|ts|mjs|cjs)$/i, directories: ['public', '.cache'] },
  { name: 'Remix', filePattern: /^remix\.config\.(?:js|ts|mjs|cjs)$/i, directories: ['build', 'public/build'] },
  { name: 'Svelte', filePattern: /^svelte\.config\.(?:js|ts|mjs|cjs)$/i, directories: ['build'] },
  { name: 'MkDocs', anyFiles: ['mkdocs.yml', 'mkdocs.yaml'], directories: ['site'] },
  { name: 'GitBook', anyFiles: ['book.json'], directories: ['_book'] },
  { name: 'Hugo 旧版配置', anyFiles: ['config.toml', 'config.yaml', 'config.json'], allDirectories: ['content', 'themes'], directories: ['public', 'resources/_gen'], files: ['.hugo_build.lock'] },
  { name: 'Vagrant', anyFiles: ['vagrantfile'], directories: ['.vagrant'] },
]

export function matchingSnapshotProfiles(files: Set<string>, directories: Set<string>): SnapshotProjectProfile[] {
  const fileNames = [...files]
  const directoryNames = [...directories]
  return SNAPSHOT_PROJECT_PROFILES.filter(profile => {
    const marker = profile.anyFiles?.some(file => files.has(file)) ||
      (profile.filePattern && fileNames.some(file => profile.filePattern!.test(file))) ||
      (profile.directoryMarker && directoryNames.some(directory => profile.directoryMarker!.test(directory)))
    return marker && (!profile.allDirectories || profile.allDirectories.every(directory => directories.has(directory)))
  })
}
