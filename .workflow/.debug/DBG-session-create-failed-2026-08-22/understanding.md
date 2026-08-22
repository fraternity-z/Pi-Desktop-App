# session.create 失败调试记录

## 现象

- Pi Desktop 运行时状态正常，说明 Node.js 与官方 Pi SDK 已完成发现和加载。
- 原生目录选择器能够返回存在的项目目录。
- 提交项目后，Bridge 返回 `SESSION_CREATE_FAILED: 无法创建 Pi 会话`。

## 已确认边界

- Renderer 到 Rust 的项目路径传递成功。
- Rust 已将绝对项目路径发送给 Bridge 的 `session.create`。
- 失败发生在 `PiSessionRuntime.createSession()` 捕获的 SDK 初始化路径中。
- 当前统一错误映射隐藏了实际失败阶段，需要用脱敏阶段日志进一步定位。

## 根因

`std::fs::canonicalize()` 在 Windows 上返回带 `\\?\\` 前缀的 verbatim 路径。
`canonical_workspace()` 和 `canonical_session_path()` 将该路径直接编码进 Bridge 请求，
而 Pi SDK 0.84.2 的会话创建路径不接受这种形式。已有 Bridge 启动参数路径会调用
`normalize_process_path()`，工作区和会话路径遗漏了相同处理。

## 最小复现

- 普通路径通过 SDK 和完整 Bridge 协议均成功。
- 同一路径添加 Windows verbatim 前缀后，完整 Bridge 协议稳定返回
  `SESSION_CREATE_FAILED`。

## 修复与验证

- 工作区和会话文件在完成存在性与授权范围校验后，统一转换为 Node 兼容路径。
- 新增 Windows 回归测试，保证 `canonical_workspace()` 不再返回 `\\?\\` 前缀。
- 完整测试、检查与构建均通过，新调试版桌面应用已启动。

## 安全约束

- 不读取或记录 `auth.json`、Token、API Key、请求头或提示词。
- 只记录 SDK 版本、执行阶段、异常类型和稳定错误码。
- 不修改用户安装的 Pi SDK。

## 参考实现

- `PiSessionRuntime.listModels()`：复用同一个 `ModelRuntime` 并进行稳定错误映射。
- `PiSessionRuntime.openSession()`：通过 `SessionManager.open()` 创建 SDK 会话。
- 官方 Pi CLI/SDK：`ModelRuntime.create()`、`SessionManager.create()`、`createAgentSession()` 的组合方式。
