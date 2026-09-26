# 模型与提供商配置

## 决策

- 设置页沿用全局主题变量，不单独实现深浅色主题。
- Renderer → Rust Core → Bridge → 官方 Pi `ModelRuntime`；不得复制供应商 OAuth 实现。
- 提供商、OAuth 能力和模型从当前安装的 SDK 获取，不维护静态供应商白名单。
- 新会话默认模型通过官方 `SettingsManager` 保存；不修改正在运行的会话。
- 自定义模型保存到 Pi 原生 `models.json`，保留其他提供商及未知字段，并使用版本检查与原子替换避免静默覆盖。

## 凭据边界

本功能复用已存在的 `ModelRuntime.create({ authPath, modelsPath })`。账户登录、
凭据刷新和退出均由官方 SDK 管理。Pi 原生 `~/.pi/agent/auth.json` 是官方登录
状态的事实来源，不复制到应用 JSON、SQLite、前端状态或日志。这里明确区分
**官方 Pi 自己管理的原生凭据**与架构方案中必须使用系统密钥链的**应用自有凭据**；
本功能不引入应用自有凭据存储，也不迁移已有 Pi 登录。

前端只接收非敏感状态、官方授权页面、设备码和临时交互提示；不接收 SDK 返回的
Credential、访问令牌、刷新令牌或 API Key。OAuth 输入仅用于当前交互且立即清除，
SDK 要求 secret 输入时安全终止并提示使用 Pi 官方 CLI。API 配置仅接受环境变量
名称，不提供明文密钥输入框；可复用已在 Pi CLI 配置的认证。
保存时使用当前官方 SDK 的 `${VARIABLE_NAME}` 显式引用语法，而非把变量名
作为字面密钥。保存前检查 Bridge 环境已包含该变量，值不进入配置文件或响应。

## 协议兼容

协议版本保持 1，新增 `provider-settings` 能力及 `provider.list`、
`provider.login.start/status/reply/cancel`、`provider.logout`、`provider.model.save`、
`model.default.set`。登录启动立即返回；轮询状态不占用长时间 Bridge 请求，
取消传递到官方 AbortSignal。每次登录有独立 ID、提示 ID 和十分钟超时，
旧提示不能提交至新登录。Bridge 关闭时取消未完成登录。

模型选择失败、SDK 不支持、配置损坏、文件版本冲突、取消与登录失败均使用稳定
错误码，不把第三方异常、凭据或文件内容原样传回前端。
