fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set");
    let target = std::env::var("TARGET").expect("TARGET is set");
    ensure_sidecar(&manifest_dir, "chat-server", &target);
    ensure_sidecar(&manifest_dir, "chat-server-sandbox", &target);
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        ensure_debug_resources(&manifest_dir);
    }
    tauri_build::build()
}

fn ensure_sidecar(manifest_dir: &str, name: &str, target: &str) {
    let sidecar_base = std::path::Path::new(manifest_dir)
        .join("binaries")
        .join(format!("{name}-{target}"));
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
    let resources_dir = std::path::Path::new(manifest_dir).join("resources");
    let browser_worker = resources_dir.join("browser-worker");
    if !browser_worker.exists() {
        std::fs::create_dir_all(&resources_dir).expect("create development resources directory");
        std::fs::write(browser_worker, b"development resource placeholder\n")
            .expect("write development browser worker placeholder");
    }

    let playwright_placeholder = resources_dir.join("playwright-browsers/placeholder.txt");
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
