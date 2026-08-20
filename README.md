# Pi Desktop App

基于 Tauri、React 和用户本机官方 Pi SDK 的桌面客户端。

## 开发环境

- Node.js 22.19 或更高版本
- pnpm 10
- Rust stable
- Tauri 2 所需的平台依赖

## 常用命令

```powershell
pnpm install
pnpm test
pnpm check
pnpm build
pnpm dev
```

`pnpm dev` 启动 Tauri 桌面应用；只调试 Renderer 时使用
`pnpm run dev:desktop`。

当前骨架提供 Renderer 到 Rust 的诊断调用，以及 Bridge 的
`hello`、`ping`、`health`、`session.create`、`prompt`、`abort`、`shutdown`
协议。Rust 会从显式路径或 PATH 中发现并验证用户安装的官方 Pi 运行时，使用固定参数监管
Bridge 的握手、健康检查、超时和退出；Bridge 从绝对 `sdkRoot` 动态加载 SDK，并将文本增量事件转换为 JSONL。
