# Desktop Packaging

The desktop release ships one shared Node.js runtime with the Electron package. The Chat Server, sandbox worker, and browser worker are normal JavaScript resources executed by that runtime. End users do not need a system Node.js installation or pnpm.

## Local build

Use Node.js 22 and pnpm 11.19.0 for development. The sidecar/release build requires exactly Node.js 22.20.0.

```sh
pnpm install
pnpm desktop:build
```

`pnpm desktop:build` creates the Electron installer.

To execute the packaged browser worker against a real Chromium instance after building sidecars:

```bash
pnpm desktop:sidecars:verify
```

After a macOS application bundle has been built, verify the exact Node, worker, and Chromium resources inside the `.app`:

```bash
pnpm electron:package:verify
```

## GitHub Actions

The `macOS packages` workflow builds native Intel (`x86_64-apple-darwin`) and
Apple Silicon (`aarch64-apple-darwin`) packages on separate macOS runners. It
runs for pushes to `release`, version tags, and manual workflow dispatches. Each
run uploads the DMG and `.app.tar.gz` artifacts for 14 days. A `v*` tag also
creates or updates a GitHub Release with those files. The workflow does not
sign or notarize packages; configure the repository's Apple signing
secrets before distributing a release build.

To publish a version, update workspace package versions, push the commit, then
create and push a tag:

```sh
pnpm version:set 0.4.0
git tag v0.4.0
git push origin v0.4.0
```

`pnpm version:set` rewrites every workspace `package.json`.
The tag starts the two architecture builds (Intel x64 and Apple Silicon arm64). The release job runs only after both builds finish successfully. Keep the tag version aligned with the updated workspace packages.

`pnpm desktop:sidecars` requires Node.js 22.20.0. It copies the current Node executable to `apps/desktop/assets/binaries/node-runtime-<target-triple>`, bundles the TypeScript Chat Server and sandbox worker into CommonJS, and copies `packages/agent-core/workers/browser-worker.mjs` as an ordinary ES module. These scripts live under `apps/desktop/assets/resources/node-runtime/workers` and are all executed by the same Node binary. Builtin skills from `packages/agent-core/skills` are copied to `workers/skills` next to `chat-server.cjs`.

Playwright is not bundled into JavaScript or embedded in an executable. The build recursively copies the installed production package trees for Playwright and Sharp into `resources/node-runtime/node_modules`, including the native Sharp packages available for the current platform. This preserves Playwright's package metadata, browser registry, dynamic loads, and filesystem layout. Chromium Headless Shell remains under `resources/playwright-browsers` because browser executables must exist on the real filesystem.

The Node runtime is copied from the build host, so `DESKTOP_TARGET_TRIPLE` must match the host architecture. Cross-platform artifacts must be built on native CI runners. The build fails if Node is not exactly 22.20.0 or if a requested target does not match the host architecture.

The macOS workflow downloads the pinned, architecture-specific Cua Driver
archive below by default. Configure the following repository variables (or
same-named secrets for a private mirror) only when overriding that release:

```text
CUA_DRIVER_URL_MACOS_ARM64=https://artifacts.example.com/cua-driver-darwin-arm64.tar.gz
CUA_DRIVER_SHA256_MACOS_ARM64=<64-character SHA-256 digest of the tar.gz>
```

For the pinned Cua Driver release, the URL is
`https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.24.0/cua-driver-rs-0.24.0-darwin-arm64.tar.gz`
and the SHA-256 is
`fd0cf565db831ad34d44a3c2321439575e02a6ce3ca97d04f267db1da7883685`.
`scripts/cua-driver.mjs` holds the same pinned version and per-platform
digests; update both together when the driver release moves.
The workflow verifies the archive, extracts the top-level `cua-driver`, sets
its executable bit, and passes it to `desktop:sidecars`; the package check then
confirms it exists at `Contents/Resources/binaries/cua-driver`. The archive
must already be signed for macOS before it is downloaded. Supplying only one
override value fails the build.

`pnpm desktop:sidecars:verify` is intentionally separate from packaging. It verifies the staged Node version, loads Playwright and Sharp from the staged runtime, then performs `browser_open`, page evaluation, and close against a loopback page. Release CI repeats the same verification against the final Electron `.app` with `pnpm electron:package:verify`.

## Runtime behavior

Electron starts `chat-server` with a loopback host, a per-launch token, and a data directory under `~/.chatdesk/chat-server` on macOS. The frontend obtains the token through the desktop bridge. Chat screenshots and other files under `~/.chatdesk` are shown with a restricted custom protocol. The package also contains a separate `chat-server-sandbox` worker dedicated to Seatbelt file operations.

Browser tools use a separate worker process. Electron development (`pnpm dev`) uses the shared staged Chat Server worker, with source fallback to `packages/agent-core/workers/browser-worker.mjs`. If the staged worker is missing, run `pnpm desktop:sidecars` once. First-time Chromium setup is included by that sidecar build.

In a packaged app, Electron starts `node-runtime` with `chat-server.cjs`. It injects `CHAT_SERVER_BROWSER_WORKER` and `CHAT_SERVER_SANDBOX_WORKER` as JavaScript paths, `CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH` as the Chromium resource directory, and `CHAT_SERVER_SHARP_PATH` as the shared runtime root. The Chat Server starts both workers with its own `process.execPath`, so all three processes use the same Node binary. Missing runtime or worker resources are startup errors rather than delayed tool failures.

Window geometry is stored in Electron `userData` as `window-state.json`; this small UI preference is intentionally exempt from the `~/.chatdesk` data boundary.

The server enforces token validation on every request except `/health` and CORS preflight (`OPTIONS`). The frontend obtains the per-launch token through the desktop bridge and sends it as a `Bearer` Authorization header. The packaged app does not scan legacy directories at startup. Use `pnpm migrate chatdesk -- --apply` before launching the new app to migrate data from older layouts. See [data-migration.md](data-migration.md) for the full command list.

The app bundles only Chromium's headless shell. Updating Playwright requires rebuilding the browser resource and retesting the packaged browser tools.

## Computer Use

Computer Use is an optional macOS capability. The Electron main process owns the
embedded Cua Driver host and passes its generated MCP stdio configuration to the
Chat Server. The npm SDK does not contain the `cua-driver` executable.

For local development, install Cua Driver and grant ChatDesk access under
System Settings > Privacy & Security > Accessibility and Screen Recording. The
settings page reports the two grants separately and opens these panes when
requested. A custom executable can be selected with `CHATDESK_CUA_DRIVER`.

`pnpm dev` prepares the driver before it starts Electron and passes the result
as `CHATDESK_CUA_DRIVER`. It resolves, in order: the `CHATDESK_CUA_DRIVER` /
`CUA_DRIVER_BINARY` environment, the binary staged at
`apps/desktop/assets/binaries/cua-driver`, `/Applications/CuaDriver.app`,
`~/.local/bin/cua-driver`, and `PATH`. When none of them exists it downloads the
pinned release into that staged path and verifies the archive against the
SHA-256 in `scripts/cua-driver.mjs`; set `CHATDESK_CUA_DRIVER_FETCH=0` to skip
the download and leave Computer Use unavailable. A missing driver only disables
Computer Use — it never fails `pnpm dev` or a package build.

For a packaged build, stage the signed executable while building sidecars:

```sh
CHATDESK_CUA_DRIVER=/path/to/cua-driver pnpm desktop:build
```

Packaging resolves the driver exactly like development, but does not download
it unless `CHATDESK_CUA_DRIVER_FETCH=1` is set, so release builds stay
reproducible and use the artifact CI prepared. The sidecar script copies it to
the app's `Resources/binaries` directory and preserves its executable bit. Sign
and notarize the driver before signing the enclosing Electron application.
Builds without a staged binary remain valid but show Computer Use as
unavailable until a compatible driver is installed.

Electron native modules, including ONNX Runtime and Sharp, are unpacked from asar so their `.node` binaries can be loaded by the Electron main process. Each macOS artifact must be built on a runner matching its target architecture; do not cross-build the native runtime from Rosetta.

This layout assumes direct DMG or website distribution without macOS App Sandbox. A future App Store build would need a container-backed data location.

## Signing

Release artifacts must be signed using the platform's normal Electron signing flow. macOS builds require an Apple Developer signing identity and notarization for distribution; Windows builds require the chosen Authenticode certificate; Linux packages should be produced and tested on the target distribution family.
