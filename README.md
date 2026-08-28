# ChatDesk

> ![en](https://img.shields.io/badge/lang-English-blue) **English** | [中文](README.cn.md)

ChatDesk is a local AI workbench built on Electron, React, and TypeScript. It brings multi-model chat, session history, workspace tools, Skills, MCP, automations, image generation, and sandbox approval into a single desktop application.

The project runs locally by default: Electron provides the desktop window and native capabilities, Vite serves the renderer, and a Node.js Chat Server handles sessions and model runs. API keys and session data are stored on your machine and are never hosted by this project on your behalf.

## Features

- OpenAI-compatible interfaces plus model adapters for Kimi, MiniMax, DeepSeek Responses, and more — see [docs/model-adaptor.md](docs/model-adaptor.md)
- Multiple sessions, streaming responses, usage statistics, and archive import for history
- Workspace files, terminal, Git, and browser tools
- MCP servers, Skills management, and configurable sandbox approval
- An Electron desktop app, a standalone local Chat Server, and an in-process CLI (`chatdesk -p`)

## Requirements

- Node.js 22 or higher
- pnpm 11.19.0 (pinned via the `packageManager` field)
- For Electron development and packaging: Node.js 22, pnpm 11.19.0, and the native module build tooling for your platform

## Quick Start

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install
pnpm dev
```

`pnpm dev` starts the Electron desktop window, the Vite renderer, and the Chat Server supervised by Electron. On first run, if there is no shared Chat Server worker yet, run once:

```sh
pnpm desktop:sidecars
```

If you only need a browser preview, use `pnpm dev:web` and open `http://localhost:1420`. To pin a port or token, copy `.env.example` to `.env.local` and export its variables before starting (for example `set -a; source .env.local; set +a`).

Common commands:

```sh
pnpm check           # Biome static checks + TypeScript typecheck across packages
pnpm typecheck       # tsc for each workspace package only
pnpm shared:test     # Run shared package tests
pnpm build           # Full build: shared + Web frontend + Chat Server
pnpm desktop:build   # Build the Electron desktop installer
pnpm desktop:sidecars # Build desktop sidecars only
pnpm dev:web         # Start only the Vite frontend
pnpm dev:server      # Start only the Chat Server
pnpm server:test     # Chat Server tests
pnpm chatdesk -- -p "What's the weather today?"  # Reuses its Chat Server when running on desktop, otherwise runs in-process
pnpm add -g ./apps/cli               # Install chatdesk to the pnpm global bin (pnpm 11 removed link --global)
pnpm desktop:dev     # Start Electron desktop development mode
```

Do not commit `.env.local`, `.data/`, `~/.chatdesk/`, or any exported file containing API keys.

Legacy data migration uses a standalone script and is never run automatically by the new app. The unified entry point is `pnpm migrate` — see [docs/data-migration.md](docs/data-migration.md):

```sh
pnpm migrate
pnpm migrate chatdesk -- --apply
pnpm migrate jsonl -- --apply
pnpm migrate default-workspace -- --apply
```

## Configuration

Chat Server environment variables and its HTTP API are documented in [`apps/server/README.md`](apps/server/README.md). The most commonly used variables are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHAT_SERVER_HOST` | `127.0.0.1` | Address the Chat Server listens on; keep it on the loopback interface |
| `CHAT_SERVER_PORT` | `14317` | Port the Chat Server listens on |
| `CHAT_SERVER_TOKEN` | Randomly generated at each start | API auth token |
| `CHAT_SERVER_DATA_DIR` | macOS: `~/.chatdesk/chat-server`; other platforms: `.data/chat-server` | Local sessions, settings, and memory directory |
| `CHAT_SERVER_BROWSER_WORKER` | Falls back to source `browser-worker.mjs` in development | Browser worker script or executable |
| `CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH` | Unset (uses the Playwright default cache) | Headless Chromium resource directory |

API keys are configured in the app settings and stored locally. Before exposing the service with `CHAT_SERVER_HOST=0.0.0.0`, configure network-level access controls and a long-lived token yourself; this project is designed for local use by default.

## Project Structure

```text
apps/desktop/src/    React pages, components, and browser-side adapters (desktop workspace package)
apps/server/src/     Hono Chat Server (connection, auth, product APIs)
packages/agent-core/ Agent harness: sessions, runs, tools, sandbox (`@chatdesk/agent-core`)
packages/shared/     Runtime-neutral code shared by browser and server (`@chatdesk/shared`)
apps/electron/       Electron main/preload and host services
docs/                Architecture, sandbox, data migration, and desktop packaging notes
scripts/             Dev orchestration and local data migration entry (`pnpm migrate`)
```

## Contributing

Issues and pull requests are welcome. Before submitting, run `pnpm format`, `pnpm check`, `pnpm build`, and `pnpm server:test`. For changes touching the Chat Server, the Electron boundary, or data formats, also update the relevant `docs/` or `apps/server/README.md`.

## License

This project is licensed under the [MIT License](LICENSE). Third-party dependencies and browser resources distributed with the app remain under their respective licenses; review their licenses and NOTICE files before redistributing.

Report security issues privately following [SECURITY.md](SECURITY.md). Do not submit API keys or exploitable details in public issues.
