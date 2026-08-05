mod commands;
mod models;
mod services;

use services::assistant::AssistantState;
use services::automation::AutomationScheduler;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
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
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let scheduler = AutomationScheduler::start(app.handle())?;
            app.manage(scheduler);
            app.manage(AssistantState::default());
            let dashboard_item =
                MenuItem::with_id(app, "dashboard", "Dashboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&dashboard_item])?;

            TrayIconBuilder::with_id("main-tray")
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
            commands::assistant::assistant_start,
            commands::assistant::assistant_stop,
            commands::assistant::assistant_restart,
            commands::assistant::assistant_status,
            commands::assistant::assistant_list_conversations,
            commands::assistant::assistant_get_messages,
            commands::assistant::assistant_mark_conversation_read,
            commands::assistant::assistant_delete_conversation,
            commands::assistant::assistant_send_message,
            commands::greet::greet,
            commands::image::save_image_file,
            commands::system_log::read_system_logs,
            commands::system_log::write_system_logs,
            commands::vite::list_vite_processes,
            commands::vite::kill_vite_process,
            set_tray_enabled,
            commands::automation::sync_automation_tasks,
            commands::chat::read_chat_index,
            commands::chat::write_chat_index,
            commands::chat::read_chat_session,
            commands::chat::write_chat_session,
            commands::chat::write_chat_attachment,
            commands::chat::delete_chat_session,
            commands::workspaces::select_workspace_directory,
            commands::workspaces::inspect_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
