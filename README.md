# Pi Desktop App

Pi Desktop App 是一个基于 Tauri 2 和 React 的 Pi 桌面客户端。它为官方 Pi
Agent Runtime 提供原生桌面界面，同时复用用户本机已经安装的 Node.js、官方 Pi SDK
以及 `~/.pi/agent` 数据目录。

当前版本：`0.2.0`

> 项目仍处于早期开发阶段，当前发布和冒烟验证以 Windows x64 为主。请在重要项目中使用前自行备份。

## 核心功能

- **桌面会话工作台**：创建、恢复和管理 Pi 会话，支持流式消息、思考过程、工具状态、提示词队列与中止操作。
- **项目与会话管理**：支持项目分组、搜索、置顶、排序、重命名、归档，以及 Git worktree 创建和打开。
- **工作区工具**：提供文件搜索、文件预览、Git 状态、差异审阅、暂存、提交和分支操作。
- **Pi 生态管理**：查看、安装、启用、更新和移除插件，并浏览扩展、技能、提示词与上下文资源。
- **模型与权限控制**：选择模型、思考强度和活动工具，管理工具权限与请求头客户端标识。
- **原生桌面能力**：集成系统通知、文件选择、文件管理器、内置浏览侧栏和原生安装包。
- **完整外观设置**：支持浅色、深色和跟随系统主题，自定义全局背景图片，预览、应用、替换、导入和导出主题，并持久化缩放、字体、侧边栏透明度与宽度。

自定义背景图片支持 PNG、JPEG 和 WebP，单个文件最大 24 MiB。应用会校验绝对路径、扩展名、文件大小和真实文件头，再将图片复制到应用数据目录。

## 运行时要求

| 组件 | 要求 |
| --- | --- |
| Pi Desktop App | `0.2.0` |
| Node.js | `22.19` 或更高版本 |
| 官方 Pi SDK | `>=0.83 <0.86` |
| 桌面协议 | `1` |
| pnpm | `10.x`，仓库当前锁定为 `10.32.1` |
| Rust | stable 工具链 |
| Tauri | Tauri 2 对应平台的系统构建依赖 |

Pi Desktop App 不会静默安装或升级 Node.js 和 Pi。请先按官方方式安装 Pi，并确保
Node.js 与 Pi 命令能够从当前用户环境中被发现。

## 快速开始

克隆仓库后，在项目根目录执行：

```powershell
pnpm install
pnpm dev
```

`pnpm dev` 会启动完整的原生 Tauri 应用。首次启动时，Rust Core 会发现并验证本机
Node.js 与 Pi SDK，然后启动应用内置的 Pi Bridge。

仅调试 Renderer 样式时可以使用：

```powershell
pnpm run dev:desktop
```

该命令只启动浏览器中的前端预览，不具备完整的 Tauri IPC、文件选择、背景图片安装或
Pi 运行时能力。涉及原生功能时必须使用 `pnpm dev`。

## 构建安装包

构建前端、Bridge 和 Rust 应用：

```powershell
pnpm build
```

生成当前平台的原生安装包：

```powershell
pnpm tauri build
```

Windows x64 构建产物位于：

```text
src-tauri/target/release/pi-desktop.exe
src-tauri/target/release/bundle/msi/Pi Desktop_0.2.0_x64_en-US.msi
src-tauri/target/release/bundle/nsis/Pi Desktop_0.2.0_x64-setup.exe
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动完整的 Tauri 开发应用 |
| `pnpm run dev:desktop` | 只启动 Renderer 浏览器预览 |
| `pnpm run build:packages` | 构建 Agent Bridge 和 Renderer |
| `pnpm build` | 构建 Bridge、Renderer 和 Rust 应用 |
| `pnpm tauri build` | 生成原生可执行文件和安装包 |
| `pnpm test` | 运行 Renderer、Bridge 和 Rust 测试 |
| `pnpm check` | 运行 TypeScript 检查和 `cargo check` |

## 架构

```text
React Renderer
    │  typed Tauri invoke / event
    ▼
Rust Core
    │  versioned JSONL over stdin / stdout
    ▼
Pi Bridge
    │  absolute sdkRoot + dynamic import
    ▼
用户安装的官方 Pi SDK
    │
    ▼
~/.pi/agent
```

| 层 | 职责 |
| --- | --- |
| Renderer | React 页面、组件、交互状态和类型化 IPC；不直接访问 Node.js、Pi SDK 或任意文件系统能力 |
| Rust Core | Tauri 命令、输入校验、运行时发现、Bridge 生命周期、工作区授权、存储、通知和原生能力 |
| Pi Bridge | 加载官方 Pi SDK，适配会话、提示词、工具、插件和资源，并将事件转换为 JSONL |
| 官方 Pi SDK | 执行 Pi Agent Runtime、模型调用、工具和扩展，继续使用用户原有的 Pi 数据 |

Renderer、Rust Core 与 Pi Bridge 保持单向依赖。Rust 是桌面控制平面和安全边界，
项目不会在 Renderer、Rust 或 WASM 中重新实现 Pi Agent Runtime。

更详细的设计决策、兼容策略和协议说明见
[Tauri 桌面架构方案](docs/pi-tauri-desktop-architecture-plan.md)。

## 项目结构

```text
.
├── apps/desktop/          # React Renderer
│   └── src/
│       ├── components/    # 可复用界面组件
│       ├── ipc/           # Renderer 调用 Rust 的唯一入口
│       ├── stores/        # 前端状态与持久化偏好
│       └── views/         # 页面级组合
├── agent-bridge/          # 官方 Pi SDK 的 Node.js 适配层
├── src-tauri/             # Rust Core、Tauri 配置与安装包资源
│   └── src/
│       ├── bridge/        # JSONL 协议、supervisor 与运行时装配
│       ├── commands/      # 薄 Tauri command 层
│       ├── discovery/     # Node.js 与官方 Pi SDK 发现
│       └── storage/       # 应用配置和工作区授权
├── docs/                  # 架构与设计文档
└── design-qa.md           # 交互、视觉与自动化验收记录
```

## 数据与安全

- `~/.pi/agent` 仍由官方 Pi 管理，是会话、登录、扩展和设置的事实来源。
- 应用配置和应用数据写入 Tauri 提供的当前用户目录，不修改 Pi 或 npm 的安装目录。
- 自定义背景写入应用数据目录下的 `appearance/backgrounds`，导入主题时执行相同的图片校验。
- Renderer 只能通过白名单 IPC 请求原生操作，不能传入任意 shell 命令。
- Rust 使用固定程序和逐项参数启动进程，并校验路径、协议版本、帧大小和工作区授权。
- Bridge 的 `stdout` 只输出 JSONL 协议帧，诊断日志只写入 `stderr`。
- Token、API Key 和 Authorization Header 不应进入命令行、普通日志或前端持久化存储。

Pi 插件和扩展以当前用户权限运行。进程边界可以隔离故障，但不等同于操作系统级沙箱；
请只安装可信来源的扩展。

## 测试与质量检查

提交变更前至少运行：

```powershell
pnpm test
pnpm check
pnpm build
```

修改安装配置或原生能力后，再运行：

```powershell
pnpm tauri build
```

仓库测试覆盖 Renderer、Agent Bridge 和 Rust Core，包括协议版本、流式事件、错误路径、
工作区边界、Git 操作、运行时发现、插件资源、外观持久化与背景图片校验。

## 常见问题

### 无法发现 Node.js 或 Pi SDK

确认 `node --version` 满足最低版本，并确保 Pi 是按官方方式安装到当前用户环境中的。
修改 PATH 或 Pi 安装后，重新启动应用并在“设置 -> 运行时”中重新检测。

### 提示 Pi SDK 版本不兼容

当前应用只接受 `>=0.83 <0.86`。请升级 Pi Desktop App，或切换到兼容范围内的官方
Pi SDK 版本。应用不会自动修改用户的 Pi 安装。

### 浏览器预览中原生操作不可用

这是预期行为。`pnpm run dev:desktop` 只用于纯前端调试；使用 `pnpm dev` 启动原生
Tauri 窗口后，文件选择、背景安装、通知和 Pi Bridge 才会生效。

### 自定义背景无法导入

确认文件是有效的 PNG、JPEG 或 WebP，大小不超过 24 MiB，且扩展名与实际文件格式一致。

## 参考与致谢

本项目在产品交互、桌面架构和 Pi 扩展兼容性方面参考了以下开源项目：

- [Pix](https://github.com/num-scope/pix)：参考了桌面工作台、会话与项目组织、Renderer/Host
  进程边界以及复用用户 Pi SDK 的设计思路。
- [pi-custom-header](https://github.com/rays1d/pi-custom-header)：参考了自定义请求头、客户端标识
  和不同模型服务兼容性的实现思路。

Pi Desktop App 不是上述项目的 fork。相关功能按照本项目的 Tauri、Rust Core 和 Pi Bridge
边界独立实现；被引用项目的代码、名称与许可归各自作者和贡献者所有。
