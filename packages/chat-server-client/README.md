# @chatdesk/chat-server-client

`packages/chat-server-client` 是 Chat Server 的 HTTP 与 SSE 客户端（`ChatServerClient`），运行时中立：桌面渲染层、CLI 或脚本都可以用它访问本地 Chat Server。`fetch` 与 `EventSource` 由调用方注入，因此同一个客户端可以同时工作在浏览器与 Node 环境。

## 边界

- 不 import React、DOM、Node.js 或 Electron；`fetchImpl` / `eventSourceFactory` 通过 `ChatServerClientOptions` 注入，未注入时回退到 `globalThis` 上的实现。
- 只依赖 `@chatdesk/shared` 中的契约与常量。
- 桌面 UI 不得直接 import 本包：`apps/desktop` 必须经由 `apps/desktop/src/lib/server/chat-server.ts` 包装使用，host `fetch`、端口与 token 的装配留在 desktop 适配层。

## 客户端能力

`ChatServerClient` 覆盖 Chat Server 的主要 HTTP API（端点语义见 [`apps/server/README.md`](../../apps/server/README.md)）：

- 会话：`listSessions`、`createSession`、`ensureSession`、`loadSession`、`forkSession`、标题（重新生成/手动更新）、`deleteSession`
- 运行：`startRun`、`startRunAndWait`（提交一轮并等待完成）、`stopRun`
- 附件：`uploadAttachment`、`downloadAttachment`
- 后台 Job：`listJobs`、`getJob`、`getJobOutput`、`waitJob`、`stopJob`
- 配置与扩展：`getConfig` / `saveConfig`、模型连通性与列表（`testModel` / `listModels`）、记忆、Skills、MCP、沙箱审批记录、AI 用量日志、开发者环境
- 归档：`getArchiveIndex`、`getArchive`、`saveArchive`、`deleteArchive`
- 事件：`subscribeEvents` 订阅 SSE（先发 `snapshot`，随后是 `message.delta`、`run.done`、`job.updated` 等增量事件），支持按 `sessionId` 过滤，内置断线重连与 `onBeforeReconnect` 钩子

构造时传入 `baseUrl` 与 `token`（字符串或返回 token 的函数）；除 `health` 外的请求自动携带 `Authorization: Bearer`，非 2xx 响应统一抛出带 `status` 与 `payload` 的 `ChatServerError`。

## 开发与测试

在仓库根目录运行：

```sh
pnpm chat-server-client:test
pnpm chat-server-client:typecheck
```

## 相关文档

- [`apps/server/README.md`](../../apps/server/README.md)
- [`docs/chat-http-server-architecture.md`](../../docs/chat-http-server-architecture.md)
