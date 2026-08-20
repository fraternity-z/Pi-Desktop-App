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
`hello`、`ping`、`health`、`shutdown` 协议。官方 Pi SDK 的 Session 接入将在后续迭代完成。

