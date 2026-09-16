# @chatdesk/shared

`packages/shared` 是 ChatDesk 的运行时中立契约与算法包，被浏览器渲染层（`apps/desktop/src`）、Chat Server（`apps/server`）、CLI（`apps/cli`）、agent harness（`packages/agent-core`）和桌面插件 SDK 共同引用。它只放跨运行时共享的类型、常量和纯算法，位于 workspace 依赖图的最底层。

## 边界

- 不 import React、DOM、Node.js、Electron 或文件系统 API；平台相关的适配放在各自的运行时包里。
- 可以引用 `ai`（npm）中的类型（如 `UIMessage`）。
- `chat.ts` 中的会话/消息结构会影响落盘格式：调整数据结构时同步 `CHAT_SCHEMA_VERSION`，并按需在 [`docs/data-migration.md`](../../docs/data-migration.md) 中补充迁移说明。

## 模块概览

入口 `src/index.ts` 导出以下模块；`chat-server.ts` 另有独立子路径导出 `@chatdesk/shared/chat-server`：

```text
src/
├── chat.ts                  # 会话与消息契约：CHAT_SCHEMA_VERSION、SessionStatus、SandboxMode、默认工作区常量
├── chat-server.ts           # Chat Server 连接默认值：CHAT_SERVER_DEFAULT_PORT、normalizeChatServerPort
├── desktop-bridge.ts        # DesktopBridge IPC 契约类型（渲染层与 Electron preload 之间的约定）
├── desktop-plugin-slots.ts  # DESKTOP_UI_SLOTS：桌面插件可贡献的 UI slot 列表（宿主、SDK、create_plugin 工具共用）
├── image-generation.ts      # 图片生成契约：KIE API 基址、宽高比等常量
├── agent-avatar.ts          # Agent 头像 emoji 池
├── async.ts                 # mapWithConcurrency 等异步工具
├── record.ts                # isRecord / asRecord / cleanString 等未知值窄化守卫
├── token-estimate.ts        # estimateTokenCount 粗略 token 估算
└── *.test.ts                # vitest 测试，与实现同目录
```

## 开发与测试

在仓库根目录运行：

```sh
pnpm shared:test
pnpm shared:typecheck
```

## 相关文档

- [`docs/chat-http-server-architecture.md`](../../docs/chat-http-server-architecture.md)
- [`docs/data-migration.md`](../../docs/data-migration.md)
