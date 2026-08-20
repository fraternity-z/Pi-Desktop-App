# Pi Desktop App 开发规范

本文是仓库级架构与实现约束。需求细节以当前任务为准；若实现与
`docs/pi-tauri-desktop-architecture-plan.md` 冲突，先更新方案或新增 ADR，再修改代码。

## 1. 核心原则

- 保持 `Renderer -> Rust Core -> Pi Bridge -> 官方 Pi SDK` 的单向依赖。
- 默认复用用户安装的 Node.js、官方 Pi 包和 `~/.pi/agent`。
- Rust Core 是桌面控制平面和安全边界，Pi Bridge 是领域运行时。
- 不在 Renderer、Rust 或 WASM 中重新实现 Pi Agent Runtime。
- 不默认打包、安装或静默升级 Node.js 与官方 Pi 包。
- 修改应小步、可测试、可回退，不触碰无关模块。

## 2. 目录与分层

### `apps/desktop`：Renderer 表现层

负责 React 页面、组件、状态和用户交互。

- `src/views/`：页面级组合，只编排组件和状态。
- `src/components/`：可复用展示与交互组件，不直接调用 Tauri。
- `src/stores/`：前端状态与派生状态，不访问文件系统或进程。
- `src/ipc/`：Renderer 调用 Rust 的唯一入口，维护类型化命令和事件契约。

Renderer 禁止：

- 直接加载 Node/Pi SDK。
- 直接执行 shell、启动进程或读取任意文件。
- 读取、记录或持久化 Token、API Key、Authorization Header。
- 在 `components`、`views` 或 `stores` 中直接调用 `invoke`/`listen`。

### `src-tauri`：Rust Core 应用层与基础设施层

负责 Tauri command/event、输入校验、运行时发现、Bridge 生命周期、配置、存储、日志和更新。

- `src/commands/`：薄 command 层；校验输入、调用内部服务、映射稳定响应/错误。
- `src/discovery/`：Node、Pi 命令与 SDK 路径发现；不扫描未经用户选择的项目目录。
- `src/bridge/`：Bridge 协议、进程监管、超时、取消、序号和重启策略。
- `src/storage/`：应用配置、迁移与索引；Pi 原生会话仍以 `~/.pi/agent` 为事实来源。
- `src/error.rs`：跨 command 暴露的稳定错误码和可定位消息。

Rust 禁止：

- 接受前端传入的任意命令、可执行文件或未校验参数并透传给 shell。
- 拼接 shell 字符串；启动进程必须使用固定程序与逐项参数。
- 在命令行、日志或响应中暴露密钥。
- 重写 Pi 的 Session、模型调用、工具执行或扩展运行时。

### `agent-bridge`：Node 领域适配层

负责动态加载用户安装的官方 Pi SDK，将桌面协议转换为 Pi SDK 调用，并把 Pi 事件转换为 JSONL。

- `src/index.ts`：stdio 入口和进程生命周期。
- `src/cli.ts`：固定启动参数、协议版本和绝对路径校验。
- `src/protocol.ts`：协议类型、解析、帧大小和错误码。
- `src/sdk-loader.ts`：官方 Pi 包身份、布局和动态入口校验。
- `src/server.ts`：请求路由、响应、事件序号和并发取消。
- `src/session-runtime.ts`：Session 创建、恢复、prompt、abort 的适配边界。
- `src/extension-adapter.ts`：扩展能力与桌面 UI 请求适配边界。

Bridge 约束：

- `stdout` 只能输出一行一个 JSON 协议帧，日志只写 `stderr`。
- SDK 必须通过绝对 `sdkRoot` 动态加载，不依赖隐式 `NODE_PATH`。
- 不修改用户安装目录中的 npm 包。
- 不捕获并吞掉不可恢复错误；返回稳定错误码后允许 supervisor 决定重启。

## 3. 跨层协议

- Renderer 与 Rust 使用 Tauri `invoke`/event；所有调用集中在 `apps/desktop/src/ipc/`。
- Rust 与 Bridge 使用长期运行的 stdin/stdout JSONL，协议版本当前为 `1`。
- 请求必须包含 `v`、`id`、`op`；事件必须包含单调递增的 `seq`。
- 必须支持并测试 `ping`、`health`、`session.create`、`prompt`、`abort` 和 `shutdown`。
- 所有外部输入都要校验版本、类型、长度和允许值；默认最大帧为 1 MiB。
- 协议新增或破坏性修改必须同步更新 TypeScript/Rust 类型、测试和兼容说明。
- 大文件和图片传受限绝对路径或资源句柄，不传无限制 Base64。

## 4. 依赖规则

- 前端组件只能依赖 `stores`、`ipc` 的公开接口和纯前端工具。
- `ipc` 不依赖具体页面或组件。
- Rust `commands` 可以依赖内部 bridge/discovery/storage 服务，反向依赖禁止。
- Bridge 协议层不得依赖具体 Pi SDK；SDK 调用只能进入 session/extension 适配层。
- 公共类型放在所属边界内，禁止建立跨语言源码导入或复制无校验的松散对象。
- 新抽象必须消除真实重复或稳定边界；不为未来设想提前建设框架。

## 5. 错误、日志与安全

- 错误对外使用稳定 `code` 和可操作的 `message`，保留 correlation ID 便于定位。
- 对 Node/Pi 缺失、版本不兼容、Bridge 超时/崩溃提供明确降级与安装建议。
- Rust 使用结构化日志；Bridge 日志写 `stderr`；Renderer 不记录完整 prompt。
- 路径在使用前必须绝对化、规范化、检查存在性，并验证工作区授权。
- Markdown/HTML 渲染必须消毒；外链只能由用户主动触发。
- Tauri capability 只开放页面所需的最小权限，禁止无限制 shell 参数。
- 诊断信息可包含版本和非敏感路径，不得包含 Token、密钥或请求头。

## 6. 配置与数据

- App 配置包含 `schemaVersion`，变更 schema 必须提供迁移。
- `~/.pi/agent` 保存 Pi 原生会话、登录、扩展和设置，不由应用私自迁移。
- Tauri `app_config_dir` 保存应用配置、迁移和日志。
- Tauri `app_data_dir` 保存 SQLite 索引、缓存和未来可选 runtime。
- Token/API Key 使用系统密钥链，不写 JSON、SQLite、日志或前端存储。

## 7. 测试与质量门禁

- 公开函数、协议边界、错误路径和版本不兼容必须有测试。
- 外部进程、Pi SDK、文件系统和网络依赖使用 Mock 或 fixture。
- 相关模块覆盖率目标不低于 80%；不能达到时在变更说明中写明原因和风险。
- 修改 TypeScript 后运行 `pnpm test` 与 `pnpm check`。
- 修改 Rust 后运行 `cargo test --manifest-path src-tauri/Cargo.toml` 和
  `cargo check --manifest-path src-tauri/Cargo.toml`。
- 完成前运行 `pnpm build`，检查 `git diff`，并搜索敏感信息与旧名称残留。

## 8. 变更检查清单

1. 开始前检查 `git status`，已有修改视为其他任务成果。
2. 实现前至少查找 3 个仓库内类似实现；空仓库或不足 3 个时明确记录限制。
3. 亲自读取准备修改的文件，不只依赖索引或摘要。
4. 只修改当前任务需要的模块，并同步更新边界测试。
5. 不使用 `git add .`；提交时只暂存当前任务文件并检查 staged diff。
6. 不提交密钥、Token、用户目录数据、构建产物或本地日志。
