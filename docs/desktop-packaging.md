# Desktop Packaging

The desktop release packages the Node chat server and its sandbox worker as Tauri sidecars, and the browser worker as a resource. End users do not need Node.js or pnpm.

## Local build

Use Node.js 22 or newer, Rust, pnpm 11.19.0, and the platform's Tauri prerequisites.

```sh
pnpm install
pnpm desktop:build
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

`pnpm desktop:sidecars` first bundles the TypeScript Chat Server and its sandbox worker into separate CommonJS files, then uses `@yao-pkg/pkg` with source fallback to create the target-specific binaries. It also downloads the Chromium headless shell into `apps/desktop/src-tauri/resources/playwright-browsers`. The generated files are ignored by Git and must be rebuilt for every target platform.

The pkg base-runtime cache defaults to `.cache/pkg`; set `PKG_CACHE_PATH` to share it between CI jobs.

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

Tauri starts `chat-server` with a loopback host, a per-launch token, and a data directory under `~/.chatdesk/chat-server` on macOS. The frontend obtains the token through the `chat_server_info` command. The package also contains a separate `chat-server-sandbox` sidecar dedicated to Seatbelt file operations. Development launches the TypeScript worker directly; production resolves the packaged worker beside the Chat Server binary, so the end-user installation does not depend on Node.js, pnpm, or `node_modules`.

Window geometry is managed by `tauri-plugin-window-state` in the platform app configuration directory; this small UI preference is intentionally exempt from the `~/.chatdesk` data boundary.

The server still receives a per-launch token and the frontend still passes it through for a future authentication layer, but the local API currently does not enforce token validation. The packaged app does not scan legacy directories at startup. Use `pnpm migrate:chatdesk -- --apply` before launching the new app to migrate data from older layouts.

The app bundles only Chromium's headless shell. Updating Playwright requires rebuilding the browser resource and retesting the packaged browser tools.

This layout assumes direct DMG or website distribution without macOS App Sandbox. A future App Store build would need a container-backed data location.

## Signing

Release artifacts must be signed using the platform's normal Tauri signing flow. macOS builds require an Apple Developer signing identity and notarization for distribution; Windows builds require the chosen Authenticode certificate; Linux packages should be produced and tested on the target distribution family.
