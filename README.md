# ChatDesk

ChatDesk 是一个基于 Tauri、React 和 TypeScript 的本地 AI 工作台。它把多模型聊天、会话历史、工作区工具、Skills、MCP、自动化、图片生成和沙箱审批集中在一个桌面应用中。

项目默认在本机运行：前端由 Vite 提供，Node.js Chat Server 负责会话和模型运行，Tauri 负责桌面窗口、原生能力和 sidecar 生命周期管理。API key 和会话数据保存在本机，不会由本项目代为托管。

## 功能

- OpenAI 兼容接口，以及 Kimi、MiniMax、DeepSeek Responses 等模型适配，详见 [docs/model-adaptor.md](docs/model-adaptor.md)
- 多会话、流式响应、用量统计和历史归档导入
- 工作区文件、终端、Git 和浏览器工具
- MCP 服务、Skills 管理和可配置的沙箱审批
- Tauri 桌面应用和独立运行的本地 Chat Server

## 环境要求

- Node.js 22 或更高版本
- pnpm 11.19.0（项目通过 `packageManager` 固定）
- 仅开发前端：无需 Rust
- 构建桌面应用：需要 Rust、Tauri CLI 依赖和对应平台的构建工具，详见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## 快速开始

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install
pnpm dev
```

`pnpm dev` 会启动 Tauri 桌面窗口、Vite 前端和 Chat Server，并为前后端生成同一个本地鉴权 token。开发模式下 Chat Server 会使用仓库内的 `apps/desktop/src-tauri/src/sidecar/browser-worker.mjs`；首次使用浏览器工具前需要安装 Chromium：

```sh
pnpm --filter chatdesk-desktop exec playwright install chromium --only-shell
```

若只需要浏览器预览，可使用 `pnpm dev:web` 并打开 `http://localhost:1420`。如果需要固定端口或 token，可复制 `.env.example` 为 `.env.local`，在启动前导出其中的变量（例如 `set -a; source .env.local; set +a`）。

常用命令：

```sh
pnpm check       # Biome 格式和静态检查
pnpm shared:typecheck # 检查 @chatdesk/shared 类型
pnpm shared:test # 运行共享包测试
pnpm build       # 完整代码构建：shared + Web 前端 + Chat Server
pnpm desktop:build # 构建 Tauri 桌面安装包
pnpm desktop:sidecars # 仅构建桌面端 sidecar
pnpm dev:web     # 仅启动 Vite 前端
pnpm dev:server  # 仅启动 Chat Server
pnpm server:test # Chat Server 测试
pnpm desktop:dev # 启动桌面开发模式
```

不要把 `.env.local`、`.data/`、`~/.chatdesk/` 或包含 API key 的导出文件提交到版本库。

旧版本数据迁移使用独立脚本，不会由新 App 自动执行。统一入口是 `pnpm migrate`，详见 [docs/data-migration.md](docs/data-migration.md)：

```sh
pnpm migrate
pnpm migrate chatdesk -- --apply
pnpm migrate jsonl -- --apply
pnpm migrate default-workspace -- --apply
```

## 配置

Chat Server 支持的环境变量和 HTTP API 见 [`apps/server/README.md`](apps/server/README.md)。最常用的变量如下：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `CHAT_SERVER_HOST` | `127.0.0.1` | Chat Server 监听地址，建议保持回环地址 |
| `CHAT_SERVER_PORT` | `14317` | Chat Server 监听端口 |
| `CHAT_SERVER_TOKEN` | 每次启动随机生成 | API 鉴权 token |
| `CHAT_SERVER_DATA_DIR` | macOS: `~/.chatdesk/chat-server`；其他平台: `.data/chat-server` | 本地会话、设置和记忆目录 |
| `CHAT_SERVER_BROWSER_WORKER` | 开发时回退到源码 `browser-worker.mjs` | 浏览器 worker 脚本或可执行文件 |
| `CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH` | 未设置（使用 Playwright 默认缓存） | Headless Chromium 资源目录 |

API key 在应用设置中配置并保存在本机。使用 `CHAT_SERVER_HOST=0.0.0.0` 对外暴露服务前，请自行配置网络层访问控制和长期 token；本项目默认只面向本机使用。

## 项目结构

```text
apps/desktop/src/    React 页面、组件和浏览器端适配器（桌面端 workspace package）
apps/server/src/     Hono Chat Server、存储、运行时和 Node 测试（workspace package）
packages/shared/     浏览器与服务端共用的运行时无关代码（`@chatdesk/shared`）
apps/desktop/src-tauri/src/ Tauri 命令、原生服务和 sidecar 管理
docs/                架构、沙箱、数据迁移和桌面打包说明
scripts/             开发编排与本地数据迁移入口（`pnpm migrate`）
```

## 开源协作

欢迎提交 issue 和 pull request。提交前请运行 `pnpm format`、`pnpm check`、`pnpm build` 和 `pnpm server:test`。涉及 Chat Server、Tauri 边界或数据格式的改动，也请同步更新对应的 `docs/` 或 `apps/server/README.md`。

## 许可证

本项目采用 [MIT License](LICENSE)。第三方依赖和随应用分发的浏览器资源仍受各自许可证约束，请在重新分发前查看其许可和 NOTICE 文件。

安全问题请按 [SECURITY.md](SECURITY.md) 的说明私下报告，不要在公开 issue 中提交 API key 或可利用细节。
