# Chat HTTP Server 架构

本文记录 Chat HTTP Server 的架构设计决策与已实现的功能边界。Node HTTP Server 是 Session/Run 的真相源，UI 与侧栏只消费 HTTP/事件流，宿主负责进程与敏感能力。

## 1. 问题背景（迁移前）

迁移前 Chat 是单页、单 `useChat` 实例、单活跃会话架构：

- 流式 / in-progress 状态只活在 `ChatPage` 本地；
- 切换会话会主动 `stop()`，离开页面会随组件卸载中断生成；
- `ChatIndexItem` 与侧栏列表没有 `status` 字段，无法展示各会话进行中状态；
- 生成中不落盘，切走后无法恢复进行中消息。

持久化层已是 per-session（`sessions/{id}/meta.json` + `messages.jsonl`），但运行时层是单飞。仅改 UI 无法支持「多 chat 同时跑 + 侧栏看进行中」。这些限制已在迁移到 Node HTTP Server 后消除。

## 2. 讨论结论

### 2.1 目标

- 同时进行多个 chat；
- 侧栏可看到各会话的进行中状态；
- 核心对话逻辑与 UI 解耦，便于调试与迁移到其它应用。

### 2.2 架构选择

| 方案 | 结论 |
|------|------|
| 仅在 React 内做全局 runtime | 可快速验证产品，但对话引擎仍绑在桌面壳里 |
| Node sidecar（stdio IPC） | 与现有 `browser-worker` 模式接近，暴露面小，但调试与跨应用迁移成本高 |
| **Node HTTP Server** | **已选定并实现**：方便调试、实现简单、协议可迁移到其它客户端 |

选定 HTTP Server，不等于放弃「由桌面 App 拉起进程」。推荐形态是：

> Tauri（或其它壳）负责启动 / 保活 / 退出清理；对外交互使用本机 HTTP（及 SSE/WebSocket 事件流）。

### 2.3 职责划分

```text
UI（Chat 页 / 侧栏）
  → HTTP / SSE（或 WS）：发指令、订阅读状态与消息流
Tauri（或其它宿主）
  → 拉起 Node 进程、注入配置与 token、退出时优雅关闭
  →（可选）代理敏感工具执行、会话落盘路径
Node HTTP Server
  → Session / Run 真相源：多路生成、abort、status、消息流
```

原则：

- **Server 拥有 run**，不跟当前路由或 React 组件生死绑定；
- **UI 只做渲染与发指令**；
- **敏感能力（workspace FS、bash、MCP 进程、权限）不要默认对裸 HTTP 敞开**，应经宿主回调或严格 ACL。

### 2.4 本机安全约束

按「本机引擎」收紧，而不是开放公网服务：

1. 只绑定 `127.0.0.1`；
2. 随机端口或固定端口 + 端口信息写入本地文件，避免冲突；
3. 启动时生成 token 并保留客户端 `Authorization` 传递链路；Server 对除 `/health` 和 CORS 预检外的所有请求强制校验 `Bearer` token；
4. 宿主进程负责拉起、崩溃重启、退出时等待 inflight 落盘后再终止；
5. API Key 等密钥由受控配置注入，避免只活在 webview 内存里长期裸奔。

## 3. HTTP Server 已实现的功能

### 3.1 进程与配置

- 提供可独立启动的 Node 入口（不启桌面壳也能跑，便于调试）；
- 读取宿主注入的配置：监听地址、端口、token、数据目录、模型相关密钥等；
- 浏览器工具依赖 `CHAT_SERVER_BROWSER_WORKER`：开发态回退到源码 `browser-worker.mjs`，打包后由 Tauri 注入；缺失时工具调用直接报错，打包启动也会失败；
- 健康检查（如 `GET /health`）；
- 优雅关闭：停止接受新 run，尽量结束或持久化进行中状态后退出。

### 3.2 Session 管理

- 创建 / 列出 / 获取 / 更新 / 删除会话；
- 维护会话元数据：`id`、`title`、时间戳、`modelId`、`workspaceId` / `cwd`、MCP / skills 选择等；
- 维护消息列表（至少支持 UI 可渲染的消息结构）；
- 维护会话附件（文件本体 + 会话级元数据 + 消息级 file part），详见 [chat-attachments.md](chat-attachments.md)；
- 维护会话级计划：每次进入 plan mode 创建 `sessions/<id>/plan-<随机版本>.md`，计划摘要保存在 session 元数据，文件不进入 workspace/Git；
- 成为运行时的 session 真相源；与现有磁盘索引的同步策略需明确（由 server 写盘，或经宿主落盘）。

### 3.3 Run（多路并发生成）

这是相对现状最关键的能力：

- `run.start`：对指定 `sessionId` 发起生成（支持多 session 并行）；
- `run.stop`：中止指定 session 的当前生成（`AbortSignal`）；
- 每会话状态机，至少：`idle` | `submitted` | `streaming` | `error` | `ready`；
- 切会话、多客户端同时查看 **不得** 自动 abort 其它 session 的 run；
- 同一 session 内可先保持串行（生成中禁止重复 start），跨 session 必须并行。

### 3.4 流式输出与事件

通过 SSE 或 WebSocket 向外推送，供 Chat 页与侧栏共用，例如：

- `session.status`：侧栏「进行中」依赖此事件；
- `message.delta` / `message.updated`：增量或整段消息更新；
- `plan.updated`：`plan_write` 原子更新计划后推送完整 Markdown，桌面侧栏无需重新加载即可刷新；
- `tool.request` / `tool.result`：工具调用过程（若工具经宿主执行）；
- `run.progress`：步骤与阶段；携带本次运行 `startedAt`，供前端本地计时；
- `run.error` / `run.done`：失败与完成，摘要含 `durationMs`；

要求：客户端重连后能重新订阅并进行中状态；是否支持断线续流可第二期再做，但 status 与已落库消息应可恢复。

### 3.5 模型调用与提示词组装

将现有前端 transport 中的核心逻辑下沉到 server：

- OpenAI 兼容 HTTP 流式调用；
- `streamText` + tools 循环（含 Responses / chat 路径差异）；
- 供应商差异由 [model-adaptor.md](model-adaptor.md) 收口（非 OpenAI Responses 关闭 `store`）；
- system prompt 组装：memory、workspace hint、tools hint、skills hint；
- 错误归一与可观测日志。

### 3.6 工具编排边界

Server 负责「何时调工具、如何把结果写回模型」；工具的真实执行建议分阶段：

| 阶段 | 行为 |
|------|------|
| 第一期 | Server 发出 `tool.request`，由 Tauri/宿主执行现有 `invoke`（workspace、bash、MCP 等），再回传 `tool.result` |
| 后续 | 视需要将部分只读或低风险工具内置进 server，仍保留 ACL |

不建议第一期把 FS/MCP/权限模型整份搬进 Node，以免与现有 Rust 能力重复且扩大攻击面。

### 3.7 侧栏与多客户端所需查询

- 会话列表接口需带 **当前 status**（或可经事件通道得到等价信息）；
- 支持按 `sessionId` 拉取消息快照，供切换会话时渲染；
- 多个 UI 同时订阅同一 server 时行为一致（列表、status、消息流）。

### 3.8 尚未实现或后置的事项

以下内容尚未实现，避免范围膨胀：

- 公网部署、多租户鉴权；
- 完整断线续流（`reconnectToStream`）；
- 将全部工具执行完全移出宿主；
- 替换现有归档 / History 体系（可继续读现有 archive，与 live runtime 分离）。
- 计划文件的用户直接编辑（当前由模型 `plan_write` 管理，UI 只读）。

## 4. 当前代码位置

迁移已完成。关键实现位置：

- `apps/server/src/app.ts`：Hono 应用，路由注册，token 认证中间件，SSE 事件流。
- `apps/server/src/run-registry.ts`：Run 真相源——多路生成、abort、status 状态机、toolApproval、上下文压缩、崩溃恢复。
- `apps/server/src/store.ts`：Session Store，per-session 持久化。
- `apps/server/src/sandbox-exec.ts`：Seatbelt 沙箱执行，deny-by-default profile。
- `apps/desktop/src/lib/chat-server.ts`：前端 HTTP/SSE 客户端，封装 fetch 与 EventSource。
- `apps/desktop/src/pages/chat.tsx`：Chat 页面，消费 HTTP 客户端，切页不中断生成。
- `apps/desktop/src/lib/chat-routes.ts`：桌面 Chat URL 身份（`/chat/new` 草稿与 `/chat/:sessionId` 会话）。
- `apps/desktop/src-tauri/src/services/chat_server.rs`：Tauri 侧进程拉起、token 注入、优雅退出。

### 4.1 桌面 Chat URL

前端用路径区分空白草稿和已有会话，不再把三种模式挤在 `/chat?sessionId=` 上：

- `/#/chat` 与旧的 `/#/chat?sessionId=` / `?workspaceId=` 重定向到新 path
- `/#/chat/new?workspaceId=&workspaceCwd=`：Workspace 空白草稿，URL 不含 `sessionId`
- `/#/chat/:sessionId`：历史或进行中的会话；切会话时先 skeleton 再灌消息
- 草稿在 `ensureSession` / 首条消息后 `replace` 到 `/chat/:sessionId`，不卸载 `ChatPage`

UI 身份跟路由走，不跟 query 抢状态。归档只读详情仍是 `/settings/history/:source/:id`。

## 5. 一句话总结

**Session/Run 真相源在本机 Node HTTP Server；UI 与侧栏只消费 HTTP/事件；宿主负责进程与敏感能力。** 多 chat 并发与进行中状态已实现，调试和迁移到其它应用通过 HTTP 协议完成。
