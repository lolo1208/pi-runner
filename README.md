# Pi Runner · 行动派

Pi Runner 是一款本地运行的桌面 AI 编程助手。它让你通过对话处理项目任务，查看工具执行过程和文件差异，并在需要时恢复文件改动。应用基于 Electron、React 和 TypeScript，面向 Windows 和 macOS。

## 能做什么

- **对话与模型**：支持项目对话和无需选择项目的普通对话；接入 OpenAI、Anthropic、Google AI Studio、DeepSeek、OpenRouter、Ollama、ChatGPT 订阅及兼容接口。
- **代码操作**：通过文件和终端工具读取、修改项目，支持流式回复、附件与任务取消。
- **可控执行**：提供每次询问、项目自审和完全访问三种权限模式；计划模式先澄清需求并等待批准，再开始执行。
- **查看与恢复**：使用独立影子 Git 保存项目快照，按轮查看文件差异，并恢复文件改动，不修改项目自身的 Git 历史。
- **Skill**：创建或导入本地 Skill，按任务使用。

## 下载发行版

在本仓库的 **Releases** 页面下载对应系统的版本：

- `pi-runner-setup.exe`：Windows x64 安装包。
- `pi-runner-portable.zip`：Windows x64 便携版，解压到可写目录后运行 `Pi Runner.exe`，无需安装。
- `pi-runner-macos-arm64.dmg`：macOS Apple Silicon（M 系列）版本，打开后将 `Pi Runner.app` 拖入 Applications；不支持 Intel Mac。

Windows 包暂未签名，系统可能提示未知发布者，请确认下载来源。macOS 包暂未进行 Developer ID 签名与 Apple 公证，首次打开可能提示“已损坏”或无法验证开发者，处理方法见[macOS 安装与首次启动](docs/user-guide.md#macos-安装与首次启动)。

维护者推送 `v*` 版本标签即可自动发布，构建版本自动取自标签，无需修改 `package.json`，也可在 Actions 中手动指定已有标签，详见[自动发布说明](docs/development-guide.md#github-自动发布)。

## 开始使用

需要 Node.js 24+、pnpm 12.6.0 和系统 Git：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

启动后，在设置中配置模型供应商和密钥，选择项目或创建普通对话，即可开始。详见[使用指南](docs/user-guide.md)。

正式版关闭窗口后会收进托盘，后台任务继续运行；从托盘菜单选择「退出」才会退出。开发模式关闭窗口则直接退出。

## 安全与数据

会话和快照保存在本机，API Key 使用系统安全存储加密；使用远程模型时，发送的提示词和代码会传给相应服务商。快照不是完整备份：依赖、构建产物、凭证等排除项，以及项目外改动，不在恢复范围内。

工具权限是软件审核，不是操作系统沙箱；终端和子进程仍以当前用户权限运行。请信任项目及其依赖，并检查审批内容。详见[使用指南](docs/user-guide.md#权限模式)和[快照策略](docs/architecture.md#快照策略)。

## 开发与文档

```sh
pnpm typecheck
pnpm test
pnpm build
```

Windows 可使用 `pnpm.cmd`。打包和开发约定见[开发指南](docs/development-guide.md)。

- [使用指南](docs/user-guide.md)：模型配置、计划模式与权限
- [Claude 订阅](docs/claude-subscription.md)：官方 CLI 安装、绑定、计费保护与使用限制
- [开发指南](docs/development-guide.md)：开发、打包与提示词维护
- [技术架构](docs/architecture.md)：进程、数据、快照策略与 LLM 工具
- [模型数据与维护来源](docs/model-data-sources.md)：价格、默认参数、厂商国家及维护依据
