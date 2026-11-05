# 开发指南

## 环境与命令

使用 Node.js 24+、`pnpm@12.6.0` 和系统 Git。依赖变更同时提交 `package.json` 与 `pnpm-lock.yaml`；`pnpm-workspace.yaml` 限制依赖安装脚本，新增原生依赖需审查 Electron ABI 和打包。

| 命令 | 用途 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 安装依赖 |
| `pnpm dev` / `pnpm preview` | 开发 / 预览；自动安装 Electron 运行时 |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | 类型检查 / 测试 / 编译 |
| `pnpm check` | 聚合检查 |
| `pnpm pack:dir` | 导出目录版至 `build-work/dir/` |
| `pnpm dist:win:all` | 导出 Windows x64 安装包、便携版及 ZIP |
| `pnpm dist:win` / `pnpm dist:win:portable` / `pnpm dist:win:zip` | 单独导出 Windows 发行包 |
| `pnpm dist:mac` | 导出 macOS DMG |

发行文件位于 `release/`，打包中间文件位于 `build-work/`，均不提交。Windows 可用 `pnpm.cmd`；也可运行 `scripts/dev-menu.bat`，macOS/Linux 可运行 `bash scripts/dev-menu.sh`。

首次 Windows 打包按需下载并校验固定版本的 NSIS 和 7-Zip，缓存于 `build-work/tools/`；缓存完整时可离线复用。发行脚本会检查包内主进程依赖。Windows 包未签名；跨平台安装与运行仍需在目标系统验收。

若 Electron 运行时下载失败，检查网络和代理，或配置 `ELECTRON_MIRROR` 后运行 `pnpm electron:install`。跳过安装脚本导致 esbuild 无法运行时，执行 `pnpm rebuild esbuild`。

## 应用图标

将静态 PNG 放在 `resources/app-icon.png`，运行 `pnpm icons:generate`，生成 Windows、macOS 和界面图标。生成过程保留原图比例并补透明留白；启动及打包不会自动重新生成图标。

## 代码约定

- UTF-8、LF、两空格缩进；TypeScript 使用 strict，不用 `any` 绕过边界校验。
- 普通文件和目录使用 kebab-case；React 组件、类型和类使用 PascalCase；函数和变量使用 camelCase。
- 共享 DTO 与 IPC 定义放在 `src/shared`，主进程服务放在 `src/main`，固定桥接放在 `src/preload`，界面放在 `src/renderer`。共享层不依赖 Electron 或 Renderer。
- 测试与代码同目录，命名为 `*.test.ts(x)`；临时数据放在 `.tmp/` 或 `tests/.artifacts/`。
- 界面默认不允许选择文字；需要复制的内容容器应加入 `styles.css` 的选择白名单。
- 升级 electron-builder、Google SDK 或 pi SDK 时，检查 `patches/` 中对应补丁及打包、网络适配是否仍有效。

## 提示词维护

提示词分布在系统规则、工具描述、计划交互和上下文摘要中；用户提示词及 Skill 不能覆盖权限、工具限制和审批。

| 入口 | 位置 |
| --- | --- |
| Agent 系统规则与模式 | `src/main/models/pi-system-prompt.ts` |
| 计划交互与纠偏 | `plan-tools.ts`、`pi-agent-service.ts` |
| 用户提示词分层 | `src/shared/prompts.ts` |
| 文件、终端和批量工具 | `pi-tools.ts`、`text-mutation-tools.ts`、`batch-tools.ts`、`download-tool.ts`、`filesystem-tools.ts` |
| 审核模型 | `tool-review-service.ts` |
| 上下文压缩 | `summary-prompt.ts`、`context-compaction.ts`、`pi-agent-service.ts` |
| 附件与技能注入 | `pi-attachments.ts`、`model-attachments.ts`、`google-attachments.ts` |

未写完整路径的文件位于 `src/main/models/`。SDK 也可能提供工具描述和压缩模板；升级时需核对实际调用路径。避免重复规则，但保留权限、覆盖风险和部分失败等必要语义；安全检查不能只依靠提示词。摘要应区分计划、批准、实际结果和未验证事项。

更新行为时同步维护对应文档；不要把构建通过当作跨平台实机验收通过。
