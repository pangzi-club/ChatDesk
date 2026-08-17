fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set");
    let target = std::env::var("TARGET").expect("TARGET is set");
    ensure_node_runtime(&manifest_dir, &target);
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        ensure_debug_resources(&manifest_dir);
    } else {
        ensure_release_resources(&manifest_dir);
    }
    tauri_build::build()
}

fn ensure_node_runtime(manifest_dir: &str, target: &str) {
    let sidecar_base = std::path::Path::new(manifest_dir)
        .join("binaries")
        .join(format!("node-runtime-{target}"));
    let sidecar = if sidecar_base.exists() {
        sidecar_base
    } else if cfg!(windows) && sidecar_base.with_extension("exe").exists() {
        sidecar_base.with_extension("exe")
    } else {
        sidecar_base
    };
    if sidecar.exists() {
        return;
    }

    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        std::fs::create_dir_all(sidecar.parent().expect("sidecar has a parent"))
            .expect("create sidecar directory");
        std::fs::write(&sidecar, b"development sidecar placeholder\n")
            .expect("write development sidecar placeholder");
    } else {
        panic!("missing {sidecar:?}; run `pnpm desktop:sidecars` before a release build");
    }
}

fn ensure_debug_resources(manifest_dir: &str) {
    let resources_dir = std::path::Path::new(manifest_dir).join("resources/node-runtime");
    for worker in [
        "workers/chat-server.cjs",
        "workers/chat-server-sandbox.cjs",
        "workers/browser-worker.mjs",
    ] {
        let worker = resources_dir.join(worker);
        if worker.exists() {
            continue;
        }
        std::fs::create_dir_all(worker.parent().expect("worker has a parent"))
            .expect("create development worker directory");
        std::fs::write(worker, b"development resource placeholder\n")
            .expect("write development worker placeholder");
    }

    let package_json = resources_dir.join("package.json");
    if !package_json.exists() {
        std::fs::write(package_json, b"{\"private\":true,\"type\":\"module\"}\n")
            .expect("write development runtime package");
    }

    let playwright_placeholder =
        std::path::Path::new(manifest_dir).join("resources/playwright-browsers/placeholder.txt");
    if !playwright_placeholder.exists() {
        std::fs::create_dir_all(
            playwright_placeholder
                .parent()
                .expect("placeholder has a parent"),
        )
        .expect("create development Playwright resources directory");
        std::fs::write(
            playwright_placeholder,
            b"development resource placeholder\n",
        )
        .expect("write development Playwright resource placeholder");
    }
}

fn ensure_release_resources(manifest_dir: &str) {
    let runtime_dir = std::path::Path::new(manifest_dir).join("resources/node-runtime");
    for relative in [
        "package.json",
        "workers/chat-server.cjs",
        "workers/chat-server-sandbox.cjs",
        "workers/browser-worker.mjs",
        "node_modules/playwright/package.json",
        "node_modules/playwright-core/package.json",
        "node_modules/sharp/package.json",
    ] {
        let path = runtime_dir.join(relative);
        if !path.is_file() {
            panic!("missing {path:?}; run `pnpm desktop:sidecars` before a release build");
        }
    }
}
