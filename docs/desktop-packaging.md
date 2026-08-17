# Desktop Packaging

The desktop release packages the Node chat server and its sandbox worker as Tauri sidecars, and the browser worker as a resource. End users do not need Node.js or pnpm.

## Local build

Use Node.js 22 or newer, Rust, pnpm 11.19.0, and the platform's Tauri prerequisites.

```sh
pnpm install
pnpm desktop:build
```

To execute the packaged browser worker against a real Chromium instance after building sidecars:

```bash
pnpm desktop:sidecars:verify
```

## GitHub Actions

The `macOS packages` workflow builds native Intel (`x86_64-apple-darwin`) and
Apple Silicon (`aarch64-apple-darwin`) packages on separate macOS runners. It
runs for pushes to `release`, version tags, and manual workflow dispatches. Each
run uploads the DMG and `.app.tar.gz` artifacts for 14 days. A `v*` tag also
creates or updates a GitHub Release with those files. The workflow does not
sign or notarize packages; configure the repository's Apple and Tauri signing
secrets before distributing a release build.

To publish a version, update the app versions, push the commit, then create and
push a tag:

```sh
git tag v0.3.0
git push origin v0.3.0
```

The tag starts the two architecture builds. The release job runs only after
both builds finish successfully. Keep the tag version aligned with the
versions in `package.json`, `apps/desktop/package.json`,
`apps/desktop/src-tauri/tauri.conf.json`, and `apps/desktop/src-tauri/Cargo.toml`.

`pnpm desktop:sidecars` first bundles the TypeScript Chat Server and its sandbox worker into separate CommonJS files, then uses `@yao-pkg/pkg` with source fallback to create the target-specific binaries. Sharp is a native module, so the Chat Server never `import`s it into the bundle. The sidecar script copies the current platform's `sharp` / `@img/sharp-*` tree into `apps/desktop/src-tauri/resources/sharp-node-modules` and writes a dependency-free `apps/server/.cache/package.json` so pkg does not try to embed `sharp/build` or `sharp/vendor`. Tauri injects `CHAT_SERVER_SHARP_PATH` at spawn; the server loads Sharp with `createRequire` from that directory (or `apps/server` in development). The build verifies `require("sharp")` against the copied tree. It also downloads the Chromium headless shell into `apps/desktop/src-tauri/resources/playwright-browsers`.

The browser worker has a narrower packaging boundary. Esbuild produces one CommonJS file, inlines the Playwright package and browser-registry metadata that Chromium launch actually needs, and replaces optional BiDi and fsevents integrations that are outside the worker contract. `pkg --sea` then embeds that single file into a standard Node executable without walking Playwright's unrelated CLI and tooling code, so dynamic `require` calls in those unreachable paths do not produce misleading package warnings. Chromium remains a normal Tauri resource because browser executables must exist on the real filesystem. `pnpm desktop:sidecars:verify` is intentionally separate from packaging: it starts the packaged worker, performs `browser_open` against a loopback page, verifies page content, and closes the session. Release CI runs this smoke test after building the sidecars, while `pnpm desktop:build` remains a deterministic packaging command. The generated files are ignored by Git and must be rebuilt for every target platform. Each CI runner must install the matching Sharp optional native binary.

The pkg base-runtime cache defaults to `.cache/pkg`; set `PKG_CACHE_PATH` to share it between CI jobs. The browser worker SEA runtime is pinned to Node.js 22.20.0 and uses pkg's Node distribution cache under `~/.pkg-cache/sea`.

Supported target triples currently map to these `pkg` targets:

| Rust target | pkg target |
| --- | --- |
| `x86_64-apple-darwin` | `node22-macos-x64` |
| `aarch64-apple-darwin` | `node22-macos-arm64` |
| `x86_64-pc-windows-msvc` | `node22-win-x64` |
| `aarch64-pc-windows-msvc` | `node22-win-arm64` |
| `x86_64-unknown-linux-gnu` | `node22-linux-x64` |
| `aarch64-unknown-linux-gnu` | `node22-linux-arm64` |

Cross-platform artifacts should be built on native CI runners. Set `TAURI_TARGET_TRIPLE` only when the runner and the requested target are compatible.

## Runtime behavior

Tauri starts `chat-server` with a loopback host, a per-launch token, and a data directory under `~/.chatdesk/chat-server` on macOS. The frontend obtains the token through the `chat_server_info` command. Chat screenshots and other files under `~/.chatdesk` are shown with `convertFileSrc`; `assetProtocol.scope` must list `$HOME/.chatdesk/**` explicitly because Unix hidden directories are not matched by `$HOME/**`. The package also contains a separate `chat-server-sandbox` sidecar dedicated to Seatbelt file operations.

Browser tools use a separate worker process. In development (`pnpm dev` / `pnpm server:dev`), Chat Server is the TypeScript ESM process: `scripts/dev-all.mjs` sets `CHAT_SERVER_BROWSER_WORKER`, and `browser-runtime.ts` can also locate `apps/desktop/src-tauri/src/sidecar/browser-worker.mjs` from `import.meta.url` or the repo-relative cwd. If that path is missing and the env var is unset, `browser_open` fails immediately with a configuration error. First-time Chromium setup is `pnpm --filter chatdesk-desktop exec playwright install chromium --only-shell`.

In a packaged app, the Chat Server sidecar is esbuild CJS (`import.meta` is empty). Tauri injects `CHAT_SERVER_BROWSER_WORKER` from the `browser-worker` resource next to the Chat Server binary, plus `CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH` when `playwright-browsers` is present, and `CHAT_SERVER_SHARP_PATH` when `sharp-node-modules` is present. Missing the worker resource is a Chat Server startup error, not a later tool failure. Missing Sharp falls back to storing original image bytes. Windows `.exe` resource names are not handled yet. The end-user installation does not depend on Node.js, pnpm, or `node_modules`.

Window geometry is managed by `tauri-plugin-window-state` in the platform app configuration directory; this small UI preference is intentionally exempt from the `~/.chatdesk` data boundary.

Window geometry is managed by `tauri-plugin-window-state` in the platform app configuration directory; this small UI preference is intentionally exempt from the `~/.chatdesk` data boundary.

The server enforces token validation on every request except `/health` and CORS preflight (`OPTIONS`). The frontend obtains the per-launch token through the `chat_server_info` command and sends it as a `Bearer` Authorization header. The packaged app does not scan legacy directories at startup. Use `pnpm migrate chatdesk -- --apply` before launching the new app to migrate data from older layouts. See [data-migration.md](data-migration.md) for the full command list.

The app bundles only Chromium's headless shell. Updating Playwright requires rebuilding the browser resource and retesting the packaged browser tools.

This layout assumes direct DMG or website distribution without macOS App Sandbox. A future App Store build would need a container-backed data location.

## Signing

Release artifacts must be signed using the platform's normal Tauri signing flow. macOS builds require an Apple Developer signing identity and notarization for distribution; Windows builds require the chosen Authenticode certificate; Linux packages should be produced and tested on the target distribution family.
