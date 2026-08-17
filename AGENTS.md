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
  2. `pnpm check`
  3. `pnpm test`
  4. `pnpm shared:typecheck`
- Treat any failure in this sequence as a blocker for reporting the change as CI-ready. Record environmental or pre-existing failures explicitly instead of presenting partial verification as complete.

## Development Server

- Never start or open a development server.
- Never attempt to repair, recreate, reinstall, or otherwise modify `node_modules`; report dependency issues instead.

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
- `apps/desktop/src/lib/`: browser-side domain logic, API clients, persistence adapters, query helpers, parsers, and integrations. Keep this directory free of JSX; wrappers for Chat Server requests and Tauri `invoke` calls belong here so pages and components do not call platform APIs directly.
- `apps/desktop/src/lib/importers/`: browser-side parsers for imported archive formats. Add a new source-specific importer here and keep the shared archive orchestration in `apps/desktop/src/lib/chat-archive.ts`.
- `packages/shared/`: runtime-neutral TypeScript contracts, constants, and algorithms imported by both the browser and `apps/server`. Keep it private to the workspace until a package publishing boundary is intentionally introduced. Do not import React, DOM, Node.js, Tauri, or filesystem APIs from this directory.
- `apps/desktop/src/assets/`: assets imported by Vite from TypeScript/CSS. Put files that must be served at a stable public URL in `apps/desktop/public/` instead.
- `apps/desktop/src/App.tsx` and `apps/desktop/src/main.tsx`: application bootstrap, providers, and startup initialization only. `apps/desktop/src/App.css` is for global application styles; keep component/page styles close to their owning UI when the existing styling approach permits it.

For browser code, use this decision order: JSX that defines a URL screen belongs in `apps/desktop/src/pages/`; reusable JSX belongs in `apps/desktop/src/components/`; browser-only non-visual behavior belongs in `apps/desktop/src/lib/`; code needed by both browser and server belongs in `packages/shared/`.

### Local Node Service (`apps/server`)

- `apps/server/src/server.ts`: Node process entrypoint, environment setup, and HTTP server startup.
- `apps/server/src/app.ts`: Hono app assembly, middleware, authentication, and route registration. Keep substantial route/domain logic in dedicated modules.
- `apps/server/src/*.ts`: server-side domain modules, stores, runtimes, providers, protocol helpers, and tools. Use a focused module for each responsibility (for example, persistence in `*-store.ts` and execution coordination in `run-registry.ts`).
- `apps/server/src/*.test.ts`: Node tests colocated with the service source. Keep tests in `apps/server` when they exercise HTTP handlers, server persistence, providers, sandboxing, or other Node-only behavior.

The Node service may import runtime-neutral code from `packages/shared/`, but must not import React components, browser pages, `src/lib/` browser adapters, or Tauri code. Browser callers should reach this service through the client boundary in `src/lib/chat-server.ts`.

### Native Desktop Layer (`apps/desktop/src-tauri`)

- `apps/desktop/src-tauri/src/main.rs` and `apps/desktop/src-tauri/src/lib.rs`: Tauri startup, plugin setup, command registration, and application-wide wiring.
- `apps/desktop/src-tauri/src/commands/`: thin Tauri command handlers. Validate/deserialize command inputs, call a service, and return serializable results; keep filesystem, process, Git, and other business logic out of command handlers.
- `apps/desktop/src-tauri/src/services/`: native capabilities and side effects, including filesystem/workspace access, processes, Git, automation, sandboxing, and chat-server lifecycle management.
- `apps/desktop/src-tauri/src/models/`: Rust data structures shared by commands and services, especially `serde` request/response models. Keep transport models separate from service implementation details.
- `apps/desktop/src-tauri/capabilities/`: Tauri permission and capability declarations. Update these when adding or changing native commands or plugins.
- `apps/desktop/src-tauri/sidecar/`: source for JavaScript sidecar workers. Generated sidecars and build output are not hand-edited.

Frontend code should call native functionality through a small adapter in `apps/desktop/src/lib/` (using Tauri APIs there), not by placing `invoke` calls throughout pages or components. Native code must not depend on browser UI code.

### Tooling, Documentation, and Generated Files

- `scripts/`: repository build, development orchestration, packaging, and other developer tooling. Keep these scripts independent from page rendering. Local data migrations go through `pnpm migrate <command>` (`scripts/migrate.mjs`) and are documented in [`docs/data-migration.md`](docs/data-migration.md); do not add new top-level `migrate:*` or `chat:sessions:*` package scripts.
- `docs/`: architecture notes, operational guidance, and decisions. Update the relevant document when a change alters a documented boundary or workflow.
- Root configuration files (`package.json`, `pnpm-workspace.yaml`, `biome.json`, and similar): workspace-wide tooling/configuration only. Desktop-specific TypeScript/Vite/Tauri configuration belongs under `apps/desktop/`.
- `.data/`, `.cache/`, `dist/`, `apps/desktop/src-tauri/target/`, and generated sidecar/binary output: local or generated artifacts. Do not add application source code or secrets to these paths, and do not edit generated output by hand.

### Dependencies and Tests

- Keep the dependency direction explicit: pages/layouts/components may use `apps/desktop/src/lib/`, `packages/shared/`, and `apps/desktop/src/components/ui/`; `apps/desktop/src/lib/` may use `packages/shared/`; `packages/shared/` stays platform-neutral; `apps/server` may use only `packages/shared/` across runtimes; `apps/desktop/src-tauri` remains a separate native boundary.
- Put a test beside the implementation it exercises (`*.test.ts` or `*.test.tsx`) and use the test runner for that runtime. Do not introduce a second test framework or a frontend test setup in an unrelated directory without documenting the choice.
- When a change crosses a boundary, update the adapter and its contract at that boundary instead of reaching through it. For example, add a Chat Server endpoint in `apps/server`, its browser request wrapper in `apps/desktop/src/lib/chat-server.ts`, and the consuming query/mutation in the owning page or component.
