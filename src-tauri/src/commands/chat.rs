use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const CHAT_DIRECTORY: &str = "chat";
const INDEX_FILE: &str = "index.json";

fn chat_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(CHAT_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn session_directory(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    if !valid_id(session_id) {
        return Err("invalid chat session id".to_string());
    }
    Ok(chat_path(app)?.join(session_id))
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_chat_index(app: AppHandle) -> Result<String, String> {
    let path = chat_path(&app)?.join(INDEX_FILE);
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok("[]".to_string()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn write_chat_index(app: AppHandle, contents: String) -> Result<(), String> {
    let path = chat_path(&app)?.join(INDEX_FILE);
    atomic_write(&path, contents.as_bytes())
}

#[tauri::command]
pub fn read_chat_session(app: AppHandle, session_id: String) -> Result<Option<String>, String> {
    let path = session_directory(&app, &session_id)?.join("session.json");
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn write_chat_session(
    app: AppHandle,
    session_id: String,
    contents: String,
) -> Result<(), String> {
    let directory = session_directory(&app, &session_id)?;
    fs::create_dir_all(directory.join("attachments")).map_err(|error| error.to_string())?;
    atomic_write(&directory.join("session.json"), contents.as_bytes())
}

#[tauri::command]
pub fn write_chat_attachment(
    app: AppHandle,
    session_id: String,
    attachment_id: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if !valid_id(&attachment_id) {
        return Err("invalid chat attachment id".to_string());
    }
    let safe_file_name = Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "invalid chat attachment file name".to_string())?;
    let directory = session_directory(&app, &session_id)?.join("attachments");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("{attachment_id}-{safe_file_name}"));
    atomic_write(&path, &bytes)
}

#[tauri::command]
pub fn delete_chat_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let directory = session_directory(&app, &session_id)?;
    match fs::remove_dir_all(directory) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
