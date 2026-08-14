mod commands;
mod models;
mod services;

use services::automation::AutomationScheduler;
use services::chat_server::ChatServerManager;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, RunEvent,
};

#[tauri::command]
fn set_tray_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let tray = app
        .tray_by_id("main-tray")
        .ok_or_else(|| "main tray is not available".to_string())?;
    tray.set_visible(enabled).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let scheduler = AutomationScheduler::start(app.handle())?;
            app.manage(scheduler);
            let chat_server = if cfg!(debug_assertions) {
                eprintln!("Chat Server is managed by pnpm dev in development");
                ChatServerManager::external(app.handle())
            } else {
                ChatServerManager::start(app.handle())
            };
            app.manage(chat_server);
            let dashboard_item =
                MenuItem::with_id(app, "dashboard", "Dashboard", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&dashboard_item, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .icon(Image::new(include_bytes!("../icons/tray.rgba"), 32, 32))
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "dashboard" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.emit("tray-dashboard", ());
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet::greet,
            commands::image::save_image_file,
            commands::system_log::read_system_logs,
            commands::system_log::write_system_logs,
            services::user_data::read_user_store,
            services::user_data::write_user_store,
            commands::vite::list_vite_processes,
            commands::vite::kill_vite_process,
            commands::sandbox::get_sandbox_info,
            commands::sandbox::run_shell_command,
            commands::sandbox::workspace_list_dir,
            commands::sandbox::workspace_read_file,
            commands::sandbox::workspace_write_file,
            commands::sandbox::workspace_edit_file,
            commands::sandbox::workspace_search_files,
            set_tray_enabled,
            commands::automation::sync_automation_tasks,
            commands::chat_server::chat_server_info,
            commands::chat_server::chat_server_restart,
            commands::workspaces::select_workspace_directory,
            commands::workspaces::inspect_workspace,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                if let Err(error) = app.state::<ChatServerManager>().shutdown() {
                    eprintln!("关闭 Chat Server 失败：{error}");
                }
            }
            _ => {}
        });
}
