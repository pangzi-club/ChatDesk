// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            // 透明窗口：macOS 下需显式把 WebView 背景设为全透明，
            // 否则 WKWebView 默认不透明，圆角外会有一块纯色。
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
