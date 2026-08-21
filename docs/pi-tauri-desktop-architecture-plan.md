# 基于 Tauri 的 Pi Desktop App 技术方案

**文档状态**：方案草案  
**日期**：2026-08-18  
**产品定位**：用桌面 GUI 替代官方 Pi TUI，同时复用用户已经安装的官方 Pi 包、Node.js 环境和 Pi 用户目录。

## 1. 执行摘要

本项目不应被设计成重新分发 Pi 运行时的便携版 Agent。产品的主要职责是提供桌面 UI、会话管理、扩展 UI 适配和桌面级配置；Pi SDK、模型调用、工具执行和用户扩展仍由用户安装的官方 Pi 包负责。

推荐架构：

    Tauri WebView / React
            |
            | invoke / event
            v
    Rust Core
      - Node/Pi 环境发现
      - Bridge 生命周期
      - IPC 校验
      - 配置、日志、更新
            |
            | JSONL over stdin/stdout
            v
    用户 Node.js + 应用内置 pi-bridge.mjs
            |
            | dynamic import
            v
    用户安装的官方 Pi SDK
            |
            v
    ~/.pi/agent

核心决策：

1. Pi npm 包只作为 Bridge 的运行时依赖，不作为 Tauri Renderer 依赖。
2. 默认使用用户已安装的 Node.js 和官方 Pi 包。
3. 应用内置一个很薄的 pi-bridge.mjs，不默认打包完整 Node/Pi runtime。
4. Rust 是桌面应用的控制平面和安全边界；Pi Bridge 是领域运行时。
5. 默认复用 ~/.pi/agent，保持与官方 CLI 的会话、配置、模型登录和扩展兼容。
6. 通过版本兼容矩阵处理 Pi 独立升级，而不是在应用启动时自动安装或升级 npm 包。
7. 未来可增加受管 runtime 模式，作为无 Node/Pi 环境用户、便携版或企业部署的可选 fallback。

## 2. 背景、目标和非目标

### 2.1 产品定位

典型用户已经：

- 安装 Node.js。
- 安装官方 Pi CLI/npm 包。
- 拥有可用的 ~/.pi/agent。
- 可能已经安装 Pi 扩展。

标准安装包应尽量小，不应重复分发用户已经安装的 Pi 包。

### 2.2 目标

- 提供桌面化的会话、消息、工具和扩展 UI。
- 保留官方 Pi 的会话和配置兼容性。
- 支持用户通过 npm/pnpm 等官方方式更新 Pi。
- 让 Pi SDK 更新与桌面 App 更新相互解耦。
- 为未来的多会话、后台任务和扩展适配保留进程边界。

### 2.3 非目标

首个版本不承担：

- 重写 Pi Agent Runtime。
- 在 Rust/WASM 中实现 Pi 核心。
- 默认打包完整 Node.js、Python 和 Pi runtime。
- 通过解析 ANSI 终端输出实现完整桌面 UI。
- 在后台静默执行 npm install -g ...@latest。

## 3. 参考项目分析

本方案参考以下代码快照：

- [Pix（commit 1e329114）](https://github.com/num-scope/pix/tree/1e3291141c07a81cdc3f9bcb5d07c9025af4b7b2)
- [pi-app（commit c5ad2f4）](https://github.com/justhil/pi-app/tree/c5ad2f4dccb4225e786c05d5f67b375ab40c4f8f)

两者都是 Electron 应用，本文借鉴进程边界、IPC 和运行时管理思想，不直接复制 Electron API。

### 3.1 Pix

Pix 的核心架构是：

    React Renderer
      -> Preload
      -> Electron Main
      -> utilityProcess Agent Host
      -> Pi SDK

参考：[Pix Architecture](https://github.com/num-scope/pix/blob/1e3291141c07a81cdc3f9bcb5d07c9025af4b7b2/README.md#architecture)

值得借鉴：

- Renderer 不直接访问 Node、文件系统或 Pi SDK。
- Main 负责窗口、IPC、运行时准备和 Host 监管。
- Agent Host 单独运行 Pi SDK，崩溃时不直接拖垮 UI。
- 默认复用真实用户的 ~/.pi/agent。
- 支持 builtin SDK 和 global SDK。
- 自动全局安装默认关闭。
- 使用事件序号检测丢失事件。
- 运行时和 CLI 资源提取到用户可写目录，而不是修改只读安装包。

本项目应采用 Pix 的 global SDK 思路；Pix 的 managed Node/Python runtime 作为未来 fallback，不作为标准安装路径。

### 3.2 pi-app

pi-app 的进程边界是：

    Main
      - Window / IPC / Config
      - Worker Manager / Worker Pool
      - Worker
          - Pi SDK Session

参考：

- [进程边界和 IPC](https://github.com/justhil/pi-app/blob/c5ad2f4dccb4225e786c05d5f67b375ab40c4f8f/doc/CONTEXT.md)
- [IPC Contracts](https://github.com/justhil/pi-app/blob/c5ad2f4dccb4225e786c05d5f67b375ab40c4f8f/doc/IPC-CONTRACTS.md)
- [Worker Pool](https://github.com/justhil/pi-app/blob/c5ad2f4dccb4225e786c05d5f67b375ab40c4f8f/src/main/worker-manager-pool.ts)

值得借鉴：

- Preload/前端只使用类型化白名单 IPC。
- Worker 与 Main 之间使用结构化消息，而不是把终端文本当协议。
- 支持取消、超时、空闲 Worker 回收和后台会话。
- 通过 adapter 将 TUI 的输入、选择、确认和状态映射为桌面控件。
- SDK 可以是 builtin、global 或 user generation。
- 应用配置、密钥、SQLite 索引与 Pi 会话数据分层保存。

### 3.3 共同结论

| 设计 | 本项目决策 |
|---|---|
| Pi 核心独立进程 | 采用 |
| Renderer 不接触 Node | 必须采用 |
| 结构化 IPC 和事件序号 | 采用 |
| 共享 ~/.pi/agent | 默认采用 |
| 用户可写目录中的 runtime generation | 未来采用 |
| 扩展通过 adapter 接入 UI | 采用 |
| Electron utilityProcess、asar、electron-store | 只借鉴思想 |
| 启动时自动 npm install -g | 不采用 |

## 4. 总体架构和职责划分

    React Renderer
        ↕ Tauri invoke / event
    Rust Core
        ├── 环境发现、Bridge supervisor、IPC、存储、更新
        ↕ JSONL over stdin/stdout
    pi-bridge.mjs
        ↕ dynamic import
    用户安装的官方 Pi SDK
        ↕
    ~/.pi/agent

### 4.1 Renderer

负责消息时间线、流式渲染、会话列表、输入队列、工具状态和扩展 UI。

不负责加载 npm 包、执行 shell、读取 Token、读取任意文件或拼接系统命令。

### 4.2 Rust Core

负责 Tauri command/event、Node/Pi 环境发现、Bridge 生命周期、IPC 校验、路径和工作区权限、配置、SQLite 索引、密钥链、日志以及 App 更新。

Rust 只把用户操作转换为固定的高层 Pi 命令，不透传任意 shell 命令。

### 4.3 Pi Bridge

负责使用用户 Node.js、加载官方 Pi SDK、创建和恢复 Session、模型调用、工具执行、扩展加载，以及把 Pi 事件转换为桌面协议。

Rust 不应重新实现 Pi Agent Runtime。

## 5. 官方 Pi 包发现和启动

### 5.1 发现优先级

1. 用户显式配置的 nodePath 和 sdkPath。
2. 用户显式配置的 piCommand。
3. PATH 中的 pi/pi.cmd。
4. 由 pi 可执行文件推导出的 Node 和包路径。
5. npm、pnpm、Volta、fnm 等包管理器的全局目录。
6. 用户选择的项目级安装。
7. 可选的受管 runtime fallback。

不要无条件扫描任意项目的 node_modules。项目级 SDK 必须由用户明确选择。

### 5.2 启动参数

    node <app-resource>/pi-bridge.mjs
      --sdk-root <absolute-sdk-root>
      --agent-dir <absolute-agent-dir>
      --protocol v1
      --stdio

不要依赖当前工作目录或隐式 NODE_PATH。对 ESM 和 package exports，优先传递绝对 sdkRoot。

### 5.3 启动握手

    {
      "type": "hello",
      "protocolVersion": 1,
      "piVersion": "0.83.0",
      "nodeVersion": "22.19.0",
      "capabilities": ["sessions", "streaming", "abort", "extensions"]
    }

Rust 在握手阶段检查协议版本、Node 主版本、Pi SDK 版本、必需 SDK 导出和桌面扩展能力。不兼容时返回结构化错误和安装建议。

## 6. Node.js 和 Pi runtime 策略

### 6.1 默认模式：系统 Node + 官方 Pi

标准安装模式是：

    用户 Node.js
      + 用户安装的官方 Pi 包
      + 应用内置 pi-bridge.mjs

优点：

- 安装包体积小。
- 不重复分发用户已有的 Pi 包。
- 用户和官方 CLI 使用同一套扩展、配置和会话。
- Pi 更新继续由官方包管理器负责。

代价：

- 需要处理 nvm、fnm、Volta、pnpm、Windows PATH 等差异。
- App 必须维护 Pi SDK 兼容范围。
- 用户升级 Pi 后可能需要同步升级桌面 App。

### 6.2 可选模式：受管 runtime

未来可为便携版、企业部署或无 Node 环境用户提供：

    resources/managed-runtime/<version>.tar.zst
    appData/managed-runtime/<generation>/

下载或解压后校验 manifest、执行健康检查，再原子切换 current.json。受管 runtime 不应覆盖用户的官方 Pi 安装，也不应悄悄替换 ~/.pi/agent。

### 6.3 不推荐：启动时自动安装或升级

不要在启动时执行 npm install -g <official-pi-package>@latest。这会引入权限、网络、代理、供应链和不可复现问题。可以提供“检查更新”和“打开包管理器命令”，但必须由用户明确确认。

### 6.4 不建议将官方 TUI 作为桌面后端

直接解析 ANSI 输出或依赖 PTY 只适合临时原型。正式版本应使用公开 SDK 或稳定的机器协议；如果 SDK 尚未提供稳定接口，应优先协商接口，而不是长期反向解析 TUI。

## 7. 版本兼容矩阵

由于 Pi 包由用户独立更新，应用必须显式声明支持范围：

    App 0.1.x
    Pi SDK: >=0.83 <0.86
    Node.js: >=22.19
    Desktop protocol: 1

启动时检查：

- 包是否存在。
- 包版本是否在支持范围内。
- Node 主版本是否满足要求。
- 必需 SDK 导出是否存在。
- 当前扩展 UI 能力是否足够。

错误示例：

    检测到 Pi SDK 0.87.0，但当前桌面应用支持范围为 0.83.x–0.86.x。
    请升级桌面应用，或切换到兼容的 Pi SDK 版本。

CI 应针对至少两个受支持的 Pi 版本运行集成测试。

## 8. IPC 协议

### 8.1 Renderer 到 Rust

    await invoke("agent_prompt", {
      sessionId: "s1",
      text: "请分析当前项目"
    });

    await listen("agent://event", (event) => {
      updateTimeline(event.payload);
    });

Renderer 不应获得启动任意进程的权限。

### 8.2 Rust 到 Bridge

使用长期运行的 JSONL。

请求：

    {"v":1,"id":"r-001","op":"prompt","sessionId":"s1","text":"请分析当前项目"}

事件：

    {"v":1,"kind":"event","seq":101,"sessionId":"s1","name":"message.delta","data":{"delta":"正在分析"}}
    {"v":1,"kind":"event","seq":102,"sessionId":"s1","name":"tool.started","data":{"toolCallId":"tool-1","toolName":"read_file"}}

响应：

    {"v":1,"kind":"response","id":"r-001","ok":true,"data":{"finalSeq":102}}

兼容说明：M1 的 hello 必须声明 `tool-status` 能力。`prompt` 成功响应中的
`finalSeq` 表示该请求完成前 Bridge 已发出的最后事件序号；Renderer 消费到该
序号后才能结束流式状态。工具事件只传 `toolCallId`、`toolName` 和事件名表达的
状态，不传工具参数或执行结果。

协议必须定义：

- protocolVersion。
- 请求 ID 和事件序号。
- cancel、shutdown、health、ping。
- 超时和最大帧大小。
- Bridge 崩溃后的重启策略。
- stdout 只输出协议，stderr 只输出日志。
- 大文件和图片使用受限路径，不使用无限制 Base64。

## 9. 推荐目录结构

    pi-tauri/
    ├── apps/desktop/src/
    │   ├── components/
    │   ├── stores/
    │   ├── ipc/
    │   └── views/
    ├── agent-bridge/
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── protocol.ts
    │   │   ├── session-runtime.ts
    │   │   └── extension-adapter.ts
    │   ├── package.json
    │   └── pnpm-lock.yaml
    └── src-tauri/
        ├── src/
        │   ├── main.rs
        │   ├── commands/
        │   ├── discovery/
        │   ├── bridge/
        │   └── storage/
        ├── capabilities/default.json
        ├── resources/pi-bridge/
        │   └── pi-bridge.mjs
        └── tauri.conf.json

未来增加受管 runtime 后，再加入 src-tauri/binaries 和 src-tauri/resources/managed-runtime。

## 10. 数据、配置、密钥和日志

建议目录：

    ~/.pi/agent/
      Pi 原生会话、模型登录、扩展和设置

    Tauri app_config_dir/
      app-config.json
      migrations/
      logs/

    Tauri app_data_dir/
      index.sqlite
      cache/
      optional-managed-runtime/

原则：

- Pi 会话文件仍是事实来源。
- SQLite 只做工作区、会话、运行记录和索引。
- App 与官方 CLI 并行时使用锁。
- 配置使用 schemaVersion 和迁移机制。
- Token/API Key 使用系统密钥链。
- 不修改用户安装目录中的 npm 包。

配置示例：

    {
      "schemaVersion": 1,
      "runtimeMode": "system",
      "nodePath": null,
      "sdkPath": null,
      "piCommand": null,
      "agentDir": "~/.pi/agent",
      "supportedSdkRange": ">=0.83 <0.86",
      "telemetry": false
    }

Rust 使用结构化 tracing，收集 Bridge 的 stderr：

- 日志滚动和大小限制。
- 每个请求带 correlation ID。
- 默认不记录完整 Prompt、Token 和 Authorization Header。
- Bridge 错误映射为稳定错误码。
- 提供用户可导出的诊断包。

## 11. 扩展兼容策略

| 扩展类型 | 处理方式 |
|---|---|
| 纯工具、模型或文件逻辑 | 直接在 Bridge 中运行 |
| 使用 TUI 输入输出 | 通过桌面 adapter 转换 |
| 依赖终端布局、ANSI 或特殊键盘事件 | MVP 标记不支持，后续逐个适配 |

桌面 UI 请求可以使用稳定协议：

    {
      "type": "ui.request",
      "requestId": "u-1",
      "kind": "select",
      "title": "选择模型",
      "options": ["model-a", "model-b"]
    }

官方 Pi 核心不应直接引入 React、Tauri 或桌面组件库。

## 12. 安全模型

用户安装的 Pi 包、npm 扩展和 Pi 工具本质上是用户授权运行的代码。Bridge 与 Rust 分进程不等于 OS 级沙箱。

必须明确：

- 扩展可以拥有与用户相同的系统权限。
- Tauri capability 只能约束前端访问 Rust API，不能限制 Pi 扩展自身权限。
- 不可信扩展若需要真正隔离，应使用操作系统级沙箱，这是后续版本工作。

具体措施：

- Renderer 不开放任意 shell。
- Rust 使用固定操作和参数校验，不拼接 shell 字符串。
- Node、SDK 和工作区路径都要规范化并检查存在性。
- 不将 Token 放入命令行参数。
- 外部链接只允许用户主动触发。
- Markdown/HTML 输出必须消毒。
- 诊断页面显示当前 Node、Pi、Bridge 和扩展版本。

## 13. Tauri 配置和启动示意

### 13.1 标准模式：系统 Node

标准模式不需要把完整 Pi runtime 放进 externalBin。Bridge 可作为应用资源，由 Rust 使用检测到的 Node 启动。

示意配置：

    {
      "bundle": {
        "active": true,
        "resources": [
          "resources/pi-bridge/**"
        ]
      },
      "plugins": {
        "updater": {
          "pubkey": "YOUR_PUBLIC_KEY",
          "endpoints": [
            "https://updates.example.com/{{target}}-{{arch}}/{{current_version}}"
          ]
        }
      }
    }

Rust 伪代码：

    let node_path = discover_node(&settings)?;
    let bridge_path = resolve_resource("pi-bridge.mjs")?;
    let sdk_root = discover_pi_sdk(&settings)?;

    let child = std::process::Command::new(node_path)
        .arg(bridge_path)
        .arg("--sdk-root")
        .arg(sdk_root)
        .arg("--agent-dir")
        .arg(agent_dir)
        .arg("--stdio")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

如果使用 Tauri shell plugin，应在 capability 中只允许固定的 Bridge 命令和参数，不能使用无限制的 args: true。

参考：

- [Tauri sidecar](https://tauri.app/develop/sidecar/)
- [Tauri Node.js sidecar](https://tauri.app/learn/sidecar-nodejs/)
- [Tauri capabilities](https://tauri.app/security/capabilities/)

### 13.2 可选模式：受管 runtime

受管模式可以使用 Tauri externalBin，但每个平台必须提供带目标 triple 的文件，例如：

    pi-agent-host-x86_64-pc-windows-msvc.exe
    pi-agent-host-aarch64-apple-darwin
    pi-agent-host-x86_64-unknown-linux-gnu

使用 rustc --print host-tuple 确认目标名称。原生 npm 模块也必须按每个平台构建和测试。

## 14. 发布和更新

### 14.1 App 更新

使用 Tauri updater 更新前端、Rust、Bridge 和 App 自身资源。更新包必须签名，发布清单至少包含版本、下载 URL 和签名；私钥只保存在 CI。

参考：[Tauri Updater](https://tauri.app/plugin/updater/)。

### 14.2 Pi 更新

Pi 版本由用户的 npm/pnpm/其他官方包管理器管理。App 可以显示当前版本、支持范围和升级建议。更新按钮必须在用户明确确认后执行或打开包管理器命令。

### 14.3 受管 runtime 更新

下载后写入新 generation，校验签名和 SHA-256，执行健康检查，再原子切换 current.json；保留上一代以便回滚。

## 15. 集成方案对比

| 维度 | 系统官方包（默认） | 内置完整 runtime | 按需下载 runtime |
|---|---|---|---|
| 安装包体积 | 最小 | 较大 | 初始最小 |
| 启动速度 | 启动 Node 并加载 SDK | 无需查找环境，但可能解压 | 首次最慢 |
| 跨平台 | 依赖用户环境，发现逻辑复杂 | 构建矩阵复杂，但行为一致 | 下载平台专属产物 |
| Node 依赖 | 用户提供 | 应用提供 | 下载后提供 |
| Pi 版本管理 | 与用户包管理器解耦 | 跟随 App 或独立 generation | 最灵活 |
| 安全 | 执行用户安装的代码 | 依赖签名和供应链控制 | 需要下载、哈希、签名和回滚 |
| 离线能力 | 已安装时可用 | 最好 | 首次离线不可用 |
| 维护成本 | 重点是兼容性 | 重点是打包和更新 | 还需 CDN 和更新服务 |
| 适用场景 | 标准用户版 | 便携版、企业版 | 可选增强能力 |

## 16. MVP 路线

### M0：协议验证

- 编写 pi-bridge.mjs。
- 支持 hello、session、prompt、stream、abort、shutdown。
- 使用系统 Node。
- 先用命令行模拟 Rust 调用。

验收：能连接用户安装的官方 Pi SDK，能创建会话、流式输出和取消；不兼容时返回结构化错误。

### M1：桌面 MVP

- Tauri + React。
- Rust 环境发现和 Bridge supervisor。
- 单窗口、单活动会话。
- 消息流式显示和基础工具状态。
- 复用 ~/.pi/agent。
- 基础配置、日志和 Tauri 签名更新。

暂不实现自动安装 Pi、自动升级 Pi、Python runtime、多 Worker Pool 和全部 TUI 扩展 UI。

### M2：可用性增强

- npm/pnpm/Volta/fnm 环境发现。
- SDK 路径选择和版本兼容矩阵。
- 工作区信任、文件锁和 SQLite 索引。
- 扩展 adapter API。
- 多会话 Worker Pool。

### M3：正式发行

- 可选受管 Node/Pi fallback。
- 独立 runtime manifest 和 generation 回滚。
- 稳定版/Beta 更新渠道。
- 代码签名、Windows SmartScreen、macOS notarization 和 Linux 包测试。
- 针对多个 Pi SDK 版本的集成测试。

## 17. 风险和应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 官方 SDK API 变化 | App 启动或会话失败 | 版本矩阵、握手检查、CI 多版本测试 |
| 用户 Node 路径复杂 | 无法启动 | 显式路径配置、从 pi 命令推导、诊断页面 |
| TUI 扩展依赖终端 UI | 扩展功能缺失 | adapter、能力协商、明确降级 |
| CLI 与 App 同时访问会话 | 数据损坏或状态错乱 | 文件锁、会话级并发策略 |
| 用户扩展执行任意代码 | 安全风险 | 明确信任模型，未来增加 OS 沙箱 |
| 全局路径不一致 | SDK 发现失败 | 支持多包管理器，允许选择 SDK 路径 |
| 原生 npm 模块 ABI 不匹配 | Bridge 启动失败 | 使用兼容 Node，提前健康检查 |
| 无官方包时无法离线安装 | 新用户无法使用 | 安装向导，未来增加受管 fallback |

## 18. 关键架构决策

### ADR-001：默认使用系统官方 Pi 包

**决定**：标准模式使用用户已安装的官方 Pi 包和 Node.js。  
**原因**：产品定位是 TUI 替代品；用户环境和 CLI 已经存在，重复打包会增加体积和更新复杂度。  
**代价**：需要运行时发现和版本兼容矩阵。

### ADR-002：使用 Node Bridge，不在 Renderer 加载 Pi SDK

**决定**：Pi SDK 只在 Node Bridge 中加载。  
**原因**：Tauri WebView 没有 Node，且需要隔离文件、进程和扩展权限。  
**代价**：增加一个进程和 JSONL 协议。

### ADR-003：默认不自动安装或升级 Pi

**决定**：Pi 包由用户的官方包管理器管理。  
**原因**：避免权限、供应链、代理和版本不可控问题。  
**代价**：App 必须友好地诊断和提示安装/升级命令。

### ADR-004：保留受管 runtime 作为可选模式

**决定**：未来支持不依赖系统 Node 的 fallback，但不作为标准模式。  
**原因**：兼顾便携版、企业部署和离线场景，同时不增加普通用户的默认包体积。

## 19. 参考资料

- [Pix README / Architecture](https://github.com/num-scope/pix/blob/1e3291141c07a81cdc3f9bcb5d07c9025af4b7b2/README.md#architecture)
- [Pix managed runtimes](https://github.com/num-scope/pix/blob/1e3291141c07a81cdc3f9bcb5d07c9025af4b7b2/apps/desktop/runtimes/README.md)
- [Pix SDK resolution](https://github.com/num-scope/pix/blob/1e3291141c07a81cdc3f9bcb5d07c9025af4b7b2/apps/desktop/src/main/pi-sdk.ts)
- [pi-app process context](https://github.com/justhil/pi-app/blob/c5ad2f4dccb4225e786c05d5f67b375ab40c4f8f/doc/CONTEXT.md)
- [pi-app IPC contracts](https://github.com/justhil/pi-app/blob/c5ad2f4dccb4225e786c05d5f67b375ab40c4f8f/doc/IPC-CONTRACTS.md)
- [pi-app SDK manager](https://github.com/justhil/pi-app/blob/c5ad2f4dccb4225e786c05d5f67b375ab40c4f8f/src/main/sdk-manager.ts)
- [Tauri sidecar](https://tauri.app/develop/sidecar/)
- [Tauri Node.js sidecar](https://tauri.app/learn/sidecar-nodejs/)
- [Tauri capabilities](https://tauri.app/security/capabilities/)
- [Tauri updater](https://tauri.app/plugin/updater/)
