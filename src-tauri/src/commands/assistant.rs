use crate::models::assistant::{AssistantConnection, AssistantConversation, AssistantMessage};
use crate::services::assistant;
use tauri::AppHandle;

#[tauri::command]
pub fn assistant_start(
    app: AppHandle,
    app_id: String,
    app_secret: String,
) -> Result<AssistantConnection, String> {
    assistant::start(&app, &app_id, &app_secret)
}
#[tauri::command]
pub fn assistant_stop(app: AppHandle) -> Result<AssistantConnection, String> {
    assistant::stop(&app)
}
#[tauri::command]
pub fn assistant_restart(
    app: AppHandle,
    app_id: String,
    app_secret: String,
) -> Result<AssistantConnection, String> {
    assistant::start(&app, &app_id, &app_secret)
}
#[tauri::command]
pub fn assistant_status(app: AppHandle) -> Result<AssistantConnection, String> {
    Ok(assistant::status(&app))
}
#[tauri::command]
pub fn assistant_list_conversations(app: AppHandle) -> Result<Vec<AssistantConversation>, String> {
    assistant::list_conversations(&app)
}
#[tauri::command]
pub fn assistant_get_messages(
    app: AppHandle,
    conversation_id: String,
) -> Result<Vec<AssistantMessage>, String> {
    assistant::messages(&app, &conversation_id)
}
#[tauri::command]
pub fn assistant_mark_conversation_read(
    app: AppHandle,
    conversation_id: String,
) -> Result<(), String> {
    assistant::mark_conversation_read(&app, &conversation_id)
}
#[tauri::command]
pub fn assistant_delete_conversation(
    app: AppHandle,
    conversation_id: String,
) -> Result<(), String> {
    assistant::delete_conversation(&app, &conversation_id)
}
#[tauri::command]
pub fn assistant_send_message(
    app: AppHandle,
    conversation_id: String,
    text: String,
) -> Result<AssistantMessage, String> {
    assistant::send(&app, &conversation_id, &text)?;
    let message = AssistantMessage {
        id: uuid::Uuid::new_v4().to_string(),
        conversation_id,
        open_id: String::new(),
        direction: "outbound".to_owned(),
        text,
        timestamp: chrono::Utc::now().to_rfc3339(),
        status: Some("sent".to_owned()),
    };
    assistant::persist_outbound(&app, &message)?;
    Ok(message)
}
