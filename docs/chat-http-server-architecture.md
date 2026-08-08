# Chat HTTP Server 架构结论

本文记录关于「多会话并发对话」与「将核心对话逻辑下沉到 Node HTTP Server」的讨论结论，以及该服务需要实现的功能边界。

## 1. 问题背景

当前 Chat 是单页、单 `useChat` 实例、单活跃会话架构：

- 流式 / in-progress 状态只活在 `ChatPage` 本地；
- 切换会话会主动 `stop()`，离开页面会随组件卸载中断生成；
- `ChatIndexItem` 与侧栏列表没有 `status` 字段，无法展示各会话进行中状态；
- 生成中不落盘，切走后无法恢复进行中消息。

持久化层已是 per-session（`chat/{id}/session.json`），但运行时层是单飞。仅改 UI 无法支持「多 chat 同时跑 + 侧栏看进行中」。

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
| **Node HTTP Server** | **选定方案**：方便调试、实现简单、协议可迁移到其它客户端 |

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
3. 启动时生成 token 并保留客户端 `Authorization` 传递链路；当前本地桌面服务暂不校验 token，重新开放网络暴露前必须恢复认证；
4. 宿主进程负责拉起、崩溃重启、退出时等待 inflight 落盘后再终止；
5. API Key 等密钥由受控配置注入，避免只活在 webview 内存里长期裸奔。

## 3. HTTP Server 需要实现的功能

### 3.1 进程与配置

- 提供可独立启动的 Node 入口（不启桌面壳也能跑，便于调试）；
- 读取宿主注入的配置：监听地址、端口、token、数据目录、模型相关密钥等；
- 健康检查（如 `GET /health`）；
- 优雅关闭：停止接受新 run，尽量结束或持久化进行中状态后退出。

### 3.2 Session 管理

- 创建 / 列出 / 获取 / 更新 / 删除会话；
- 维护会话元数据：`id`、`title`、时间戳、`modelId`、`workspaceId` / `cwd`、MCP / skills 选择等；
- 维护消息列表（至少支持 UI 可渲染的消息结构）；
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
- `tool.request` / `tool.result`：工具调用过程（若工具经宿主执行）；
- `run.error` / `run.done`：失败与完成；
- （可选）token usage / 耗时等元数据。

要求：客户端重连后能重新订阅并进行中状态；是否支持断线续流可第二期再做，但 status 与已落库消息应可恢复。

### 3.5 模型调用与提示词组装

将现有前端 transport 中的核心逻辑下沉到 server：

- OpenAI 兼容 HTTP 流式调用；
- `streamText` + tools 循环（含 Responses / chat 路径差异）；
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

### 3.8 显式不做或后置的事项

以下内容可后置，避免第一期范围膨胀：

- 公网部署、多租户鉴权；
- 完整断线续流（`reconnectToStream`）；
- 将全部工具执行完全移出宿主；
- 替换现有归档 / History 体系（可继续读现有 archive，与 live runtime 分离）。

## 4. 与现有代码的关系（迁移指向）

现状关键位置（迁移时对照，不必一次搬完）：

- `src/pages/chat.tsx`：单 `useChat`、切会话 `stop()`、transport / `streamText`
- `src/lib/chat-store.ts`：`ChatSession` / `ChatIndexItem` 与落盘
- `src/layouts/app-shell.tsx`：侧栏会话列表（尚无 status）
- `src-tauri`：chat 落盘命令、workspace / MCP / seatbelt 等能力

目标演进：

1. 定义 HTTP + 事件协议（session / run / events）；
2. 将 transport 与多路 run registry 迁入 Node server；
3. UI 改为 HTTP 客户端，去掉切页即 `stop()`；
4. 侧栏订阅 `session.status`；
5. Tauri 增加进程拉起、token、优雅退出；工具经宿主桥接。

## 5. 一句话总结

**把 Session/Run 真相源放到本机 Node HTTP Server；UI 与侧栏只消费 HTTP/事件；宿主负责进程与敏感能力。** 这样既支持多 chat 并发与进行中状态，又便于调试和迁移到其它应用。
