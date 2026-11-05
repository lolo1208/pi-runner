# 技术架构

## 进程与数据

Renderer 负责界面；Preload 提供固定的类型化 `window.piRunner` 接口；Main 管理 IPC、模型、文件、权限和快照。Renderer 启用 context isolation、sandbox 和 web security，不直接访问 Node API；Main 校验 IPC 来源及参数。

会话保存在 `~/.pi-runner/conversations.json`，代理历史保存在 `~/.pi-runner/agent-sessions/`。模型配置位于应用 userData，密钥由 Electron safeStorage 加密。Skill 定义由主进程管理，导入不执行脚本，也不扩大工具权限。

## pi-coding-agent 接入

主进程通过 `@earendil-works/pi-coding-agent` 运行代理会话，使用：

- `AgentSession` 和 `ModelRuntime` 发起模型请求、处理流式事件与工具调用，并支持取消。
- `SessionManager` 保存和恢复代理历史，使用上下文压缩管理长会话。
- SDK 的文件读取、搜索、文本修改和终端工具定义；应用在其上封装权限检查，并补充批量、目录、下载、计划与技能工具。
- 动态工具列表，在计划模式下限制可调用的工具。

会话界面、模型配置、权限审批、Skill 管理和影子快照由 Pi Runner 实现；工具清单见下文。

## 快照策略

每个项目的影子 Git 仓库和暂存区位于 `~/.pi-runner/projects/<项目路径哈希>/`，不修改项目自身的 Git 索引、配置或历史。首次可能写入前保存私有基线；任务结束、失败或取消后比较文件树，仅在实际变化时发布前后快照。纯聊天、读取和已识别的只读命令不建立基线。

采集与恢复遵循项目 `.gitignore`（含嵌套规则）及内置排除规则，不读取全局 gitignore 或 `.git/info/exclude`。内置规则优先，覆盖凭证、依赖、常见构建产物和缓存；具体规则见 `src/main/snapshot/project-ignores.ts` 和 `snapshot-project-profiles.ts`。有效的 `CACHEDIR.TAG` 也会排除对应目录。自定义排除项可写入项目 `.gitignore`。恢复时保护当前已排除的文件，不清理旧快照历史。

快照不覆盖空目录、ACL、扩展属性或时间戳；拒绝符号链接、联接点和特殊文件。采集并非文件系统原子快照，操作期间应停止外部写入。项目外改动无法通过项目快照恢复。

## LLM 工具与权限

可用工具取决于任务模式、平台、技能和会话权限；连接测试不启用项目工具。文件操作经过路径校验与权限审批，项目修改前保存快照；终端以当前用户权限运行，并非操作系统沙箱。权限模式详见[使用指南](user-guide.md#权限模式)。

<sup>Pi</sup> 表示基于 pi-coding-agent 的工具定义，应用在其上增加权限等封装。

### 文件与目录

| 工具 | 用途 |
| --- | --- |
| `read` <sup>Pi</sup> / `read_many` | 读取单个 / 多个文本文件或图片，支持分段。 |
| `ls` <sup>Pi</sup> | 列出目录内容。 |
| `find` <sup>Pi</sup> | 按 glob 查找文件和目录。 |
| `grep` <sup>Pi</sup> | 搜索文件内容。 |
| `stat` | 查看文件或目录的类型、大小和修改时间。 |
| `write` <sup>Pi</sup> / `write_many` | 创建或完整覆盖单个 / 多个 UTF-8 文本文件。 |
| `edit` <sup>Pi</sup> / `edit_many` | 精确替换单个 / 多个文本文件中的内容；匹配必须唯一且不重叠。 |
| `delete` | 删除单个普通文件。 |
| `mkdir` / `rmdir` | 创建 / 删除目录；删除非空目录需指定 `recursive=true`。 |
| `move` / `copy` | 移动或复制文件、目录；目标必须不存在。 |
| `download` / `download_many` | 下载单个 / 多个 HTTP/HTTPS 文件，可选 SHA-256 校验。 |

批量工具每次支持 1–100 项，不保证事务性；应逐项检查结果。移动、复制或递归删除失败时可能留下部分结果，需先核对再处理。

### 终端

| 工具 | 用途 |
| --- | --- |
| `powershell` <sup>Pi</sup> | 在 Windows 上执行 PowerShell 命令。 |
| `bash` <sup>Pi</sup> | 在 macOS / Linux 上执行 Bash 命令。 |

每次只提供当前平台对应的终端工具。

### 计划

| 工具 | 用途 |
| --- | --- |
| `ask_user_question` | 计划模式下向用户提出选项问题。 |
| `submit_plan` | 计划模式下提交计划供用户审阅；须先收到本轮问题的回答。 |

计划批准前，只开放只读文件工具、技能工具和计划交互工具；批准后仍遵循当前权限审批。

### 技能

| 工具 | 用途 |
| --- | --- |
| `read_skill_file` | 读取可用技能的 `SKILL.md` 或其他资源，可同时记录本轮用途。 |
| `report_skill_usage` | 记录本轮已使用技能的用途。 |

技能工具仅在存在可用技能时提供。
