# Desktop Packaging

The desktop release ships one shared Node.js runtime with the Electron package; the same staged runtime remains usable by the Tauri fallback. The Chat Server, sandbox worker, and browser worker are normal JavaScript resources executed by that runtime. End users do not need a system Node.js installation or pnpm.

## Local build

Use Node.js 22 or newer and pnpm 11.19.0. Tauri fallback builds additionally require Rust and the platform's Tauri prerequisites.

```sh
pnpm install
pnpm desktop:build
```

`pnpm desktop:build` creates the Electron installer. The legacy Tauri fallback is built with `pnpm tauri:build`.

To execute the packaged browser worker against a real Chromium instance after building sidecars:

```bash
pnpm desktop:sidecars:verify
```

After a macOS application bundle has been built, verify the exact Node, worker, and Chromium resources inside the `.app`:

```bash
pnpm tauri:package:verify
```

## GitHub Actions

The `macOS packages` workflow builds native Intel (`x86_64-apple-darwin`) and
Apple Silicon (`aarch64-apple-darwin`) packages on separate macOS runners. It
runs for pushes to `release`, version tags, and manual workflow dispatches. Each
run uploads the DMG and `.app.tar.gz` artifacts for 14 days. A `v*` tag also
creates or updates a GitHub Release with those files. The workflow does not
sign or notarize packages; configure the repository's Apple and Tauri signing
secrets before distributing a release build.

To publish a version, update workspace package versions, push the commit, then
create and push a tag:

```sh
pnpm version:set -- 0.4.0
git tag v0.4.0
git push origin v0.4.0
```

`pnpm version:set` rewrites every workspace `package.json` except `apps/tauri`.
The tag starts the two architecture builds. The release job runs only after
both builds finish successfully. Keep the tag version aligned with the updated
workspace packages.

`pnpm desktop:sidecars` requires Node.js 22.20.0. It copies the current Node executable to `apps/desktop/assets/binaries/node-runtime-<target-triple>`, bundles the TypeScript Chat Server and sandbox worker into CommonJS, and copies the browser worker as an ordinary ES module. These scripts live under `apps/desktop/assets/resources/node-runtime/workers` and are all executed by the same Node binary. Builtin skills from `apps/server/skills` are copied to `workers/skills` next to `chat-server.cjs`.

Playwright is not bundled into JavaScript or embedded in an executable. The build recursively copies the installed production package trees for Playwright and Sharp into `resources/node-runtime/node_modules`, including the native Sharp packages available for the current platform. This preserves Playwright's package metadata, browser registry, dynamic loads, and filesystem layout. Chromium Headless Shell remains under `resources/playwright-browsers` because browser executables must exist on the real filesystem.

The Node runtime is copied from the build host, so `DESKTOP_TARGET_TRIPLE` must match the host architecture. Cross-platform artifacts must be built on native CI runners. The build fails if Node is not exactly 22.20.0 or if a requested target does not match the host architecture.

`pnpm desktop:sidecars:verify` is intentionally separate from packaging. It verifies the staged Node version, loads Playwright and Sharp from the staged runtime, then performs `browser_open`, page evaluation, and close against a loopback page. Release CI repeats the same verification against the final Electron `.app` with `pnpm electron:package:verify`.

## Runtime behavior

Tauri starts `chat-server` with a loopback host, a per-launch token, and a data directory under `~/.chatdesk/chat-server` on macOS. The frontend obtains the token through the `chat_server_info` command. Chat screenshots and other files under `~/.chatdesk` are shown with `convertFileSrc`; `assetProtocol.scope` must list `$HOME/.chatdesk/**` explicitly because Unix hidden directories are not matched by `$HOME/**`. The package also contains a separate `chat-server-sandbox` sidecar dedicated to Seatbelt file operations.

Browser tools use a separate worker process. Electron development (`pnpm dev`) uses the shared staged Chat Server worker; the Tauri fallback (`pnpm tauri:dev`) uses the TypeScript ESM process and `scripts/dev-all.mjs` sets `CHAT_SERVER_BROWSER_WORKER`. If the staged worker is missing, run `pnpm desktop:sidecars` once. First-time Chromium setup is included by that sidecar build.

In a packaged app, Tauri starts `node-runtime` with `chat-server.cjs`. It injects `CHAT_SERVER_BROWSER_WORKER` and `CHAT_SERVER_SANDBOX_WORKER` as JavaScript paths, `CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH` as the Chromium resource directory, and `CHAT_SERVER_SHARP_PATH` as the shared runtime root. The Chat Server starts both workers with its own `process.execPath`, so all three processes use the same Node binary. Missing runtime or worker resources are startup errors rather than delayed tool failures.

Window geometry is managed by `tauri-plugin-window-state` in the platform app configuration directory; this small UI preference is intentionally exempt from the `~/.chatdesk` data boundary.

Window geometry is managed by `tauri-plugin-window-state` in the platform app configuration directory; this small UI preference is intentionally exempt from the `~/.chatdesk` data boundary.

The server enforces token validation on every request except `/health` and CORS preflight (`OPTIONS`). The frontend obtains the per-launch token through the `chat_server_info` command and sends it as a `Bearer` Authorization header. The packaged app does not scan legacy directories at startup. Use `pnpm migrate chatdesk -- --apply` before launching the new app to migrate data from older layouts. See [data-migration.md](data-migration.md) for the full command list.

The app bundles only Chromium's headless shell. Updating Playwright requires rebuilding the browser resource and retesting the packaged browser tools.

This layout assumes direct DMG or website distribution without macOS App Sandbox. A future App Store build would need a container-backed data location.

## Signing

Release artifacts must be signed using the platform's normal Tauri signing flow. macOS builds require an Apple Developer signing identity and notarization for distribution; Windows builds require the chosen Authenticode certificate; Linux packages should be produced and tested on the target distribution family.
