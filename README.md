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
协议。Bridge 会从绝对 `sdkRoot` 动态加载用户安装的官方 Pi SDK，并将文本增量事件转换为 JSONL。
