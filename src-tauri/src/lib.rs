mod commands;
mod models;
mod services;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let dashboard_item =
                MenuItem::with_id(app, "dashboard", "Dashboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&dashboard_item])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .icon(Image::new(include_bytes!("../icons/tray.rgba"), 32, 32))
                .on_menu_event(|app, event| {
                    if event.id.as_ref() != "dashboard" {
                        return;
                    }

                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        let _ = window.emit("tray-dashboard", ());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet::greet,
            commands::vite::list_vite_processes,
            commands::vite::kill_vite_process,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
