mod commands;
mod models;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            commands::greet::greet,
            commands::vite::list_vite_processes,
            commands::vite::kill_vite_process,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
