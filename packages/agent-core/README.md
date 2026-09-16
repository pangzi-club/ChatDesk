# @chatdesk/agent-core

`packages/agent-core` 是 ChatDesk 的 Node agent harness。Chat Server（`apps/server`）通过它承载会话与模型运行，CLI（`apps/cli`）在进程内直接复用。它负责会话持久化、Run 生命周期、内置工具、沙箱、MCP、Skills 与记忆等 agent 运行时；HTTP、CORS 与 SSE 属于 `apps/server`，不在本包内。

## 组合根

`createAgentCore`（`src/engine.ts`）是唯一入口，负责初始化存储、`RunRegistry`、jobs、MCP 等运行时并返回 `AgentCore`：

```ts
const core = await createAgentCore({ dataDir, createLanguageModel });
// core.store         SessionStore：会话、消息与附件
// core.runs          RunRegistry：Run 真相源
// core.jobs          JobRegistry：后台 Bash Job
// core.chatConfig    模型/工具/沙箱/MCP/Skills 配置
// core.memory / core.plans / core.workspaces / core.mcp / ...
// core.shutdown()    停止运行、Job、MCP 并释放数据目录锁
```

`dataDir` 默认加数据目录锁（`acquireLock: false` 可跳过），保证同一目录只有一个 harness 实例在写。

## 主要模块

```text
src/
├── engine.ts              # createAgentCore 组合根
├── run-registry.ts        # Run 真相源：多路生成、abort、status 状态机、toolApproval、上下文压缩、崩溃恢复
├── protocol.ts            # 服务端协议类型（ServerModelConfig、RunStartInput 等）
├── model-adaptor.ts       # 供应商差异适配（Responses / Chat Completions）；kimi.ts、minimax.ts 等专用适配
├── system-prompt.ts       # 系统提示词组装
├── store.ts               # SessionStore：会话、消息与附件持久化
├── *-store.ts             # 配置、记忆、计划、工作区、活动日志、AI 用量、图片生成等存储
├── job-registry.ts        # 后台 Bash Job 的启动、输出游标与等待
├── mcp-runtime.ts         # MCP 服务连接与工具暴露
├── file-read / file-edit / file-search / web-tools / conversation-tools / workspace-tools 等  # 内置工具
├── todo-tool / plan-tool / task-tool / skill-tool / create-plugin 工具
├── sandbox-exec.ts 等     # 沙箱执行与审批（protected-paths、boundary reviewer、审批日志）
├── browser-runtime.ts     # 无头浏览器运行时（配套 workers/browser-worker.mjs）
├── platform/              # PlatformAdapter 抽象与 NodePlatformAdapter 实现
├── image-compress.ts      # 附件图片 Sharp 压缩
└── *.test.ts              # vitest 测试，与实现同目录
skills/                    # 随包分发的内置 skills
workers/                   # 随包分发的 sidecar 脚本（browser-worker.mjs）
```

## 边界

- 可以 import `@chatdesk/shared`、Node.js API 与 AI SDK（`ai`、`@ai-sdk/*`、`zod`）。
- 不得 import Hono、React、桌面页面或 Electron 代码。
- 桌面 UI 不得直接 import 本包；浏览器侧只能通过 Chat Server HTTP 访问。

## 开发与测试

在仓库根目录运行：

```sh
pnpm agent-core:test
pnpm agent-core:typecheck
```

## 相关文档

- [`docs/chat-http-server-architecture.md`](../../docs/chat-http-server-architecture.md)
- [`docs/model-adaptor.md`](../../docs/model-adaptor.md)
- [`docs/agent-sandbox-permission-controls.md`](../../docs/agent-sandbox-permission-controls.md)
- [`docs/chat-context-compaction.md`](../../docs/chat-context-compaction.md)
