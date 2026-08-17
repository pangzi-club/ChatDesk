# Project Memory

用户要求查询、排查或打开某个会话（session id、标题、工具调用、用量、activity log）时，到 `~/.chatdesk` 搜索，不要只在当前仓库或 Cursor transcript 里找。

优先路径：

- 会话目录：`~/.chatdesk/chat-server/sessions/<session-id>/`
- 元数据：`meta.json`
- 消息：`messages.jsonl`
- 运行诊断：`~/.chatdesk/chat-server/activity-logs.json`
- 用量：`~/.chatdesk/chat-server/ai-usage-log.jsonl`

macOS 默认数据目录是 `~/.chatdesk/chat-server`（可用 `CHAT_SERVER_DATA_DIR` 覆盖）。
