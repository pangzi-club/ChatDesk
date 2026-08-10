# Repository Guidelines

These instructions apply to the entire repository.

## Package Manager

- Use the pnpm version declared in `package.json` (`pnpm@9.15.9`).
- Prefer Corepack to activate the pinned version when necessary: `corepack prepare pnpm@9.15.9 --activate`.
- Use `pnpm` for installing dependencies and running scripts. Do not use npm or Yarn, and do not create their lockfiles.

## Required Final Step

- After completing every task, run `pnpm format` before reporting the result.
- Review the formatting changes and include all task-related formatted files in the final result.
- Run any additional checks appropriate to the change, such as `pnpm check` or `pnpm build`, after formatting.

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

## Code Placement

Put new code in the narrowest directory that matches its runtime and responsibility. Do not add application runtime code to the repository root or duplicate the same behavior across runtimes.

### Browser Application (`src`)

- `src/pages/`: route-level screens and page-specific composition. A page may keep small private render helpers, but move reusable feature UI into `src/components/`.
- `src/components/`: reusable product components and feature interactions, such as chat dialogs, pickers, settings panels, and import flows. Components should receive data and callbacks rather than owning unrelated route or storage logic.
- `src/components/ui/`: shared shadcn/Radix-style primitives only (`Button`, `Dialog`, `AlertDialog`, form controls, and similar). Keep product-specific behavior out of this directory; extend a primitive here only when the primitive itself needs a reusable capability.
- `src/layouts/`: shared application chrome and nested route layouts, such as the app shell, navigation, titlebar, and outlet composition. Do not put a one-page screen here.
- `src/router/`: route declarations, redirects, route-level layout wiring, and URL parameter mapping only. Keep data fetching and page UI in the page or library that owns it.
- `src/lib/`: browser-side domain logic, API clients, persistence adapters, query helpers, parsers, and integrations. Keep this directory free of JSX; wrappers for Chat Server requests and Tauri `invoke` calls belong here so pages and components do not call platform APIs directly.
- `src/lib/importers/`: browser-side parsers for imported archive formats. Add a new source-specific importer here and keep the shared archive orchestration in `src/lib/chat-archive.ts`.
- `src/shared/`: runtime-neutral TypeScript contracts, constants, and algorithms imported by both the browser and `src-web`. Do not import React, DOM, Node.js, Tauri, or filesystem APIs from this directory.
- `src/assets/`: assets imported by Vite from TypeScript/CSS. Put files that must be served at a stable public URL in `public/` instead.
- `src/App.tsx` and `src/main.tsx`: application bootstrap, providers, and startup initialization only. `src/App.css` is for global application styles; keep component/page styles close to their owning UI when the existing styling approach permits it.

For browser code, use this decision order: JSX that defines a URL screen belongs in `src/pages/`; reusable JSX belongs in `src/components/`; browser-only non-visual behavior belongs in `src/lib/`; code needed by both browser and server belongs in `src/shared/`.

### Local Node Service (`src-web`)

- `src-web/src/server.ts`: Node process entrypoint, environment setup, and HTTP server startup.
- `src-web/src/app.ts`: Hono app assembly, middleware, authentication, and route registration. Keep substantial route/domain logic in dedicated modules.
- `src-web/src/*.ts`: server-side domain modules, stores, runtimes, providers, protocol helpers, and tools. Use a focused module for each responsibility (for example, persistence in `*-store.ts` and execution coordination in `run-registry.ts`).
- `src-web/src/*.test.ts`: Node tests colocated with the service source. Keep tests in `src-web` when they exercise HTTP handlers, server persistence, providers, sandboxing, or other Node-only behavior.

The Node service may import runtime-neutral code from `src/shared/`, but must not import React components, browser pages, `src/lib/` browser adapters, or Tauri code. Browser callers should reach this service through the client boundary in `src/lib/chat-server.ts`.

### Native Desktop Layer (`src-tauri`)

- `src-tauri/src/main.rs` and `src-tauri/src/lib.rs`: Tauri startup, plugin setup, command registration, and application-wide wiring.
- `src-tauri/src/commands/`: thin Tauri command handlers. Validate/deserialize command inputs, call a service, and return serializable results; keep filesystem, process, Git, and other business logic out of command handlers.
- `src-tauri/src/services/`: native capabilities and side effects, including filesystem/workspace access, processes, Git, automation, sandboxing, and chat-server lifecycle management.
- `src-tauri/src/models/`: Rust data structures shared by commands and services, especially `serde` request/response models. Keep transport models separate from service implementation details.
- `src-tauri/capabilities/`: Tauri permission and capability declarations. Update these when adding or changing native commands or plugins.
- `src-tauri/sidecar/`: source for JavaScript sidecar workers. Generated sidecars and build output are not hand-edited.

Frontend code should call native functionality through a small adapter in `src/lib/` (using Tauri APIs there), not by placing `invoke` calls throughout pages or components. Native code must not depend on browser UI code.

### Tooling, Documentation, and Generated Files

- `scripts/`: repository build, development orchestration, packaging, and other developer tooling. Keep these scripts independent from page rendering.
- `docs/`: architecture notes, operational guidance, and decisions. Update the relevant document when a change alters a documented boundary or workflow.
- Root configuration files (`package.json`, `tsconfig*.json`, `vite.config.ts`, `biome.json`, and similar): project-wide tooling/configuration only. Do not put feature implementation here.
- `.data/`, `.cache/`, `dist/`, `src-tauri/target/`, and generated sidecar/binary output: local or generated artifacts. Do not add application source code or secrets to these paths, and do not edit generated output by hand.

### Dependencies and Tests

- Keep the dependency direction explicit: pages/layouts/components may use `src/lib/`, `src/shared/`, and `src/components/ui/`; `src/lib/` may use `src/shared/`; `src/shared/` stays platform-neutral; `src-web` may use only `src/shared/` across runtimes; `src-tauri` remains a separate native boundary.
- Put a test beside the implementation it exercises (`*.test.ts` or `*.test.tsx`) and use the test runner for that runtime. Do not introduce a second test framework or a frontend test setup in an unrelated directory without documenting the choice.
- When a change crosses a boundary, update the adapter and its contract at that boundary instead of reaching through it. For example, add a Chat Server endpoint in `src-web`, its browser request wrapper in `src/lib/chat-server.ts`, and the consuming query/mutation in the owning page or component.
