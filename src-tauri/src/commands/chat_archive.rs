use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Manager};

const ARCHIVE_DIRECTORY: &str = "chat-archive";
const INDEX_FILE: &str = "index.json";
const MAX_TEXT_FILE_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedSession {
    pub source: String,
    pub external_id: String,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub source_path: String,
    pub updated_at: Option<String>,
    pub size: u64,
}

fn archive_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(ARCHIVE_DIRECTORY);
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
        return Err("invalid archive session id".to_string());
    }
    Ok(archive_path(app)?.join(session_id))
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "home directory is unavailable".to_string())
}

fn codex_root() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".codex"))
}

fn claude_root() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".claude"))
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let Ok(canonical_path) = path.canonicalize() else {
        return false;
    };
    let Ok(canonical_root) = root.canonicalize() else {
        return false;
    };
    canonical_path.starts_with(&canonical_root)
}

fn ensure_allowed_text_path(path: &Path) -> Result<(), String> {
    let roots = [codex_root()?, claude_root()?];
    if roots.iter().any(|root| path_is_within(path, root)) {
        return Ok(());
    }
    Err("path is outside allowed import roots".to_string())
}

fn system_time_to_rfc3339(time: SystemTime) -> Option<String> {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    Some(datetime.to_rfc3339())
}

fn file_updated_at(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(system_time_to_rfc3339)
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn is_uuid_like(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    let parts: Vec<&str> = normalized.split('-').collect();
    if parts.len() != 5 {
        return false;
    }
    let lengths = [8, 4, 4, 4, 12];
    parts.iter().zip(lengths).all(|(part, length)| {
        part.len() == length && part.chars().all(|character| character.is_ascii_hexdigit())
    })
}

fn extract_codex_session_id(file_name: &str) -> Option<String> {
    let stem = file_name.strip_suffix(".jsonl")?;
    let without_prefix = stem.strip_prefix("rollout-")?;
    let uuid = without_prefix.rsplit('-').take(5).collect::<Vec<_>>();
    if uuid.len() != 5 {
        return None;
    }
    let external_id = uuid.into_iter().rev().collect::<Vec<_>>().join("-");
    if is_uuid_like(&external_id) {
        Some(external_id)
    } else {
        None
    }
}

fn load_codex_index_titles(index_path: &Path) -> std::collections::HashMap<String, String> {
    let mut titles = std::collections::HashMap::new();
    let Ok(contents) = fs::read_to_string(index_path) else {
        return titles;
    };
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        let id = value
            .get("id")
            .and_then(|item| item.as_str())
            .unwrap_or_default();
        let title = value
            .get("thread_name")
            .and_then(|item| item.as_str())
            .unwrap_or_default();
        if !id.is_empty() && !title.is_empty() {
            titles.insert(id.to_string(), title.to_string());
        }
    }
    titles
}

fn walk_jsonl_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| error.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
            {
                files.push(path);
            }
        }
    }
    Ok(files)
}

fn peek_claude_meta(path: &Path) -> (Option<String>, Option<String>, Option<String>) {
    let Ok(contents) = fs::read_to_string(path) else {
        return (None, None, None);
    };
    let mut title = None;
    let mut cwd = None;
    let mut updated_at = None;
    for line in contents.lines().take(80) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        if cwd.is_none() {
            cwd = value
                .get("cwd")
                .and_then(|item| item.as_str())
                .map(str::to_string);
        }
        if let Some(timestamp) = value.get("timestamp").and_then(|item| item.as_str()) {
            updated_at = Some(timestamp.to_string());
        }
        if title.is_some() {
            continue;
        }
        if value.get("type").and_then(|item| item.as_str()) != Some("user") {
            continue;
        }
        if value
            .get("isSidechain")
            .and_then(|item| item.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        let message = value.get("message");
        let content = message.and_then(|item| item.get("content"));
        let text = match content {
            Some(serde_json::Value::String(value)) => Some(value.clone()),
            Some(serde_json::Value::Array(parts)) => {
                let mut chunks = Vec::new();
                for part in parts {
                    if part.get("type").and_then(|item| item.as_str()) == Some("text") {
                        if let Some(text) = part.get("text").and_then(|item| item.as_str()) {
                            chunks.push(text);
                        }
                    }
                }
                if chunks.is_empty() {
                    None
                } else {
                    Some(chunks.join(" "))
                }
            }
            _ => None,
        };
        if let Some(text) = text {
            let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
            if !compact.is_empty() {
                let truncated: String = compact.chars().take(40).collect();
                title = Some(if compact.chars().count() > 40 {
                    format!("{truncated}…")
                } else {
                    truncated
                });
            }
        }
    }
    (title, cwd, updated_at)
}

#[tauri::command]
pub fn read_chat_archive_index(app: AppHandle) -> Result<String, String> {
    let path = archive_path(&app)?.join(INDEX_FILE);
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok("[]".to_string()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn write_chat_archive_index(app: AppHandle, contents: String) -> Result<(), String> {
    let path = archive_path(&app)?.join(INDEX_FILE);
    atomic_write(&path, contents.as_bytes())
}

#[tauri::command]
pub fn read_chat_archive_session(
    app: AppHandle,
    session_id: String,
) -> Result<Option<String>, String> {
    let path = session_directory(&app, &session_id)?.join("session.json");
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn write_chat_archive_session(
    app: AppHandle,
    session_id: String,
    contents: String,
) -> Result<(), String> {
    let directory = session_directory(&app, &session_id)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    atomic_write(&directory.join("session.json"), contents.as_bytes())
}

#[tauri::command]
pub fn delete_chat_archive_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let directory = session_directory(&app, &session_id)?;
    match fs::remove_dir_all(directory) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    ensure_allowed_text_path(&path)?;
    let meta = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !meta.is_file() {
        return Err("path is not a file".to_string());
    }
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err("file is too large to import".to_string());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn path_exists(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(path).is_file())
}

#[tauri::command]
pub fn scan_codex_sessions() -> Result<Vec<ScannedSession>, String> {
    let root = codex_root()?;
    let sessions_root = root.join("sessions");
    let archived_root = root.join("archived_sessions");
    let titles = load_codex_index_titles(&root.join("session_index.jsonl"));
    let mut sessions = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for directory in [sessions_root, archived_root] {
        for path in walk_jsonl_files(&directory)? {
            let file_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            let Some(external_id) = extract_codex_session_id(file_name) else {
                continue;
            };
            if !seen.insert(external_id.clone()) {
                continue;
            }
            sessions.push(ScannedSession {
                source: "codex".to_string(),
                external_id: external_id.clone(),
                title: titles.get(&external_id).cloned(),
                cwd: None,
                source_path: path.to_string_lossy().to_string(),
                updated_at: file_updated_at(&path),
                size: file_size(&path),
            });
        }
    }

    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(sessions)
}

#[tauri::command]
pub fn scan_claude_sessions() -> Result<Vec<ScannedSession>, String> {
    let projects_root = claude_root()?.join("projects");
    if !projects_root.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    let project_entries = fs::read_dir(&projects_root).map_err(|error| error.to_string())?;
    for project_entry in project_entries {
        let project_entry = project_entry.map_err(|error| error.to_string())?;
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let file_entries = fs::read_dir(&project_path).map_err(|error| error.to_string())?;
        for file_entry in file_entries {
            let file_entry = file_entry.map_err(|error| error.to_string())?;
            let path = file_entry.path();
            if !path.is_file() {
                continue;
            }
            let stem = path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            let extension = path
                .extension()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if !extension.eq_ignore_ascii_case("jsonl") || !is_uuid_like(stem) {
                continue;
            }
            let (title, cwd, peeked_updated_at) = peek_claude_meta(&path);
            sessions.push(ScannedSession {
                source: "claude-code".to_string(),
                external_id: stem.to_string(),
                title,
                cwd,
                source_path: path.to_string_lossy().to_string(),
                updated_at: peeked_updated_at.or_else(|| file_updated_at(&path)),
                size: file_size(&path),
            });
        }
    }

    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(sessions)
}
