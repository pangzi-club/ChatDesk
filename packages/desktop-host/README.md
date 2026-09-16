# @chatdesk/desktop-host

`packages/desktop-host` 为 Electron 主进程提供桌面宿主服务，当前核心是 Chat Server 进程监督器（`ChatServerSupervisor`）：Electron 启动时由它拉起本地 Chat Server 子进程，并负责健康监控与崩溃重启。

## 能力

- `ChatServerSupervisor`：spawn / 停止 Chat Server 子进程，维护 `running | starting | restarting | offline` 生命周期状态；按 `maxRestartAttempts`、`startupTimeoutMs`、`restartDelayMs`、`monitorIntervalMs` 等参数执行重启策略，并通过状态监听器向宿主回报 `ChatServerHostInfo`（host、port、token、managed、lastExit）。
- 未显式传入 token 时自动生成随机 token；端口由调用方解析后传入，默认值取自 `@chatdesk/shared/chat-server`，本包不维护第二份默认。
- `createChatServerOutputFormatter`（`chat-server-output.ts`）：给子进程 stdout/stderr 加 `[Chat Server]` 前缀与样式，便于在宿主日志中区分来源。
- `fetchImpl` / `spawnImpl` 可注入，便于在不真正拉起进程的情况下测试。

## 边界

- 只依赖 Node.js API 与 `@chatdesk/shared`，不依赖 Electron API；`apps/electron` 在主进程中使用本包，native 宿主边界见仓库根 `AGENTS.md`。
- 这是 workspace 中唯一以构建产物对外导出的包：`exports` 指向 `dist/index.js`，改动源码后需要重新构建才能被 Electron 侧消费（打包流程见 `pnpm desktop:sidecars`）。

## 开发与测试

在仓库根目录运行：

```sh
pnpm desktop-host:test
pnpm desktop-host:typecheck
pnpm --filter @chatdesk/desktop-host build   # 生成 dist/
```

## 相关文档

- [`docs/desktop-packaging.md`](../../docs/desktop-packaging.md)
- [`apps/server/README.md`](../../apps/server/README.md)
