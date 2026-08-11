use chrono::Utc;
use serde_json::Value;
use tauri::AppHandle;

use crate::services::user_data::{read_user_file, write_user_file};

#[tauri::command]
pub fn read_system_logs(app: AppHandle) -> Result<String, String> {
    Ok(read_user_file(&app, "system-logs.json")?.unwrap_or_else(|| "[]".to_string()))
}

#[tauri::command]
pub fn write_system_logs(app: AppHandle, contents: String) -> Result<(), String> {
    write_user_file(&app, "system-logs.json", &contents)
}

pub fn append_system_log(
    app: &AppHandle,
    level: &str,
    source: &str,
    message: &str,
) -> Result<(), String> {
    let mut logs: Vec<Value> = read_user_file(app, "system-logs.json")?
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default();
    logs.insert(
        0,
        serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "timestamp": Utc::now().to_rfc3339(),
            "level": level,
            "source": source,
            "message": message,
        }),
    );
    logs.truncate(200);
    write_user_file(
        app,
        "system-logs.json",
        &serde_json::to_string(&logs).map_err(|error| error.to_string())?,
    )
}
