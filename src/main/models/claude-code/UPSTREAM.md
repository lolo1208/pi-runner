# 上游来源与本地适配

源项目：https://github.com/earendil-works/pi-claude-code

固定提交：`47f9e2bb408f8b5c351edf95f7b756bc5c8f45cf`

许可证：MIT，完整许可证见本目录 LICENSE；分发副本位于 resources/third-party/pi-claude-code-LICENSE。

采用源码内置而非运行时在线加载。保留上游注释便于比较与更新；本地业务文案使用中文。

本地改动：

- 不加载上游扩展注册和命令入口，由 ClaudeSubscriptionService 管理供应商与外部登录。
- MCP 脚本通过 electron-vite 的 ?asset 复制，安装包独立解包；Electron 子进程显式使用 ELECTRON_RUN_AS_NODE。
- 用户附件在合并工具结果帧之前转换，保留工具调用与结果的顺序。
- 调用携带 Pi Runner 会话的实际工作目录。
- 系统代理通过注入 Electron fetch 接入本地 relay；禁 Cookie、禁重定向，限制请求体。
- 严格拒绝 API Key 与额外付费放行；订阅类型校验与计费错误锁定由主进程补充。
- 暴露安全的版本检查及状态信息；错误文案脱敏，不向渲染进程返回认证头。
- 关闭全部进程时清空就绪状态缓存；退出应用前等待清理。
- 将 findLast 改为 reverse().find()，兼容项目 ES2022 目标。

更新上游时需重新检查 CLI 协议、工具隔离、计费保护、SDK 兼容性与 Electron 打包；不要仅替换文件后假设上述边界仍然成立。
