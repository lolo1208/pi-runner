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
| `pnpm dist:win:release` | 导出 Windows x64 安装包及解压即用 ZIP（CI 使用） |
| `pnpm dist:win:all` | 导出 Windows x64 安装包、便携版及 ZIP |
| `pnpm dist:win` / `pnpm dist:win:portable` / `pnpm dist:win:zip` | 单独导出 Windows 发行包 |
| `pnpm dist:mac` | 导出 macOS DMG |

发行文件位于 `release/`，打包中间文件位于 `build-work/`，均不提交。Windows 可用 `pnpm.cmd`；也可运行 `scripts/dev-menu.bat`，macOS/Linux 可运行 `bash scripts/dev-menu.sh`。

首次 Windows 打包按需下载并校验固定版本的 NSIS 和 7-Zip，缓存于 `build-work/tools/`；缓存完整时可离线复用。发行脚本会检查包内主进程依赖。Windows 包未签名；跨平台安装与运行仍需在目标系统验收。

若 Electron 运行时下载失败，检查网络和代理，或配置 `ELECTRON_MIRROR` 后运行 `pnpm electron:install`。跳过安装脚本导致 esbuild 无法运行时，执行 `pnpm rebuild esbuild`。

## GitHub 自动发布

工作流位于 `.github/workflows/release.yml`，自动构建 Windows x64 安装包与便携 ZIP，并上传到 GitHub Release 的 Assets；不生成自解压便携 EXE。macOS DMG 任务已作为注释保留，暂不执行，启用方法及签名、公证注意事项见工作流注释。

发布步骤：

1. 提交并推送待发布的代码（包括发布工作流）。无需修改 `package.json` 的 `version`。
2. 创建并推送目标版本标签：

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. 在 Actions 查看“构建并发布发行包”的运行状态；成功后在 Releases 页面下载 `pi-runner-setup.exe` 或 `pi-runner-portable.zip`。运行摘要也提供直接下载链接。

也可以在 GitHub 的 **Actions → 构建并发布发行包 → Run workflow** 中输入已存在的标签。手动触发同样检出标签对应提交，不会使用默认分支的应用代码；该标签中必须包含所需打包脚本。构建时自动将标签去掉 `v` 后写入 CI 工作区的 `package.json`，作为应用及安装包版本，不会提交或回写仓库；仓库内的 `version` 仍用于本地构建。标签支持 `v0.2.0-beta.1` 等预发布版本；带预发布后缀的 Release 不会标记为最新稳定版。

### Release 版本介绍来源

首次创建 Release 时，工作流通过 `gh release create --generate-notes` 请求 GitHub 自动生成发布说明，通常包括自上一版本以来合并的 PR、贡献者及完整变更对比链接；不是根据代码内容生成的功能总结，也不直接使用 tag 注释。没有 PR 时，自动说明可能比较简略。可在 GitHub 的 Releases 页面点击 Edit，手动补充面向用户的版本介绍。重复运行已有版本只更新状态和附件，不覆盖已有标题与正文。

发布使用 GitHub 内置 `GITHUB_TOKEN`，无需额外配置密钥；仓库需启用 Actions，且组织策略须允许发布任务使用 `contents: write`。重复运行会更新同名 Release 附件。同一标签的任务串行执行，构建失败不会进入发布任务。构建产物还会在 Actions 保留 7 天。

Windows 包未签名，首次启动可能触发系统安全提示。便携 ZIP 解压到可写目录后运行 `Pi Runner.exe`；“便携”指无需安装，不表示应用数据全部保存在程序目录。云端构建通过不等同于目标系统实机验收。

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
