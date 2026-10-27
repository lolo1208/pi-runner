# 开发与命名规范

## 产品标识

| 用途 | 名称 |
| --- | --- |
| 产品全名 | Pi Runner · 行动派 |
| 英文 / 中文 | Pi Runner / 行动派 |
| 包名 / 推荐仓库目录 | `pi-runner` |
| application ID | `dev.pirunner.desktop` |
| 桥接类型 / 对象 | `PiRunnerApi` / `window.piRunner` |
| 影子仓库与暂存区 | `~/.pi-runner/projects/<项目路径哈希>/` |

## 命名约定

以语言与生态惯例为依据，项目内保持一致；不为无关领域类和变量加产品名前缀。

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| 目录、普通 TS、文档 | kebab-case | `shadow-git-manager.ts`、`development-guide.md` |
| React 组件文件与组件 | PascalCase | `App.tsx`、`ChangedFilesList` |
| 类、接口、类型 | PascalCase，无 I/T 前缀 | `ShadowGitManager`、`PiRunnerApi` |
| 变量、属性、函数 | camelCase，体现职责 | `snapshotManager`、`rendererUrl`、`createCheckpoint` |
| 布尔状态 | 优先 is/has/can/should | `isBusy`、`canRestore` |
| 固定模块常量 | UPPER_SNAKE_CASE | `IPC_CHANNELS`、`EXCLUDED_NAMES` |
| Hook | use + PascalCase | `useSession` |
| 测试文件 | 模块名 + `.test.ts(x)` | `shadow-git-manager.test.ts` |
| IPC 通道 | 领域:动作，使用共享常量 | `snapshot:create` |
| 数据库（接入时） | snake_case，表用复数 | `tool_calls`、`turn_id` |
| 自定义环境变量 | PI_RUNNER_ + UPPER_SNAKE_CASE | `PI_RUNNER_LOG_LEVEL` |

工具入口保留惯例，如 `index.ts`、`main.tsx`、`env.d.ts` 和 `electron.vite.config.ts`；外部 API 名称不重写。避免语义模糊的模块级 `data`、`manager`；局部循环索引可用 `i`。

使用 UTF-8、LF、两空格缩进，见 `.editorconfig`。TypeScript strict；不要用 `any` 绕过边界校验。格式化/lint 作具尚未接入，后续应纳入检查命令。

## 目录边界

```text
src/
  main/index.ts                      # 生命周期与 IPC
  main/snapshot/shadow-git-manager.ts
  main/snapshot/project-ignores.ts     # 展示层 .gitignore 过滤
  preload/index.ts                   # 固定桥接方法
  shared/api.ts                      # DTO、通道常量、接口
  renderer/index.html
  renderer/src/main.tsx              # React 挂载
  renderer/src/App.tsx               # 工作台组件
  renderer/src/styles.css
  renderer/src/env.d.ts
  main/models/pi-tools-permission.test.ts
docs/
```

后续按领域增加 `main/agent`、`main/storage`、`main/tools` 和 Renderer 组件/Hook 目录，避免无职责的 utils 集合。共享层不依赖 Electron 或 Renderer。原生模块接入时明确 Electron ABI 与打包验证。

## pnpm 工作流

固定 `pnpm@12.6.0`，Node.js 24+。只提交 `pnpm-lock.yaml`；依赖变更使用 `pnpm add` / `pnpm add -D` / `pnpm remove`，同时提交 manifest 和锁文件。CI 冻结锁文件安装。

`pnpm-workspace.yaml` 使用 hoisted 布局以配合 Electron 打包，仅允许 Electron 和 esbuild 构建脚本。新增原生依赖逐项审查，不全局放行。参考 [pnpm 设置](https://pnpm.io/settings)及[锁文件导入](https://pnpm.io/cli/import)。

| 命令 | 用途 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 安装已锁依赖 |
| `pnpm dev` | 桌面热重载 |
| `pnpm typecheck` / `pnpm test` | 类型检查 / 集成测试 |
| `pnpm build` / `pnpm check` | 编译 / 聚合检查 |
| `pnpm pack:dir` | 本机未安装应用目录 |
| `pnpm dist:win` / `pnpm dist:mac` | 平台安装包 |
| `pnpm dist:win:all` | 一次构建 Windows x64 安装包、便携版与 ZIP，共用目录及预压缩载荷 |
| `pnpm dist:win:portable` / `pnpm dist:win:zip` | 单独导出便携版 / ZIP |
| `pnpm electron:install` | 显式下载并校验 Electron 运行时；dev/preview 自动先执行 |
| `pnpm rebuild esbuild` | 重建 esbuild 构建依赖 |

`pack:dir` 避免与 pnpm 内置 `pack` 混淆。编译输出 `out/`、打包工作目录 `build-work/` 和最终发行目录 `release/` 不提交，也不进入项目快照。Windows 可用 `pnpm.cmd`。

Windows 推荐在 dev-menu 输入 `a`，或执行 `pnpm dist:win:all`。菜单 `b/c/d` 分别单独导出安装包、便携版、ZIP。三件套仅执行一次构建、目录打包和包内依赖校验；7-Zip 多线程生成 ZIP 与共享 LZMA2 载荷后，两个 NSIS 外壳并行生成，不重复压缩载荷。固定版本 7-Zip 安装包与工具文件按 SHA-256 校验并缓存在 `build-work/tools/`，工具损坏时从已校验的包重新解出。Electron 只保留简体中文与英语，asar 排除映射、类型声明和开发文档，保留许可证；调整排除规则后必须通过包内依赖加载验证。

工具权限见[权限模式与自动审核](tool-permissions.md)。三种模式共享文件路径校验和终端执行前审核，系统临时目录可用于临时文件，网络不逐项审批。终端及子进程使用当前用户权限，开发命令放行意味着信任其脚本行为。

Windows 安装包与便携版首次打包时才自动下载固定版本的 NSIS，并校验 SHA-256；工具保存在 `build-work/tools/nsis-x64-3.13.7507.353/`，后续校验并复用，缺失或损坏时重新下载。首次准备工具还会下载并校验官方 7-Zip `26.04`，借助 electron-builder 的解压工具解出完整 7-Zip，再解出 NSIS；无需系统安装这些工具，也不执行下载的安装程序。仓库仅保留 `scripts/nsis-x64-manifest.json` 的版本与校验信息，`scripts/vendor/` 旧工具目录已忽略，无需提交。macOS 开发和打包不准备这些 Windows 工具。首次下载失败时，检查 GitHub Releases 的网络访问或 `HTTP_PROXY` / `HTTPS_PROXY`（也支持小写形式），然后重新运行打包命令；缓存就绪后可离线复用。

### Electron uninstall 启动错误

若主进程和 Preload 编译成功，但启动时报 `Electron uninstall`，检查 Electron 二进制是否已安装。当前 Electron 44 的包没有安装时下载运行时的 postinstall，`pnpm rebuild electron` 可能直接成功但并未下载；应使用 `pnpm electron:install`（调用包内 `install-electron`）。`dev` 和 `preview` 已串联此步骤，下载失败时停止启动，避免显示误导性的应用卸载错误。`build` 保持纯编译，不需要桌面运行时。

下载失败时检查 GitHub Releases 的网络访问或代理。可按 [Electron 官方安装说明](https://www.electronjs.org/docs/latest/tutorial/installation)配置 `ELECTRON_MIRROR`；保留包内校验和，不关闭 TLS 或校验验证。

安装脚本复用 Electron 官方安装器，检测到已有 `HTTP_PROXY` / `HTTPS_PROXY`（含小写形式）时启用其代理支持，不写入或输出代理地址。下载超过 5 分钟会停止并提示重试；本机没有配置代理时保持默认直连。

## 界面选择约定

全局默认不可选中：`styles.css` 中 `html, body` 设置 `user-select: none`，标题栏、侧边栏、输入区工具条、底部状态栏、下拉菜单与提示浮层等界面语言都不参与文本选择。真正需要复制的正文在同一个 `:where(...)` 白名单里显式放开，新增可复制内容区时把容器类加进该列表（用 `:where()` 保持零优先级，便于局部覆盖），不要反过来给单个控件补 `user-select: none`。空输入框的占位提示由 `.composer textarea:placeholder-shown` 单独保持不可选中。

## 本地测试与临时文件

当前自动测试文件随被测代码放在 `src/`，`pnpm test` 使用 Vitest 默认发现规则。手动探测数据、日志和测试脚本产物放在已忽略的 `.tmp/` 或 `tests/.artifacts/`，不要写到项目根目录。Electron 冒烟脚本的截图与测试数据也属于忽略的测试产物。

文件与终端工具的权限逻辑位于 `security-paths.ts`、`pi-tools.ts`、`tool-permissions.ts` 和 `tool-review-service.ts`。审核模型通过设置、IPC 和模型配置存储传递，选项为空时跟随默认模型。

## 交付与文档维护

发行脚本在压缩前使用包内 Electron 加载 `app.asar` 中的主进程依赖；加载失败会停止导出，避免发布无法启动的程序。`patches/app-builder-lib@26.15.3.patch` 兼容 pnpm 新版 JSON 配置输出，确保打包工具正确识别 hoisted 布局并收集嵌套依赖的对应版本。补丁由 `pnpm-workspace.yaml` 注册，离线安装也会自动应用；升级 electron-builder 时须重新检查补丁和包内运行时依赖加载检查。

说明行为变化、验证结果和未解决问题；编译通过不等于跨平台验收通过。需求更新规格，边界/数据格式更新架构，进度更新路线，验证追加验收记录。存储、应用 ID 或目录更名须说明兼容与迁移子响。
