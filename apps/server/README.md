# Chat Server

`apps/server` 是 ChatDesk 的本地 Node.js 聊天服务。它使用 Hono 提供 HTTP API，负责会话持久化、多会话运行、流式事件、模型配置、记忆、Skills、MCP 和归档导入。桌面端由 Tauri 启动并管理该服务；开发时也可以单独运行它进行接口调试。

## 环境要求

- Node.js 22 或更高版本
- pnpm 11.19.0（仓库根目录已声明）

依赖安装和脚本执行从仓库根目录进行：

```sh
pnpm install
```

## 开发与测试

在仓库根目录运行：

```sh
# 只启动 Chat Server
pnpm server:dev

# 运行 Chat Server 的 Node 测试
pnpm server:test
```

`apps/server` 现在是仓库 pnpm workspace 中的一个独立 package。推荐从仓库根目录安装依赖并运行脚本：

```sh
pnpm --filter chatdesk-chat-server dev
pnpm --filter chatdesk-chat-server test
pnpm --filter chatdesk-chat-server typecheck
```

`pnpm --filter chatdesk-chat-server dev` 会以 Node.js watch 模式执行 `src/server.ts`，修改 `apps/server/src` 下的服务端代码后会自动重启；`pnpm --filter chatdesk-chat-server start` 用于不启用 watch 的运行方式。开发模式下服务默认监听 `http://127.0.0.1:14317`。从仓库根目录启动完整开发环境请使用 `pnpm dev`。

## 配置

通过环境变量配置服务。未设置时使用以下默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CHAT_SERVER_HOST` | `127.0.0.1` | 监听地址，建议仅使用回环地址 |
| `CHAT_SERVER_PORT` | `14317` | 监听端口，允许范围为 `1024-65535` |
| `CHAT_SERVER_TOKEN` | 启动时随机生成 | API 鉴权 token |
| `CHAT_SERVER_DATA_DIR` | macOS: `~/.chatdesk/chat-server`；其他平台: `.data/chat-server` | 会话、设置、记忆和归档数据目录 |
| `CHAT_SERVER_PRODUCTION` | 未设置 | 设为 `1` 后启用致命错误处理和关闭时的运行清理 |
| `CHAT_SERVER_BROWSER_WORKER` | 开发时回退到 `apps/tauri/src-tauri/src/sidecar/browser-worker.mjs`（ESM 用 `import.meta.url`，也可从仓库根/`apps/server` 的 cwd 解析） | 浏览器 worker 可执行文件或脚本路径。打包 sidecar 是 CJS，`import.meta` 为空，由桌面宿主注入；未配置时浏览器工具会直接报错 |
| `CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH` | 未设置 | Playwright 浏览器资源目录。开发时若 `apps/desktop/assets/resources/playwright-browsers` 中已有 Chromium 则自动使用，否则走 Playwright 默认缓存 |
| `CHAT_SERVER_SHARP_PATH` | 未设置 | 打包后 Sharp native 运行时目录（含 `package.json` 与 `node_modules/sharp`）。开发态直接使用 `apps/server` 的 `sharp` 依赖 |
| `CHATDESK_BUILTIN_SKILLS_DIR` | 未设置 | 内置 skill 根目录。未设置时依次尝试 worker 旁 `skills/`、源码 `apps/server/skills` |

示例：

```sh
CHAT_SERVER_PORT=14318 \
CHAT_SERVER_TOKEN=local-dev-token \
pnpm server:dev
```

除 `GET /health` 和 CORS 预检 `OPTIONS` 请求外，API 请求需要携带以下任一形式的 token：

```http
Authorization: Bearer local-dev-token
```

或：

```text
/v1/sessions?token=local-dev-token
```

## HTTP API

服务使用 JSON 请求/响应；错误响应格式为 `{ "error": "..." }`。

### 运行状态

- `GET /health`：健康检查，返回监听信息和当前运行任务数，不需要鉴权。
- `GET/PATCH /v1/config`：读取或保存端口配置；修改端口后通常需要重启服务。

### 会话与运行

- `GET/POST /v1/sessions`：列出或创建会话。
- `POST /v1/sessions/import`：批量导入会话。
- `GET/PATCH/DELETE /v1/sessions/:id`：读取、更新或删除会话。
- `POST /v1/sessions/:id/title`：根据当前对话用模型重新生成会话标题。
- `POST/GET/DELETE /v1/sessions/:id/attachments...`：上传、读取或删除附件。图片会在落盘前经 Sharp 压缩。
- `POST /v1/sessions/:id/runs`：启动一次模型运行；同一会话已有运行时返回 `409`。
- `POST /v1/sessions/:id/runs/stop`：停止当前运行。
- `GET /v1/jobs?sessionId=...`、`GET /v1/jobs/:id`：查询当前会话的后台 Bash Job。
- `GET /v1/jobs/:id/output?sessionId=...&cursor=...`：读取 Job 增量输出。
- `POST /v1/jobs/:id/wait`、`POST /v1/jobs/:id/stop`：等待或停止后台 Job。
- `GET /v1/events`：SSE 事件流；可用 `sessionId` 查询参数过滤会话。

会话列表中的 `status` 取值为 `idle`、`submitted`、`streaming`、`error` 或 `ready`。事件流会先发送 `snapshot`，随后发送 `session.status`、`message.delta`、`message.updated`、`run.error` 和 `run.done` 等事件，并定期发送 `ping` 保持连接。

通过 Bash 的 `block_until` 参数可以把命令转为后台 Job：`0` 表示立即后台，命令超过等待窗口仍在运行时也会返回 `jobId`。后台 Job 通过 `bash_wait`、`bash_output`、`bash_stop` 管理，并通过 `job.updated`、`job.output`、`job.done` 事件通知客户端。Job 绑定创建它的 session；Chat Server 重启时会终止托管进程并将其标记为 `interrupted`。

### 配置与扩展

- `GET/PATCH /v1/chat-config`：模型、工具、沙箱、MCP、Skills 和 API key 配置。
- `GET/PUT /v1/memory`：读取或保存长期记忆。
- `GET /v1/skills`、`GET/PUT /v1/skills/selection`：扫描 Skills（`~/.agents/skills` 与内置）和保存本机 skill 选择结果。桌面端列表会隐藏内置 skill，并用 `disabledSkillIds` 表示全局关闭项。
- `GET/PUT /v1/mcp`、`POST /v1/mcp/start`、`POST /v1/mcp/test`：管理 MCP 服务。
- `GET /v1/mcp/:id/tools`、`POST /v1/mcp/:id/call`、`POST /v1/mcp/:id/stop`：查看、调用或停止 MCP 工具。
- `GET /v1/sandbox-reviews`：读取沙箱审批记录，可按 `sessionId` 过滤。

### 归档

- `GET /v1/archive`、`GET/PUT/DELETE /v1/archive/:id`：列出、读取、保存或删除归档。
- `POST /v1/archive/scan/:source`：扫描 `codex` 或 `claude` 的 JSONL 会话归档。
- `POST /v1/archive/read-file`、`POST /v1/archive/path-exists`：在受限导入目录内读取或检查文件。

## 数据目录

macOS 默认数据目录为 `~/.chatdesk/chat-server`，其他平台默认使用 `.data/chat-server`，主要内容包括：

```text
~/.chatdesk/
├── chat-server/
│   ├── sessions/<session-id>/meta.json
│   ├── sessions/<session-id>/messages.jsonl
│   ├── sessions/<session-id>/attachments/*
│   ├── settings.json
│   ├── memory.json
│   ├── workspaces.json
│   └── server-config.json
└── tasks/<session-id>/   # Default Workspace 每个会话的独立工作目录
```

`meta.json` 保存去掉 `messages` 后的会话元数据；`messages.jsonl` 每行一条消息。服务启动时只初始化当前数据目录，不会扫描或迁移旧版本目录。存量 `session.json`、无 cwd 的 Default 会话，以及旧版数据目录，请使用仓库根目录的 `pnpm migrate` 迁移，详见 [`docs/data-migration.md`](../../docs/data-migration.md)。请勿将包含 API key 的数据目录提交到版本库。

## 与桌面端的关系

开发时，`pnpm dev` 会同时启动 Electron 桌面端和 Chat Server；Tauri 回退模式使用 `pnpm tauri:dev`。Chat Server 在开发模式下直接运行源码 `browser-worker.mjs`，不依赖打包后的 sidecar。打包时，`pnpm desktop:sidecars` 会将此服务构建为桌面端 sidecar；最终用户不需要单独安装 Node.js 或 pnpm。详见 [`docs/desktop-packaging.md`](../../docs/desktop-packaging.md) 和 [`docs/chat-http-server-architecture.md`](../../docs/chat-http-server-architecture.md)。

## 目录概览

```text
apps/server/
├── src/server.ts          # HTTP 服务入口
├── src/app.ts             # Hono 路由和服务组装
├── src/run-registry.ts    # 并发运行和流式事件
├── src/model-adaptor.ts   # 供应商 Responses / Chat Completions 差异
├── src/store.ts           # 会话与附件持久化
├── src/image-compress.ts  # 聊天图片 Sharp 压缩
├── src/*-store.ts         # 配置、记忆、归档和 Skills 存储
└── src/*.test.ts          # Node.js 测试
```

模型供应商差异（非 OpenAI 的 Responses 关闭 `store`）见 [`docs/model-adaptor.md`](../../docs/model-adaptor.md)。
