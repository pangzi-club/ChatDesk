use std::fs;

use chrono::Utc;
use serde_json::Value;
use tauri::{AppHandle, Manager};

const SYSTEM_LOGS_FILE: &str = "system-logs.json";

fn system_logs_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(SYSTEM_LOGS_FILE))
}

#[tauri::command]
pub fn read_system_logs(app: AppHandle) -> Result<String, String> {
    let path = system_logs_path(&app)?;
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok("[]".to_string()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn write_system_logs(app: AppHandle, contents: String) -> Result<(), String> {
    let path = system_logs_path(&app)?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

pub fn append_system_log(
    app: &AppHandle,
    level: &str,
    source: &str,
    message: &str,
) -> Result<(), String> {
    let path = system_logs_path(app)?;
    let mut logs: Vec<Value> = fs::read_to_string(&path)
        .ok()
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
    fs::write(
        path,
        serde_json::to_string(&logs).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}
