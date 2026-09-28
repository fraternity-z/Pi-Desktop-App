# 子代理状态与会话侧栏

## 设计边界

- 参考 `PI-Desktop` 的可折叠任务组、子代理卡片和只读右侧会话标签。
- 子代理由 Bridge 的内置 `subagent` 工具调用官方 Pi SDK 执行，无需 CLI 或第三方子代理插件；不重写代理运行时。执行与隔离约束见 [ADR-005](./builtin-subagents.md)。
- 以官方 Pi `examples/extensions/subagent` 的 `agent/task`、`tasks`、`chain` 参数及 `details.results` 为依据。
- `tool_execution_update` 投影为 `tool.updated`，与开始、结束事件一样经 Rust 和 Renderer 白名单校验。
- 可选 `subagents` 元数据附于工具事件与历史工具消息，缺失时保留原普通工具展示，协议版本保持 `1`。

## 展示契约

`SubagentSnapshot` 包含：

- `id`：工具调用 ID 与任务序号组成的稳定标识，重名代理互不覆盖。
- `agent`、`task`、可选 `model`：代理名称、委派任务、实际模型。
- `status`：`pending | running | completed | failed | cancelled`。
- `messages`：用于父工具结果与实时事件的有界预览，包含用户、助手、思考、工具或系统消息；工具条目可包含 `toolCallId`、`toolName`、`toolInput`、`toolOutput`、`isError`。
- 可选 `turns`：SDK 提供的轮次数，不冒充工具调用数。
- `truncated`：仅标识预览是否被限制，不代表完整归档缺失。
- 可选 `transcriptAvailable`、`transcriptRevision`：完整独立记录的可用性和版本。存在完整记录时，侧栏只从分页接口读取正文，不以预览替代。

Bridge 在传输前脱敏；仅预览有条数、文本和总载荷预算，完整记录不设正文总量上限。不透传原始 SDK 对象、任意路径、图片 Base64 或凭据字段。
实时快照与恢复历史使用相同投影。内置执行器提供明确的单任务状态；兼容旧扩展时，运行中的 `exitCode: 0` 并不证明任务结束，必须结合工具生命周期判断。

完整记录沿 `Renderer IPC -> Rust -> Bridge` 读取：Tauri `agent_subagent_transcript` 对应 Bridge `subagent.transcript`，请求为 `{ sessionId, subagentId, cursor? }`，响应为 `{ revision, text, nextCursor }`。`text` 是完整消息数组 JSON 的连续片段，单片经 JSON 编码后最多 64000 UTF-8 字节，不拆开 Unicode 代理对；`nextCursor: null` 表示结束。游标绑定子代理和版本，Rust 校验连续偏移，客户端拼接全部片段后解析。前端不得提供存储路径。

读取期间版本变化返回 `SUBAGENT_TRANSCRIPT_CHANGED`，客户端重新开始读取（每次最多三次尝试），避免混合版本；错误可重试。不存在记录、非法游标、功能不可用或保存失败分别提供 `SUBAGENT_TRANSCRIPT_NOT_FOUND`、`SUBAGENT_TRANSCRIPT_CURSOR_INVALID`、`SUBAGENT_TRANSCRIPT_UNAVAILABLE`、`SUBAGENT_TRANSCRIPT_SAVE_FAILED`。

## 交互

- 主时间线展示可展开/折叠的任务组、完成计数和各子代理状态。
- 点击代理卡片打开当前会话专属右侧标签，再次点击激活已有标签。
- 侧栏复用现有安全 Markdown 与工具记录展示；版本更新和进入终态时重新读取，执行中每次读取结束后间隔 500ms 刷新，显示加载/错误/重试状态。刷新期间保留上次成功记录，切换主会话或标签时取消旧请求并忽略迟到结果。底部提示由主代理驱动，只读。
- 关闭、切换标签以及切换主会话不混淆子代理内容；停止或断连时不留下永久运行状态。

## 兼容说明

内置执行器通过官方 SDK 的消息与工具事件更新真实委派任务、助手回复、思考和工具记录；快照以 50ms 节流，并在终态立即刷新。结束时用 SDK 最终消息补齐事件流，同时保留上下文压缩前已捕获的消息。主模型只接收结果摘要；完整记录以官方 SessionManager custom entries 分片持久化，独立 commit 与校验值确保只恢复完整保存的版本。未完成或损坏的写入不覆盖有效记录。
旧第三方扩展仍需提供可识别的结构化结果；紧凑结果可展示原始任务与已返回的最终/最近输出，并明确提示记录不完整。旧消息或仅返回文本的自定义扩展继续显示普通工具结果。旧扩展的更新粒度取决于其自身实现。

仅预览的传输上限为每次工具调用 16 个代理、每代理 100 条消息；单条内容 8192 字符、工具输入/输出 4096 字符、任务 4096 字符。整个 `subagents` JSON 元数据不超过 100000 UTF-8 字节，受原历史分页 600000 字节预算约束。这些上限不作用于完整记录或侧栏正文。图片省略，不支持递归子代理快照。每会话最多保留 16 个进行中工具的预览投影缓存，工具结束、会话停止/释放时清理。

旧版仅有被裁减预览、没有完整归档时显示“此旧版记录未保存完整内容，缺失部分无法恢复。”，不伪装成完整记录。正常完成、失败或取消后可重新打开主会话读取已保存的完整记录；保存失败及进程意外退出前未保存的内容不保证恢复。

内置并行任务各自显示完成、失败或取消状态，无需等待其他任务结束；链式失败后未执行步骤显示已取消。兼容旧扩展时，链式后续步骤开始可证明前序成功；并行任务只有 `exitCode: 0` 时仍保守显示运行中，直到父工具结束。
