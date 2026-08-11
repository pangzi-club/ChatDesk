fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set");
    let target = std::env::var("TARGET").expect("TARGET is set");
    let sidecar_base = std::path::Path::new(&manifest_dir)
        .join("binaries")
        .join(format!("chat-server-{target}"));
    let sidecar = if sidecar_base.exists() {
        sidecar_base
    } else if cfg!(windows) && sidecar_base.with_extension("exe").exists() {
        sidecar_base.with_extension("exe")
    } else {
        sidecar_base
    };
    if !sidecar.exists() {
        if std::env::var("PROFILE").as_deref() == Ok("debug") {
            std::fs::create_dir_all(sidecar.parent().expect("sidecar has a parent"))
                .expect("create sidecar directory");
            std::fs::write(&sidecar, b"development sidecar placeholder\n")
                .expect("write development sidecar placeholder");
        } else {
            panic!("missing {sidecar:?}; run `pnpm desktop:sidecars` before a release build");
        }
    }
    tauri_build::build()
}
