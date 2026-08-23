# Electron 迁移计划

## 目标

将 ChatDesk 从 Tauri 逐步迁移到 Electron，同时保持以下边界不变：

- React/Vite renderer 继续位于 `apps/desktop`；
- `@chatdesk/agent-core` 继续作为 Session/Run 真相源，`apps/server` 继续作为 HTTP 入口；
- HTTP/SSE、会话格式和 `~/.chatdesk` 数据目录保持向后兼容；
- Tauri 在 Electron 达到稳定发布标准前继续作为可回滚宿主。

迁移不是把 Rust 代码逐文件翻译成 Node，而是让 Electron 成为第二个宿主，实现与 Tauri 相同的桌面能力契约。

## 目标架构

```text
apps/desktop/src              React/Vite renderer
  -> desktop bridge            typed host capability boundary
apps/electron                  Electron main/preload/services（第二阶段引入）
apps/server                    Chat Server HTTP、鉴权、产品 API
packages/agent-core            Agent harness：会话、运行、工具编排
packages/shared                跨运行时的 IPC 类型和协议
shared Node runtime            Chat Server、sandbox、browser worker
```

Renderer 不直接调用 Electron、Tauri 或 Node API。所有宿主能力通过 bridge 进入；Tauri 和 Electron 分别提供自己的适配器。

## 分阶段执行

### 0. 基线与 PoC

- 记录 Tauri 的启动时间、Chat Server 就绪时间、内存和关键工作流成功率。
- 优先验证交互式 PTY、Playwright/Sharp native 依赖、窗口标题栏和托盘。
- 明确 macOS、Windows、Linux 的安装包和签名要求。

退出标准：有能力矩阵、性能基线和一次可执行的回滚演练。

### 1. 抽离 renderer 宿主边界（当前阶段）

- 使用 `apps/desktop/src/lib/desktop-bridge.ts` 定义统一 bridge。
- 先迁移设置、文件选择、外链、图片保存、托盘和事件订阅。
- Tauri 继续作为当前 bridge 实现；Electron bridge 通过 `contextBridge` 注入。
- 后续逐步清理其它模块中的直接 `@tauri-apps/*` 引用。

退出标准：低风险能力在 Tauri 下行为不变，renderer 只依赖 bridge 或产品级 adapter。

### 2. Electron 壳与 Chat Server 监管（当前默认宿主）

- 新增 `apps/electron` main/preload/services 包。
- Electron `43.4.0` 与 electron-builder `26.15.3` 已加入 workspace；安装命令：`pnpm install --frozen-lockfile`。
- 使用 `BrowserWindow`、单实例锁、托盘、窗口状态和应用退出钩子。
- 生产打包复用共享 Node runtime 启动 `chat-server.cjs`；开发环境用同一 Node runtime 的 watch 模式直接运行 `apps/server/src/server.ts`，不要用 Electron runtime 承载 Sharp/Playwright。
- 保留 loopback、随机 token、健康检查、自动重启和优雅退出。

退出标准：Electron 可以独立启动、打开 Chat、重启 Chat Server，并在退出时完成清理。

### 3. 原生能力迁移

- 文件/目录选择、保存文件、外部链接和系统日志迁移到 Electron main。
- `convertFileSrc` 替换为受限 custom protocol，禁止 renderer 任意读取 `file://`。
- MCP 和其它跨域 HTTP 请求经 main 或 Chat Server 代理，不能无条件改成 renderer `fetch`。
- PTY 先做独立 Node worker PoC，保留 xterm 的输入、输出、resize 和退出语义。
- 复用现有 workspace 路径校验和 sandbox 策略，不把任意文件系统权限暴露给页面。

退出标准：工作区、终端、附件、图片、MCP、Git 和 sandbox 通过功能矩阵。

### 4. 数据兼容与回滚

- 首个 Electron 版本继续使用 `~/.chatdesk`，不做隐式目录切换。
- 增加数据目录实例锁，禁止 Tauri 与 Electron 同时写入同一份数据。
- 对旧设置、会话、附件和归档使用备份后迁移；迁移必须幂等、可中止、可回滚。
- 窗口几何单独兼容原 Tauri 配置目录，不与 Chat Server 数据混在一起。

退出标准：旧数据 fixture 可读取，新旧版本切换不丢数据，异常中断后可恢复。

### 5. 打包、CI 与 Beta

- 将现有 sidecar 构建整理为 Tauri/Electron 共用的 runtime staging。
- Electron 安装包必须验证 Node runtime、Chat Server、browser worker、Playwright Chromium 和 Sharp。
- 增加 Electron 的 macOS、Windows、Linux 构建、签名、安装后 smoke test。
- Electron 作为本地开发和默认桌面构建入口；Tauri 保留为回退宿主和现有发布流水线。
- 至少两个稳定发布周期无阻断问题后，才删除 Tauri 构建和回滚路径。

## 安全基线

- `nodeIntegration: false`、`contextIsolation: true`、renderer sandbox 开启。
- preload 只暴露显式、最小化的 bridge 方法。
- 校验 IPC 参数、调用来源、URL 协议和 workspace 根目录。
- Chat Server 只监听 `127.0.0.1`，所有请求继续使用 Authorization token。
- 不新增绕过既有 AI usage accounting 的模型调用。

## 当前进度

- [x] 建立 `DesktopBridge` 契约并保留 Tauri 适配器。
- [x] 将设置、文件选择、外链、图片保存、托盘、标题栏和宿主事件切换到 bridge。
- [x] 抽离 Chat Server supervisor，覆盖 loopback/token 注入、健康检查、自动重启和优雅停止。
- [x] 将终端和跨域 HTTP 能力切换到 Electron 可实现的受限接口；Electron 使用 `node-pty` 和主进程受限 HTTP 代理。
- [x] 新增 Electron main/preload，启用 `nodeIntegration: false`、`contextIsolation: true`、sandbox 和显式 IPC。
- [x] 将 supervisor 接入 Electron main，保留 loopback、token、健康检查、自动重启和退出清理。
- [x] 迁移 PTY 和 MCP/图片相关 HTTP 调用；仍需完成多平台 native rebuild 和安装后 smoke test。
- [x] Chat Server 在共享数据目录上增加实例锁，Tauri/Electron 不能同时启动同一份 Chat Server 数据。
- [x] 旧数据迁移记录新增文件与设置备份，支持异常中断后通过 manifest 安全回滚。
- [x] 在当前 macOS 主机生成并检查 Electron DMG/ZIP，产物包含 renderer、Node runtime、Chat Server、Playwright 和 `node-pty` native 模块。
- [x] 将根目录 `pnpm dev`、`pnpm desktop:dev` 和 `pnpm desktop:build` 切换到 Electron，并保留 `tauri:dev` / `tauri:build` 回退命令。
- [ ] 完成 Windows/Linux 安装包、签名和安装后 smoke test。

## 验收命令

每个阶段完成后至少运行：

```sh
pnpm format
pnpm check
pnpm test
pnpm build
```

Electron 引入后增加 bridge 合同测试、Chat Server 生命周期测试、数据迁移 fixture 测试、PTY 测试和安装包 smoke test。

## Electron 本地运行

```sh
pnpm install --frozen-lockfile
pnpm electron:dev
```

`electron:dev` 会编译 Electron main、启动 Vite renderer，并以独立的 `ChatDesk Dev` 应用身份立即创建 Electron 窗口；Chat Server 使用当前 token 在后台完成启动和鉴权。首次运行且本地没有 Chat Server worker 时，先执行一次：

```sh
pnpm desktop:sidecars
```

生成安装包：

```sh
pnpm electron:package
```

Electron main 在打包环境从共享 runtime 或 `workers/chat-server.cjs` 启动 Chat Server。开发编排直接以 `node --watch --experimental-strip-types apps/server/src/server.ts` 运行源码，服务端及共享模块改动会自动重启；浏览器 worker、沙箱 worker、Sharp 和 Playwright 仍复用 `apps/desktop/assets/resources/node-runtime` 下的生成资源。显式设置 `CHATDESK_CHAT_SERVER_WORKER` 时会关闭默认 watch 行为并使用指定入口。
