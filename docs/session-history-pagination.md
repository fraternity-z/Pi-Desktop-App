# 会话历史分页兼容说明

协议版本仍为 1。`session.create` / `session.open` 的响应新增可选
`nextHistoryCursor`；缺失或为 `null` 表示已返回完整历史。

新增 `session.history` 请求，字段为 `v`、`id`、`op`、`sessionId`、`cursor`。
响应包含 `messages` 与 `nextHistoryCursor`。每页按时间正序，续页位于上一页之前。
Rust supervisor 收齐所有页后按时间顺序组装，再返回 Renderer；分页失败必须报错，
不能将部分历史作为完整会话返回。旧版无游标响应仍可读取，但旧 Bridge 自身截断的
历史无法由新 Rust 补回，因此发布时应同步更新内置 Bridge。

游标是运行时生成的三段非负安全整数，绑定本次打开会话的内存快照、原始消息位置
和文本块位置。分页读取只访问已打开会话的快照，不接受额外文件路径，也不修改
Pi 原生 JSONL 文件。快照在分页结束时释放；再次打开同一会话会使旧游标失效。

每页最多 200 个投影消息、400,000 个正文及工具显示字符、600,000 个序列化 UTF-8
消息字节，JSONL 单帧上限仍为 1 MiB。超出页容量的单条消息返回
`HISTORY_MESSAGE_TOO_LARGE`，而非静默丢弃。工具显示仍沿用既有脱敏与有标记截断规则。
游标失效返回 `HISTORY_CURSOR_INVALID`，用户可重新打开会话；不支持分页的运行时
返回 `HISTORY_UNAVAILABLE`。

验证覆盖多页、多文本块跨页、中文与 JSON 转义、工具参数关联、失效游标、
超大消息和 Rust 组装顺序。可通过 `PI_HISTORY_FIXTURE` 指定本地 JSONL，运行
Bridge 的“本地 JSONL 历史完整性回归”测试；测试仅报告条数，不输出会话正文。
