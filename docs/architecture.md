# 架构规划

适用产品：Pi Runner · 行动派。更新日期：2026-10-09。完整技术栈见[产品规格](product-specification.md)，实现进度见[开发路线](development-roadmap.md)。

## 进程边界

当前会话由主进程保存到用户主目录的 `.pi-runner/conversations.json`。会话列表、消息、图片、未发送草稿和选中会话在重启后恢复，不按时间或数量自动清理；只有用户确认删除对话或项目时才移除相应会话。写入采用临时文件加原子替换。读取失败时显示错误并禁止覆盖原文件，防止将未恢复的空列表保存为历史记录。

Renderer（React 19、Tailwind、git-diff-view）只负责界面；Preload 暴露固定的类型化方法，不透传 IPC 或 Node API；Main 持有项目选择权、文件系统与影子 Git。开启 contextIsolation、sandbox、webSecurity，关闭 nodeIntegration，拒绝额外窗口、导航和权限请求，并验证 IPC 来源及参数。

```text
Renderer → window.piRunner → Preload → Main IPC → ShadowGitManager
                                             → ConversationStore
                                             → ModelSettingsStore / PiAgentService（pi SDK）
```

现有目录：`src/shared` 定义 DTO/IPC；`src/main/snapshot` 管理快照；`src/preload` 提供桥接；`src/renderer` 提供工作台。git-diff-view 与计算 Worker 打包进应用，不使用 CDN；对比区使用库默认的行底色、增删符号、词级高亮与上下文展开控件。

快照改动列表和文件对比按项目存储路径与提交哈希缓存，跨管理器实例合并重复读取，并限制缓存大小；删除项目存储时清除相应缓存。展示层过滤在主进程读取缓存之后执行，不写回缓存，因此回滚与还原仍拿到完整改动。`FileDiff.hunks` 携带含文件头的 Git 差异，前后全文并行读取并保留，供默认控件展开上下文。审批预览在 Worker 内生成差异；两类对比的高亮与视图数据也在 Worker 内准备，增删统计复用同一结果，统一/分栏切换无需重新计算。界面的准备结果缓存有容量上限，每个视图使用独立副本。

## 快照策略

项目影子仓库与独立暂存工作树保存在 `app.getPath('home')/.pi-runner/projects/<项目路径 SHA-256>/shadow-git` 和 `staging` 下，能排除用户 Git 配置、属性过滤器及嵌套仓库的干扰，且不会在项目目录写入应用元数据。所有 Git 调用通过 simple-git 指定专用 GIT_DIR 与 GIT_WORK_TREE，隔离继承的 GIT_* 环境和全局配置，禁用换行转换、提交签名和钩子。采集在遍历和复制前应用内置排除规则与项目 `.gitignore`，随后强制添加暂存区内容。`src/main/snapshot/project-ignores.ts` 用 `ignore` 共用根与嵌套规则的解析及匹配（深目录规则优先，父目录被排除时不读取其中的规则），不读取全局 gitignore 与 `.git/info/exclude`。快照和恢复每次严格读取规则，除规则缺失外的读取错误会中止操作；展示过滤继续采用有限缓存，读取失败时保留可见文件。

同一影子存储在进程内跨 Manager 串行执行采集、差异读取与恢复，回滚的保护快照和后续恢复共用一次队列操作；尚无跨进程锁和配额。暂存区增量同步，依据源文件和暂存文件的设备、文件标识、大小及纳秒级 mtime、ctime 复用未变化文件；缓存按暂存路径隔离，进程内最多保留 32 个项目，失败、恢复或移除项目时失效。恢复与回滚在写入前按当前规则过滤候选路径，保护旧快照中当前已被排除的文件；不重写或清理历史提交。快照前必须暂停 Agent 工具写入。识别改名暂按删除和新增处理；二进制展示状态，不渲染文本。Diff 路径必须出现在指定提交间的改动列表中。

内置排除任意层级的 `.git`、`.pi-runner`、`node_modules`、`dist`、`out`、`build-work`、`release`、`exports`、`.aws`、`.ssh`、`.cache`、`.tmp`、`.turbo`、`.next`、`.nuxt`、`coverage`、`__pycache__`、`.pytest_cache`，以及 `.env`、`.env.*`、`.pi-runner-check-*`、`*.log`、`*.tmp`、`*.temp`、`*.tsbuildinfo`。内置规则优先于 `.gitignore` 否定规则，没有 `.gitignore` 也生效。不以此替代秘密扫描。拒绝符号链接/联接点和特殊文件；Git 不记录空目录，当前不保证 ACL、扩展属性、时间戳及完整权限元数据。复制前后检查源文件元数据，检测到变化时失败并丢弃基线；这仍不是文件系统原子快照，捕获时应停止外部写入，大文件限制待实现。

额外的编译工具与缓存规则如下。目录名只匹配目录及其子项，文件规则只匹配文件；新增规则按名称忽略大小写，在嵌套项目中同样生效。通用名称规则按项目标记限定范围；采集复用已列举的目录清单识别项目，恢复历史使用相同规则。`snapshot-project-profiles.ts` 集中登记扩展语言、框架与引擎的标记和相对输出路径，避免将 `vendor/`、`_build/`、`public/` 等名称全局排除。

| 工具或用途 | 排除目录 | 排除文件 |
| --- | --- | --- |
| Visual Studio / MSVC | `.vs/`、`ipch/` | `*.obj`、`*.pch`、`*.ipch`、`*.pdb`、`*.idb`、`*.ilk`、`*.exp`、`*.tlog`、`*.lastbuildstate`、`*.suo`、`*.sdf`、`*.opensdf`、`*.opendb`、`*.VC.db` 及其 `-shm`、`-wal` 文件；`*.vcxproj.user`、`*.csproj.user`、`*.vbproj.user`、`*.fsproj.user` |
| GCC / g++ / Clang | `.ccache/`、`.sccache/` | `*.o`、`*.lo`、`*.gch`、`*.gcda`、`*.gcno`、`*.gcov`、`*.dwo`、`*.dwp`、`*.profraw`、`*.profdata`、`*.su`、`*.opt-record.yaml`、`*.opt-record.json` 及对应 `.gz` |
| CMake / Ninja | `CMakeFiles/`、`cmake-build-*/`、`_deps/` | `CMakeCache.txt`、`cmake_install.cmake`、`install_manifest.txt`、`CTestTestfile.cmake`、`DartConfiguration.tcl`、`.ninja_deps`、`.ninja_log` |
| Autotools / Meson | `autom4te.cache/`、`.deps/`、`.libs/`、`meson-private/`、`meson-logs/`、`meson-info/` | — |
| vcpkg | 任意层级的 `vcpkg_installed/`；检测到普通文件 `.vcpkg-root` 的 SDK 根目录下，额外排除直属 `buildtrees/`、`packages/`、`downloads/`、`installed/` | — |
| Rust / Cargo | `target/`（也覆盖 Maven 等工具的同名构建目录）；`.cargo/registry/`、`.cargo/git/` | `*.rlib`、`*.rmeta`、`*.rs.bk`；`.cargo/` 下的 `.package-cache`、`.package-cache-mutate`、`.global-cache` 及其 `-shm`、`-wal` 文件 |
| Go | `.gocache/`、`.gomodcache/`、`go-build/`、`go-build<数字>/` | `go.mod` 或 `go.work` 所在目录及其子树内的 `*.test`、`*.test.exe`、`*.coverprofile`、`coverage.out`、`coverage.txt`、`coverage.html`、`covmeta.<十六进制>`、`covcounters.<十六进制>.<进程号>.<时间戳>` |
| Node / JS / TS | `.pnpm-store/`、`.npm/`、`.yarn-cache/`、`.parcel-cache/`、`.svelte-kit/`、`.angular/`、`.nyc_output/`、`.sass-cache/`、`.vite/`、`.vite-temp/`、`.rollup.cache/`、`.rpt2_cache/`、`.rts2_cache_cjs/`、`.rts2_cache_es/`、`.rts2_cache_umd/`、`.webpack-cache/`、`.docusaurus/`、`.astro/`、`.output/`、`.vercel/`、`.netlify/`、`.serverless/`、`.aws-sam/`、`.expo/`；`.yarn/` 下的 `cache/`、`unplugged/`、`sdks/`；`.nx/` 下的 `cache/`、`workspace-data/` | `.eslintcache`、`.stylelintcache`、`.pnp.js`、`.pnp.cjs`、`.pnp.loader.mjs`、`.pnp.data.json`；`.yarn/install-state.gz`、`.yarn/build-state.yml`；Vite、Vitest、Electron Vite 配置的 `timestamp-<数字>-<十六进制>.js/cjs/mjs` 临时副本 |
| JS / TS 测试报告 | `playwright-report/`、`test-results/`、`blob-report/` | — |
| Python | `.mypy_cache/`、`.ruff_cache/`、`.hypothesis/`、`.tox/`、`.nox/`、`.venv/`、`__pypackages__/` | — |
| Python / JVM 字节码及包缓存 | `.gradle/`、`.kotlin/`、`.nuget/` | `*.pyc`、`*.pyo`、`*.class` |
| C# / F# / VB / .NET | 含 `.csproj`、`.fsproj`、`.vbproj`、`.sln`、`.slnx` 或 `Directory.Build.props` 的目录下，排除直属 `bin/`、`obj/`、`TestResults/`、`artifacts/` | `*.msbuild.binlog` |
| Dart / Flutter / Swift | `.dart_tool/`、`.pub-cache/`、`.build/`、`.swiftpm-cache/` | `.packages`、`.flutter-plugins`、`.flutter-plugins-dependencies` |
| Unity | 同时含 `Assets/` 和 `ProjectSettings/` 的项目根目录下，排除 `Library/`、`Temp/`、`Obj/`、`Logs/`、`UserSettings/`、`Build/`、`Builds/`、`MemoryCaptures/`、`Recordings/` | — |
| Cocos Creator | 含 `assets/` 与 `project.json`，或含 `assets/` 与声明 `creator.version` 的 `package.json` 的项目根目录下，排除 `library/`、`temp/`、`local/`、`build/` | — |
| Godot | 任意层级的 `.godot/`；含 `project.godot` 的目录下，额外排除 `.import/`、`.mono/` | — |
| 编辑器 / 操作系统 | — | `*.swp`、`*.swo`、以 `~` 结尾的备份文件、`.DS_Store`、`Thumbs.db`、`Desktop.ini` |

扩展规则如下，路径均相对项目标记所在目录。表中列出主要产物，完整匹配项见 `snapshot-project-profiles.ts`。

| 语言、工具或引擎 | 项目标记 | 主要排除路径 |
| --- | --- | --- |
| Gradle / Android / Kotlin；sbt / Scala | `build.gradle(.kts)`、`settings.gradle(.kts)`；`build.sbt` | `build/`、`.gradle/`、`.kotlin/`、`.cxx/`、`.externalNativeBuild/`；`target/`、`.bloop/`、`.metals/` |
| Bazel；Buck；SCons | `WORKSPACE(.bazel)`、`MODULE.bazel`；`BUCK`、`.buckconfig`；`SConstruct` | `bazel-bin/`、`bazel-out/`、`bazel-testlogs/`、工作区直属 `bazel-*` 符号链接；`buck-out/`、`.buckd/`；`.sconf_temp/`、`.sconsign.dblite` |
| Python；Sphinx | `pyproject.toml`、`setup.py`、`setup.cfg`、`requirements.txt`、`Pipfile`、`tox.ini`；`conf.py` | `build/`、`.eggs/`、`*.egg-info/`、`htmlcov/`、`.pdm-build/`、`.coverage`、`.coverage.*`、`.pdm-python`；`_build/` |
| Bundler / Ruby；Rails | `Gemfile`；另需 `app/`、`config/` | `.bundle/cache/`、`vendor/bundle/`、`.yardoc/`、`_yardoc/`、`.byebug_history`；Rails 的 `tmp/{cache,pids,sockets}/`、`log/` |
| Composer / PHP；Laravel；Symfony | `composer.json`；`artisan`；`symfony.lock` | `vendor/`、`.phpunit.cache/`、`.phpunit.result.cache`；`bootstrap/cache/`、`storage/framework/{cache,sessions,views}/`、`storage/logs/`、`public/build/`、`public/hot`；`var/cache/`、`var/log/` |
| Elixir / Phoenix；Erlang | `mix.exs`；`rebar.config` | Elixir 的 `_build/`、`deps/`、`.elixir_ls/`、`cover/`；Erlang 的 `_build/`、`.rebar3/`、`ebin/`；两者的 `erl_crash.dump`、直属 `*.beam` |
| Haskell；OCaml | `stack.yaml`、`cabal.project`、`*.cabal`；`dune-project`、`dune-workspace`、`*.opam` | `.stack-work/`、`dist-newstyle/`、`.hpc/`、`.cabal-sandbox/` 及直属接口缓存；`_build/`、`_opam/` 及直属编译缓存 |
| Clojure | `deps.edn`、`project.clj`、`shadow-cljs.edn` | `.cpcache/`、`.clj-kondo/.cache/`、`.shadow-cljs/`、`target/` |
| R / RStudio；renv；Julia | `*.Rproj`、`DESCRIPTION`；`renv.lock`；`Project.toml`、`JuliaProject.toml` | `.Rproj.user/`、`*.Rcheck/`、`.Rhistory`、`.Rapp.history`；`renv/{library,staging,cache}/`；`.julia/{compiled,logs,scratchspaces}/`、`.CondaPkg/`、直属覆盖率与分配统计文件 |
| Zig；Nim；D；Fortran | `build.zig(.zon)`；`nim.cfg`、`config.nims`、`*.nimble`；`dub.json/sdl`；`fpm.toml` | `.zig-cache/`、`zig-cache/`、`zig-out/`；`nimcache/`、`.nimcache/`、`nimblecache/`；`.dub/`；`build/` |
| Xcode；Carthage；Qt | `*.xcodeproj/`；`Cartfile(.resolved)`；`*.pro` | `DerivedData/`、直属 `*.xcuserstate`；`Carthage/Build/`；`.qmake.stash`、`.qmake.cache`、直属 `moc_*.cpp`、`qrc_*.cpp`、`ui_*.h`、`*.moc` |
| LaTeX | `*.tex`、`*.ltx` | `latex.out/`、`_minted*/`；直属 `*.aux`、`*.fls`、`*.fdb_latexmk`、`*.toc`、`*.lof`、`*.lot`、`*.bcf`、`*.blg`、`*.synctex(.gz)` |
| Unreal Engine | `*.uproject`、`*.uplugin` | `Intermediate/`、`DerivedDataCache/`、`Saved/{Logs,Cooked,StagedBuilds,ShaderDebugInfo,Crashes}/`；含 `Source/` 时另排除 `Binaries/` |
| Defold；Ren’Py | `game.project`；`*.rpy` | `build/`、`.internal/`；`cache/`、直属 `*.rpyc` |
| Hugo；Jekyll | `hugo.toml/yaml/json`，或旧版 `config.toml/yaml/json` 加 `content/`、`themes/`；`_config.yml` | `public/`、`resources/_gen/`、`.hugo_build.lock`；`_site/`、`.jekyll-cache/`、`.sass-cache/`、`.jekyll-metadata` |
| Docusaurus；Gatsby；Remix；Svelte | 对应框架的 `*.config.js/ts/mjs/cjs` 或 `gatsby-config.*` | `build/`、`.docusaurus/`；`public/`、`.cache/`；`build/`、`public/build/`；`build/` |
| MkDocs；GitBook；Vagrant | `mkdocs.yml/yaml`；`book.json`；`Vagrantfile` | `site/`；`_book/`；`.vagrant/` |

另外排除专用目录 `.ipynb_checkpoints/`、`.pyre/`、`.pytype/`、`.pdm-build/`、`.pybuilder/`、`.webassets-cache/`、`.Rproj.user/`、`.elixir_ls/`、`.zig-cache/`、`.cxx/`、`.externalNativeBuild/`、`xcuserdata/`、`.terraform/`、`.buildx-cache/`、`.react-router/`、`.vinxi/`、`.nitro/`、`.qwik/`，以及 `.vitepress/cache/`、`.vuepress/.cache/`、`.vuepress/.temp/`。

对未列举的工具和自定义缓存目录，支持 [CACHEDIR.TAG 标准](https://bford.info/cachedir/)：进入子目录前验证其中普通文件 `CACHEDIR.TAG` 的前 43 字节是否为 `Signature: 8a477f597d28d172789f06886806bc55`，匹配时跳过整棵目录树；错误或不完整的签名不会触发排除。采集与恢复使用同一判断，每次操作重新识别标记；不创建或修改标记文件。其他自定义路径可写入项目 `.gitignore`。

保留 `CMakeLists.txt`、CMake Presets、`Makefile`、`build.ninja`、解决方案与项目文件、vcpkg 清单、配置、端口、三元组和锁文件。未将 `build/`、`bin/`、`lib/`、`Debug/`、`packages/`、`downloads/` 等通用目录名全局排除，也不全局排除 `.a`、`.lib`、`.so`、`.dll`、`.exe` 等可能作为依赖分发的文件；这些路径可通过项目 `.gitignore` 进一步排除。

扩展规则保留 Rails/Laravel 上传文件、数据库、R 的 `.RData`/`.rds`、Julia 的 `Manifest.toml` 与 `.julia/dev/`、CocoaPods 与 Carthage 的源码、LaTeX 的 PDF/图片/参考文献、Terraform 状态和锁文件。Unreal 保留 `Build/` 配置资源、`Saved/Autosaves/`、`Saved/SaveGames/`、`Saved/Config/` 及无源码插件的预编译二进制，`Content/`、`SourceArt/` 内的 `.obj` 模型也保留。Bazel 同前缀的普通源码目录保留。

扩展依据：[GitHub 各语言忽略模板](https://github.com/github/gitignore)、[Gradle 目录布局](https://docs.gradle.org/current/userguide/directory_layout.html)、[Unreal 目录结构](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-directory-structure)、[Bazel 输出目录](https://docs.bazel.build/versions/main/output_directories.html)。模板仅作为参考，保留用户数据和预置依赖。

保留 `Cargo.lock`、`.cargo/config.toml`、Go 清单及校验文件、`vendor/` 源码、JS/TS 清单与锁文件、`.yarn/patches`、`.yarn/releases`、`.yarn/plugins`、`.d.ts` 和已有 sourcemap、.NET 源码及项目配置。Unity/Cocos 资源目录及 Godot 项目中的 `.obj` 模型使用资源例外保留，不作为 MSVC 目标文件排除；资源 `.meta`、Unity 的 `ProjectSettings/`、`Packages/`，Cocos 的 `settings/`、`profiles/`、`extensions/`、`native/`、`build-templates/`，以及 Godot 的 `.import` 配置文件和 `.uid` 文件均保留。自定义的 Cargo 输出目录、Go 缓存目录及其他工具输出路径可通过 `.gitignore` 补充，不读取或修改项目外的全局缓存。

规则参考：[MSVC 调试信息格式](https://learn.microsoft.com/en-us/cpp/build/reference/z7-zi-zi-debug-information-format)、[GCC 覆盖率文件](https://gcc.gnu.org/onlinedocs/gcc/Invoking-Gcov.html)、[CMake 缓存](https://cmake.org/cmake/help/book/mastering-cmake/chapter/CMake%20Cache.html)、[vcpkg 安装目录](https://learn.microsoft.com/en-us/vcpkg/reference/installation-tree-layout)及其[官方仓库根标记](https://github.com/microsoft/vcpkg)。

语言与引擎规则参考：[Cargo 构建缓存](https://doc.rust-lang.org/cargo/reference/build-cache.html)、[Go 命令与缓存](https://go.dev/cmd/go/)、[Yarn 文件用途](https://yarnpkg.com/getting-started/qa)、[.NET 输出布局](https://learn.microsoft.com/en-us/dotnet/core/sdk/artifacts-output)、[Unity 默认目录](https://docs.unity.com/en-us/engine/7000.0/manual/get-started/project-configuration/default-directories)、[Cocos 项目结构](https://docs.cocos.com/creator/3.8/manual/zh/getting-started/project-structure/)、[Cocos 原生源码](https://github.com/cocos/cocos-docs/blob/master/versions/3.8/en/advanced-topics/native-secondary-development.md)、[Godot 导入流程](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/import_process.html)。

## 后续数据模型与轮次

使用 better-sqlite3，数据库位于 app.getPath('userData')，启用迁移、外键与 WAL；该原生依赖在接入时添加并针对 Electron ABI 重建。

| 实体 | 核心字段 |
| --- | --- |
| Session | id, canonicalProject, title, activeBranchId |
| Turn | id, sessionId, parentTurnId, branchId, prompt, response, status |
| ToolCall | id, turnId, name, arguments, result, status |
| Checkpoint | id, turnId, phase(base/end/recovery), hash, createdAt |
| RestoreJournal | id, sessionId, targetTurnId, recoveryHash, phase |
| SkillDefinition | id, name, description, source(builtin/custom/imported), version, contentHash, enabled |
| Plan | id, sessionId, status, currentRevisionId |
| PlanRevision | id, planId, requirements, executionSteps, contentHash, createdAt |
| PlanQuestion | id, planId, turnId, prompt, options, answer, answeredAt |
| PlanConfirmation | id, planId, revisionId, confirmedAt, executionTurnId |

执行轮流程：锁项目 → 持久化运行中的 Turn → 执行有界 Agent 工具循环，首次可能写入前保存私有恢复基线 → 无论成功、失败或取消，有基线时均比较结束文件树 → 仅实际变化时保存前后对照与轮次关联 → 解锁。计划澄清轮只保存对话与计划状态，不启动项目修改。崩溃恢复需区分私有恢复基线、孤立 Git 提交与未完成 Turn。

`prepareCheckpoint` 用独立的 `refs/pi-runner/pending/<UUID>` 引用保护执行前版本，不移动 HEAD，也不列入正式快照历史。收尾的 `completeCheckpoint` 在同一存储队列中重新采集并比较树：相同则删除本轮临时引用，不发布 snapshot 事件或对话关联；不同则从已采集的树生成前后提交，以当前 HEAD 为父链保留期间的手动快照，再一次性更新 HEAD。失败时保留私有基线，避免丢失执行前文件；完成后的无引用临时对象由 Git 的常规垃圾回收处理，不主动清理历史或压缩仓库。纯聊天、读取工具及已识别的只读命令连基线也不采集。

只读命令分析支持引号、PowerShell 调用运算符、字面量目录切换，以及分号、换行、`&&`、`||` 连接的查询。必须逐条确认只读；重定向、管道、动态展开、未知程序，以及任意一条可能写文件的语句都会触发执行前保护。Git 配置仅放行已列举的显示参数和关闭文件系统监视器；`rg --pre` 等可运行脚本的选项仍按可能写入处理。该判定只决定快照时机，不改变工具权限、沙箱和审批。

扩展查询规则集中在 `src/main/models/snapshot-read-only-queries.ts`：支持文件哈希、目录大小、系统及 PowerShell 信息查询，常见语言、编译器和包管理器的独立版本参数，Go 环境查询，npm/pnpm 依赖列表、npm 包配置读取、pip 包列表，以及 Docker 状态查询。Git 增加分支、标签、远程地址、工作树、配置及 stash 的明确查询形式。具有写入能力的工具按子命令和允许的选项匹配；例如 `go env -w`、`find -delete/-exec`、`tree -o`、Git 创建分支或标签、修改配置，以及构建、安装、执行脚本均保留基线。未知选项同样保留保护；不将 `yarn list` 或 `pnpm explain` 等可能回退到项目脚本的名称认定为只读。

## Skill 与计划模式

主进程 `SkillRegistry` 管理内置、自定义及导入定义；`SkillImporter` 读取 `SKILL.md` 和资源清单，校验标识、引用路径与内容，拒绝资源越界和符号链接逃逸。用户定义保存在应用 userData 下的 skills 目录；内置计划 Skill 随应用打包、独立标识且不可被同名导入覆盖。导入不运行脚本，启用 Skill 也不扩大工具权限。任务记录所用版本/内容哈希，执行中修改 Skill 不静默改变正在运行的任务。

`PlanCoordinator` 管理计划状态：`clarifying → awaiting-confirmation → executing → completed`，支持取消；补充或修正转回 `clarifying` 并生成新需求版本。每轮发出结构化问题事件，包含问题 ID、选目及末目自定义输入；Renderer 用选目弹窗展示，通过受限 Preload 方法提交答案。服务端校验当前问题、答案与状态，不接受过期或重复提交推进流程。

需求明确后保存不可变 `PlanRevision`，向用户展示完整需求、执行步骤及影响范围。最终确认事件必须来自用户界面并绑定当前版本，主进程原子记录确认与执行轮关联；模型文本、Skill 指令、超时和预选状态都不能作为确认。重复点击确认只启动一个执行轮。

计划 Skill 负责提问和汇总，工具调度器负责强制执行权限限制，不能仅依赖提示词禁止操作。确认前仅开放计划记录与受限只读上下文工具，禁用文件写入、补丁、Shell 和其他副作用工具。确认后捕获执行前快照并基于已确认版本执行；范围变更必须重新确认，具体风险操作仍遵循独立审批。

持久化待答问题、答案、需求版本和确认状态；重启后展示当前状态，不自动开始或恢复执行。回滚对话时同步恢复对应计划版本，已归档分支的确认不得授权新分支执行。

## 双轨回滚（尚未开放）

文件系统与 SQLite 无法共享真正的事务，需要可恢复的日志协议：

1. 用户选择目标轮次，展示将覆盖、删除的文件与当前未捕获改动；等待明确确认，停止工具并锁定项目。
2. 捕获 recovery 快照，写入恢复日志并持久化目标版本。
3. 校验目标清单的路径范围、符号链接、大小写冲突；在受控临时目录解包，再按清单恢复。禁止对用户目录使用 git clean 或整树删除。
4. 文件恢复成功后，在 SQLite 事务中更新分支与活动轮次；历史默认归档并保留恢复入口。硬恢复与分支恢复作为显式选目。
5. 标记日志完成；崩溃后依据日志补全或恢复 recovery 快照。验收须覆盖各阶段注入失败后的再次启动。

## 模型、凭证与工具

代理模型请求的错误在 `model-request-error.ts` 中按实际 HTTP 状态、服务错误码及原因生成中文提示。HTTP 错误在 SDK 改写前从响应副本提取；流事件、会话持久化、计划生成与最终请求结果保留同一份脱敏信息。认证、请求限流、额度不足、参数、上下文、网络与服务端错误分别显示；未知原因明确说明服务未提供详情，不能按供应商名称推断为授权或额度故障。错误正文限量读取，不回显整份 JSON 中的请求体、凭据或 Cookie。

Main 已接入 `ModelSettingsStore`，通过 safeStorage 加密 API Key，写入 userData 下的版本化配置文件。Endpoint/参数与密钥密文分字段保存；渲染层读取仅返回配置元数据与 `hasApiKey`，新密钥经专用 IPC 提交后清空输入。加密不可用时禁止明文降级。详情见[模型配置](model-configuration.md)。

`ModelService` 控制单请求、超时和取消；模型调用统一经由主进程加载的 pi SDK（`@earendil-works/pi-coding-agent`），由其负责流式回复、工具执行、会话历史与上下文压缩。连接测试使用固定短消息，不读取聊天历史或启用项目工具。URL 与参数在主进程验证，请求禁止跟随重定向，上游错误正文不传到 UI；模型 IPC 继续验证来源。

文件工具要校验路径与符号链接边界；终端命令是实际本机执行，项目自审模式经系统沙箱隔离，完全访问模式需首次确认。需要审批请求、输出上限、超时、进程树终止与取消。设置/确认弹窗使用已接入的 shadcn/ui + Radix。

## 验证范围

Windows 其他命令的实际兼容性见 [常用命令沙箱诊断](windows-command-sandbox.md)。安全边界通过不代表工具兼容；PowerShell 路径 cmdlet、宿主工具安装位置、配置缓存及子进程分别验证。Agent 优先通过专用文件工具执行项目内文件操作，不能根据沙箱中的命令查找失败断定本机未安装工具，也不能自动放宽权限。

Windows 项目自审模式在工具执行层增加命令恢复协调：有限的单条文件命令通过语义及边界校验后自动委派文件工具；新建临时区预置隔离配置缓存。对有限运行时命令，原操作开始前只读检查可发现性，优先使用已有项目内运行时；只有确认尚未执行且宿主工具存在时才发起本次完整本机权限审批，批准后同一次调用继续。拒绝/取消和执行中的权限或超时失败按任务记录，防止重复申请或重放。工具结果中的 recovery 状态及原始错误供模型核对完成部分，任务状态复用现有 AgentEvent.status；不新增持久化权限或放开 ACL。诊断与隔离失败不能自动转本机执行。

Windows 隔离终端的 Git 配置与工作目录兼容性检查见 [Windows Git 沙箱诊断](windows-git-sandbox.md)。MXC 和 AppContainer 准备项目执行环境时，从真实项目目录针对临时空仓库执行 Git status；宿主可定位 Git、隔离进程却找不到时不能静默跳过检查。首次配置或排查中的探针失败沿用兼容后端选择流程。复用旧 MXC 记录时，明确的兼容性故障也会在执行用户脚本之前自动选择 AppContainer，完成完整隔离测试后继续原请求并保存新后端。实际执行阶段才出现指定的 Git cwd 权限错误时，也恢复到经过验证的 AppContainer；仅严格匹配的有限只读 Git 查询组合自动重试一次，其他脚本不重复执行。普通命令错误及隔离边界失败不触发自动恢复。隔离 Git 使用临时 HOME 并关闭宿主全局、系统配置继承，项目 `.git` 保持只读。

当前单元测试覆盖真实 Git 的增删改、CRLF、中文空格路径、空提交、二进制、排除策略、重新打开及原仓库索引不变。文件恢复尚未实现，不能声称已通过回滚验收。macOS Intel/Apple Silicon、Windows 安装包、原生模块、长路径与终端行为须在目标系统单独验证。

设计参考：[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[electron-vite 入门](https://electron-vite.org/guide/)、[Git 环境变量与命令文档](https://git-scm.com/docs/git)。
