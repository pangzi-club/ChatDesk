use crate::services::chat_server::{ChatServerInfo, ChatServerManager};
use tauri::State;

#[tauri::command]
pub fn chat_server_info(manager: State<'_, ChatServerManager>) -> ChatServerInfo {
    manager.info()
}
