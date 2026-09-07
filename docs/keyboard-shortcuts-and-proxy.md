# 快捷键与网络代理

## 快捷键

设置 → 快捷键支持搜索、按键录制、单项重置、清除及全部重置；修改立即生效并保存在本机。重复绑定会被拒绝，清除后不再触发动作。Esc 取消录制，Tab 离开录制。

默认组合：命令面板 Ctrl+K，新建会话 Ctrl+N，插件 Ctrl+P，资源 Ctrl+Shift+P，设置 Ctrl+逗号，返回对话 Ctrl+1，聚焦输入 Ctrl+J，主题 Ctrl+Shift+T，运行时 Ctrl+句点，文件 Ctrl+O，浏览器 Ctrl+T。Mac 可使用 Command。

快捷键仅在主应用 WebView 内生效，不注册操作系统全局热键。内置浏览器网页获得焦点时使用网页自己的键盘行为。输入法组合输入、长按重复、模态弹窗及快捷键录制期间不会执行应用快捷键；未满足会话条件的动作不执行。命令面板支持搜索、Enter、方向键、Tab 焦点约束和 Esc。

文件动作从原先固定的 Ctrl+P 改为默认 Ctrl+O，避免与插件入口冲突。右侧面板只展示当前绑定，按键统一由工作台分发。`/hotkeys` 和 `/keybindings` 转到快捷键设置。当前版本没有会话分叉和内嵌 Pi TUI，因此不提供这两项无实际动作的绑定。

配置存放于 `pi-desktop.keyboard-shortcuts.v1` 本地存储项，包含 `schemaVersion: 1` 和 `bindings`。首次使用、旧版本缺失或数据格式错误时使用默认值；未知配置版本不加载；null 明确表示禁用。写入失败不改变当前绑定。

## 代理

Rust Core 在应用配置目录保存独立的 `proxy-settings.json`（`schemaVersion: 1`），不修改 `~/.pi/agent` 或系统代理设置。旧版本没有此文件时默认继承环境／系统设置；无效文件和未知版本返回稳定错误，不静默切换直连。损坏配置可从启动错误页进入代理设置，重新保存后重启应用。

| 范围 | 默认模式 | 自定义代理 | 生效时机 |
| --- | --- | --- | --- |
| AI／Pi Bridge | HTTP_PROXY、HTTPS_PROXY、ALL_PROXY、NO_PROXY，支持小写优先 | 无认证 HTTP / HTTPS；支持 NO_PROXY 绕过列表 | 保存 AI 变更后重启 Bridge，当前生成会被中断，工作台按现有机制恢复会话 |
| 应用更新检查 | reqwest 环境变量及 Windows/macOS 系统代理 | 无认证 HTTP | 保存后的下一次检查 |
| 内置浏览器 | WebView 系统代理（不读取 Node 环境变量） | 无认证 HTTP | 重启应用后 |

直连模式为 Bridge 子进程清除大小写代理变量，并安装直接连接的 Undici Agent；更新检查使用 `no_proxy()`；Windows 内置浏览器使用固定的 `--no-proxy-server` 参数。非 Windows 浏览器不支持强制直连时返回明确错误。代理 URL 禁止认证信息、额外路径、查询、片段、控制字符和无效端口，前后端均校验；URL 和绕过列表长度限制为 2048。

外部浏览器、桌面 Git 操作、以及自行配置网络客户端的第三方扩展仍使用各自设置。这不是网络隔离功能。应用代理不支持绕过列表、SOCKS 或代理账号密码。

## 实现边界

- Renderer 通过 `ipc/proxy.ts` 调用 Rust；组件不直接调用 Tauri。
- Rust 先验证并串行化保存，将 AI 配置放进固定 Bridge 启动环境；不修改主进程环境，不拼接 shell。
- 代理保存与重启预约处于同一事务。正在启动时拒绝 AI 变更；写入失败保留旧配置与运行时状态。应用代理单独改变时不重启 Bridge。
- Bridge 在动态加载官方 SDK 前注册 Undici 全局 dispatcher，使 Node 原生 fetch 使用代理。Undici 随 Bridge 脚本打包，不安装到用户 Pi 目录。JSONL 协议仍为版本 1，无新增运行时请求帧。
- 浏览器继续使用原有独立数据目录及远程页面权限约束；不在保存代理时销毁浏览器登录状态。

## 验证依据

- Vitest 覆盖录制、冲突、重置、存储失败、版本校验、动作联动、弹窗屏蔽、代理校验与失败保留草稿。
- 本地 HTTP / CONNECT fixture 验证 Node 原生 fetch 的代理、直连、绕过列表，以及 Rust 客户端经过代理和直接访问。测试不访问模型服务。
- Rust fixture 覆盖代理保存、重新加载、无效配置、子进程环境和启动／保存竞争。
- 浏览器检查使用模拟 IPC，验证桌面、390px 窄屏及深色界面；未修改真实用户代理配置。未对真实模型服务或 Windows 原生 WebView 代理进行端到端联网验证。
- Rust 未测量行覆盖率，网络路径以 fixture 验证；第三方 SDK 自带网络客户端不保证使用全局 dispatcher。

官方接口依据：[Undici EnvHttpProxyAgent](https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md)、[reqwest Proxy](https://docs.rs/reqwest/latest/reqwest/struct.Proxy.html)、[Tauri WebviewBuilder](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html#method.proxy_url)。

最终验证：`pnpm test`（Renderer 417、Bridge 145、Rust 150 项通过；Bridge 原有 1 项跳过）、`pnpm check`、`pnpm build` 均通过。Renderer 总行覆盖率 90.37%、分支覆盖率 81.76%；快捷键设置行覆盖率 82.35%，两个新增设置控制器行覆盖率 100%。构建保留既有的主包体积提示。
