# Repository Guidelines

These instructions apply to the entire repository.

Durable project-specific notes live in [`MEMORY.md`](MEMORY.md). Read it when looking up ChatDesk sessions or other local runtime data.

## AI Usage Accounting

- Unless a task explicitly says otherwise, every AI/model invocation must record its token usage through the existing usage persistence and statistics path. This includes background jobs, reviewers, generated text helpers, and feature-specific AI actions.
- New AI integrations must preserve provider/model identity and input/output/cache/reasoning token fields when the provider returns them. Do not add an untracked AI call.

## Package Manager

- Use the pnpm version declared in `package.json` (`pnpm@11.19.0`).
- Prefer Corepack to activate the pinned version when necessary: `corepack prepare pnpm@11.19.0 --activate`.
- Use `pnpm` for installing dependencies and running scripts. Do not use npm or Yarn, and do not create their lockfiles.

## Required Final Step

- After completing every task, run `pnpm format` before reporting the result.
- Review the formatting changes and include all task-related formatted files in the final result.
- Run any additional checks appropriate to the change, such as `pnpm check`, after formatting.

## CI Verification

- Before creating or updating a commit or pull request, run the complete CI command sequence. Do not rely only on a targeted test or a package-local build.
- Match the CI toolchain: Node.js 22, pnpm 11.19.0, and `pnpm install --frozen-lockfile`.
- Run these commands from the repository root, in order, and require every command to pass:
 1. `pnpm exec biome format .` (CI read-only formatting check; run `pnpm format` first when changes are needed.)
 2. `pnpm check` (Biome static checks, then workspace TypeScript typecheck)
 3. `pnpm test`
 4. `pnpm build`
- Treat any failure in this sequence as a blocker for reporting the change as CI-ready. Record environmental or pre-existing failures explicitly instead of presenting partial verification as complete.

## Development Server

- Never start or open a development server.
- Never attempt to repair, recreate, reinstall, or otherwise modify `node_modules`; report dependency issues instead.

## Desktop Runtime

- New features must target Electron only.

## List Data and Loading States

- Use `@tanstack/react-query` for asynchronous list fetching, caching, refetching, and request state. Do not implement list request lifecycles with ad hoc `useEffect` and local loading state.
- Show a layout-matching skeleton while a list's initial query is loading. Do not replace the list with plain loading text or a spinner.
- Preserve existing content during background refetches when practical; reserve the full skeleton for the initial load or for cases where no usable list data is available.
- Keep empty, error, and loading states distinct.

## Destructive Confirmation

- Use the shared shadcn `AlertDialog` for destructive actions that require confirmation. Do not use `window.confirm` or other native confirmation dialogs.

## Settings Search

- When adding, removing, or renaming a Settings page, update the Settings search items in the same change so every visible Settings route remains discoverable by its current label and keywords.

## Desktop Design

- Before changing desktop pages, layouts, components, or styles, read and follow [`docs/desktop-design-guidelines.md`](docs/desktop-design-guidelines.md).
- Treat the current Sidebar, App Shell, and Chat experience as the repository's canonical design reference. Extend their quiet, compact, content-first workbench language instead of introducing a parallel visual system.
- Do not invoke, reference, or use the `frontend-design` skill as a design authority for this repository.
- When a change intentionally alters the shared desktop design language, update the design guidelines in the same change.

## Code Placement

Put new code in the narrowest directory that matches its runtime and responsibility. Do not add application runtime code to the repository root or duplicate the same behavior across runtimes.

### Browser Application (`apps/desktop/src`)

- `apps/desktop/src/pages/`: route-level screens and page-specific composition. A page may keep small private render helpers, but move reusable feature UI into `apps/desktop/src/components/`.
- `apps/desktop/src/components/`: reusable product components and feature interactions, such as chat dialogs, pickers, settings panels, and import flows. Components should receive data and callbacks rather than owning unrelated route or storage logic.
- `apps/desktop/src/components/ui/`: shared shadcn/Radix-style primitives only (`Button`, `Dialog`, `AlertDialog`, form controls, and similar). Keep product-specific behavior out of this directory; extend a primitive here only when the primitive itself needs a reusable capability.
- `apps/desktop/src/layouts/`: shared application chrome and nested route layouts, such as the app shell, navigation, titlebar, and outlet composition. Do not put a one-page screen here.
- `apps/desktop/src/router/`: route declarations, redirects, route-level layout wiring, and URL parameter mapping only. Keep data fetching and page UI in the page or library that owns it.
- `apps/desktop/src/lib/`: browser-side domain logic, API clients, persistence adapters, query helpers, parsers, and integrations. Keep this directory free of JSX; wrappers for Chat Server requests and desktop bridge calls belong here so pages and components do not call platform APIs directly.
- `apps/desktop/src/lib/importers/`: browser-side parsers for imported archive formats. Add a new source-specific importer here and keep the shared archive orchestration in `apps/desktop/src/lib/chat-archive.ts`.
- `packages/shared/`: runtime-neutral TypeScript contracts, constants, and algorithms imported by the browser, `apps/server`, `apps/cli`, and `packages/agent-core`. Keep it private to the workspace until a package publishing boundary is intentionally introduced. Do not import React, DOM, Node.js, Electron, or filesystem APIs from this directory.
- `apps/desktop/src/assets/`: assets imported by Vite from TypeScript/CSS. Put files that must be served at a stable public URL in `apps/desktop/public/` instead.
- `apps/desktop/src/App.tsx` and `apps/desktop/src/main.tsx`: application bootstrap, providers, and startup initialization only. `apps/desktop/src/App.css` is for global application styles; keep component/page styles close to their owning UI when the existing styling approach permits it.

For browser code, use this decision order: JSX that defines a URL screen belongs in `apps/desktop/src/pages/`; reusable JSX belongs in `apps/desktop/src/components/`; browser-only non-visual behavior belongs in `apps/desktop/src/lib/`; code needed by both browser and server belongs in `packages/shared/`.

### Chat Server Client (`packages/chat-server-client`)

- `packages/chat-server-client/src/index.ts`: runtime-neutral Chat Server HTTP and SSE client (`ChatServerClient`). Inject `fetch` and `EventSource`; do not import React, DOM, Node.js, or Electron.
- `packages/chat-server-client/src/*.test.ts`: tests colocated with the client they exercise.

Desktop UI must not import this package from pages or components. Wrap it in `apps/desktop/src/lib/chat-server.ts` so port, token, and host `fetch` stay in the desktop adapter.

### Agent Harness (`packages/agent-core`)

- `packages/agent-core/src/engine.ts`: `createAgentCore` composition root. Initializes session/run stores, `RunRegistry`, jobs, MCP, and related runtimes. CLI and future TUI should import this package in-process instead of talking HTTP.
- `packages/agent-core/src/run-registry.ts`: Run 真相源——多路生成、abort、status 状态机、toolApproval、上下文压缩、崩溃恢复。
- `packages/agent-core/src/*.ts`: Node-only harness modules (tools, sandbox, model adaptor, persistence, platform). Keep HTTP, CORS, and SSE out of this package.
- `packages/agent-core/src/*.test.ts`: Tests colocated with the harness module they exercise.
- `packages/agent-core/skills/`: builtin skill files shipped with the harness.
- `packages/agent-core/workers/`: sidecar worker scripts shipped with the harness, including `browser-worker.mjs`.

`@chatdesk/agent-core` may import `@chatdesk/shared`, Node.js, and AI SDK APIs. It must not import Hono, React, desktop pages, or Electron code. Desktop UI must not import this package; it reaches the harness through Chat Server HTTP.

### CLI (`apps/cli`)

- `apps/cli/src/chatdesk.mjs`: `bin` wrapper. Re-invokes `cli.ts` with `node --experimental-strip-types` so pnpm/npm can link a `chatdesk` executable.
- `apps/cli/src/cli.ts`: Node process entrypoint and signal handling.
- `apps/cli/src/parse-args.ts`: argv parsing for print mode (`-p` / `--prompt`, `--model`, `--cwd`).
- `apps/cli/src/run-prompt.ts`: in-process `createAgentCore` composition — resolve data dir, register cwd as a workspace, start a detached run, print the final assistant text.

The CLI may import `@chatdesk/agent-core` and `@chatdesk/shared`. It must not import Hono, React, desktop pages, `apps/server`, or Electron host code. Default workspace is `process.cwd()` unless `--cwd` is passed; do not bind CLI sessions to the Default workspace task directory. Register the `chatdesk` bin globally with `pnpm add -g ./apps/cli` from the repository root (`pnpm link --global` was removed in pnpm 11).

### Local Node Service (`apps/server`)

- `apps/server/src/server.ts`: Node process entrypoint, environment setup, data-directory lock, and HTTP server startup.
- `apps/server/src/app.ts`: Hono app assembly, middleware, authentication, and route registration. Compose `@chatdesk/agent-core` here; keep HTTP-only product features (archive import, automations) in this package.
- `apps/server/src/*.ts`: HTTP connection and product API modules (`cors`, `sse-keepalive`, archive/automation stores).
- `apps/server/src/*.test.ts`: Tests for HTTP handlers and server-only product APIs.

The Node service may import `@chatdesk/agent-core` and `@chatdesk/shared`, but must not import React components, browser pages, `src/lib/` browser adapters, or Electron host code. Browser callers should reach this service through `@chatdesk/chat-server-client` and the desktop adapter in `apps/desktop/src/lib/chat-server.ts`.

### Electron Desktop Layer (`apps/electron`)

- `apps/electron/src/main.ts`: Electron startup, window, tray, IPC registration, and Chat Server supervisor wiring.
- `apps/electron/src/preload.cts`: `contextBridge` injection of `DesktopBridge`. Keep this file self-contained; sandboxed preloads cannot import sibling modules.
- `apps/electron/src/ipc-contract.ts`: IPC command names, event prefixes, and input validation.
- `packages/desktop-host`: Chat Server process supervisor used by Electron main.

Frontend code should call native functionality through `apps/desktop/src/lib/desktop-bridge.ts`, not by placing Electron APIs throughout pages or components. Native code must not depend on browser UI code.

### Tooling, Documentation, and Generated Files

- `scripts/`: repository build, development orchestration, packaging, and other developer tooling. Keep these scripts independent from page rendering. Local data migrations go through `pnpm migrate <command>` (`scripts/migrate.mjs`) and are documented in [`docs/data-migration.md`](docs/data-migration.md); do not add new top-level `migrate:*` or `chat:sessions:*` package scripts.
- `docs/`: architecture notes, operational guidance, and decisions. Update the relevant document when a change alters a documented boundary or workflow.
- Root configuration files (`package.json`, `pnpm-workspace.yaml`, `biome.json`, and similar): workspace-wide tooling/configuration only. Desktop-specific TypeScript/Vite configuration belongs under `apps/desktop/`; Electron host configuration belongs under `apps/electron/`.
- `.data/`, `.cache/`, `dist/`, `apps/electron/dist-electron/`, and generated sidecar/binary output: local or generated artifacts. Do not add application source code or secrets to these paths, and do not edit generated output by hand.

### Dependencies and Tests

- Keep the dependency direction explicit: pages/layouts/components may use `apps/desktop/src/lib/`, `packages/shared/`, and `apps/desktop/src/components/ui/`; `apps/desktop/src/lib/` may use `packages/shared/` and `@chatdesk/chat-server-client`; `packages/shared/` stays platform-neutral; `packages/chat-server-client` may use `packages/shared/` and `fetch` / `EventSource`; `packages/agent-core` may use `packages/shared/` and Node APIs; `apps/server` and `apps/cli` may use `@chatdesk/agent-core` and `packages/shared/`; `apps/electron` and `packages/desktop-host` remain a separate native host boundary.
- Put a test beside the implementation it exercises (`*.test.ts` or `*.test.tsx`) and use the test runner for that runtime. Do not introduce a second test framework or a frontend test setup in an unrelated directory without documenting the choice.
- When a change crosses a boundary, update the adapter and its contract at that boundary instead of reaching through it. For example, add a Chat Server endpoint in `apps/server`, the HTTP/SSE method on `ChatServerClient` in `packages/chat-server-client`, the desktop wrapper in `apps/desktop/src/lib/chat-server.ts`, and the consuming query/mutation in the owning page or component.
