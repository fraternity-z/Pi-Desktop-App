# 个性化与配置

## 官方链路

- 用户级系统提示词：`~/.pi/agent/SYSTEM.md`，替换 Pi 默认系统提示词。
- 用户级追加提示词：`~/.pi/agent/APPEND_SYSTEM.md`，由 Pi 追加到系统提示词。
- Rust 只提供两个固定文件的 UTF-8 读取与保存；Renderer 不访问任意路径，不持久化提示词副本。
- Bridge 原有 `createResourceLoader` 使用官方 `DefaultResourceLoader({ cwd, agentDir })` 并调用 `reload()`。新建会话会读取保存后的文件，无需修改 JSONL 协议。
- 优先级与项目信任规则由所安装的 Pi 版本决定；项目级同名文件可能覆盖用户级文件。桌面端不复制或重新实现合并逻辑。
- 保存不会主动中断或重新加载现有会话。现有会话可在重启应用后重新打开以读取新文件。移除按钮删除对应的用户级文件；空文本与不存在的文件明确区分。
- 保存校验 256 KiB 上限、UTF-8、空字符、普通文件和乐观并发冲突；写入同目录临时文件并重命名，避免写入失败破坏旧文件。并发冲突检测针对读取到的内容，不承诺跨外部编辑器的事务隔离。
- 工具启停复用 `useToolPermissions -> promptAgent(activeTools) -> Rust -> Bridge -> session.setActiveToolsByName`。选择在本机保存，与聊天框同步，在下次发送时生效；此设置不是文件或网络的安全隔离边界。
- 操作审批、文件沙箱、网络访问及网页搜索无统一的 Pi 内置配置链路，本次只标记状态。官方扩展 API 能实现权限拦截，但本次不新增自定义权限运行时。

## 核验来源

以项目支持范围内的 Pi v0.85.0 官方源码与文档为依据：

- [系统提示词文件](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/README.md#system-prompt)
- [官方资源加载器](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/core/resource-loader.ts)
- [SDK 工具启停](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/core/agent-session.ts)

本次不新增应用配置 schema，不修改用户的 npm 包或 Pi SDK，不引入密钥字段。

## 验证

- `pnpm test`：Renderer 400 项、Bridge 141 项、Rust 145 项通过；Bridge 原有 1 项跳过。
- `pnpm check`、`pnpm build` 通过；Vite 仍有主包超过 500 kB 的提示。
- 两个新设置组件的行、分支覆盖率均为 100%；`usePromptDocument` 行覆盖率 100%、分支覆盖率 91.89%。Rust 使用临时目录 fixture 测试，未测量 Rust 行覆盖率。
- Playwright 使用模拟 IPC 验证保存、工具切换、1280px 桌面、390px 窄屏与深色页面；未写入真实用户配置文件。实际文件读写由 Rust fixture 测试验证。
