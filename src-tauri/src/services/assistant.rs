use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use chrono::Utc;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::models::assistant::{
    AssistantConnection, AssistantConversation, AssistantMessage, AssistantMessageEvent,
};

pub struct AssistantState {
    pub child: Mutex<Option<Child>>,
    pub stdin: Mutex<Option<ChildStdin>>,
    pub connection: Mutex<AssistantConnection>,
}

impl Default for AssistantState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            connection: Mutex::new(connection("unconfigured", None)),
        }
    }
}

pub fn connection(status: &str, detail: Option<String>) -> AssistantConnection {
    AssistantConnection {
        status: status.to_owned(),
        detail,
        updated_at: Utc::now().to_rfc3339(),
    }
}

pub fn status(app: &AppHandle) -> AssistantConnection {
    app.state::<AssistantState>()
        .connection
        .lock()
        .map(|value| value.clone())
        .unwrap_or_else(|_| connection("error", Some("assistant state is unavailable".to_owned())))
}

fn set_status(app: &AppHandle, next: AssistantConnection) {
    if let Ok(mut current) = app.state::<AssistantState>().connection.lock() {
        *current = next.clone();
    }
    let _ = app.emit("assistant-status", next);
}

fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("M_DASHBOARD_ASSISTANT_SIDECAR") {
        return Ok(PathBuf::from(path));
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let binary = if cfg!(target_arch = "aarch64") {
        "assistant-sidecar-aarch64-apple-darwin"
    } else {
        "assistant-sidecar-x86_64-apple-darwin"
    };
    let development_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(binary);
    if development_path.exists() {
        return Ok(development_path);
    }
    Ok(resource.join("binaries").join(binary))
}

pub fn start(
    app: &AppHandle,
    app_id: &str,
    app_secret: &str,
) -> Result<AssistantConnection, String> {
    if app_id.trim().is_empty() || app_secret.trim().is_empty() {
        let next = connection(
            "unconfigured",
            Some("请先配置飞书 App ID 和 App Secret".to_owned()),
        );
        set_status(app, next.clone());
        return Ok(next);
    }
    stop(app)?;
    set_status(app, connection("starting", None));
    let mut child = Command::new(sidecar_path(app)?)
        .env("FEISHU_APP_ID", app_id)
        .env("FEISHU_APP_SECRET", app_secret)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动助理 sidecar: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "sidecar stdin 不可用".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout 不可用".to_owned())?;
    if let Ok(mut current) = app.state::<AssistantState>().child.lock() {
        *current = Some(child);
    }
    if let Ok(mut current) = app.state::<AssistantState>().stdin.lock() {
        *current = Some(stdin);
    }
    let reader_app = app.clone();
    std::thread::spawn(move || read_events(reader_app, stdout));
    Ok(status(app))
}

pub fn stop(app: &AppHandle) -> Result<AssistantConnection, String> {
    if let Ok(mut stdin) = app.state::<AssistantState>().stdin.lock() {
        if let Some(writer) = stdin.as_mut() {
            let _ = writeln!(writer, "{}", json!({ "type": "stop" }));
            let _ = writer.flush();
        }
        *stdin = None;
    }
    if let Ok(mut child) = app.state::<AssistantState>().child.lock() {
        if let Some(mut process) = child.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
    let next = connection("stopped", None);
    set_status(app, next.clone());
    Ok(next)
}

pub fn send(app: &AppHandle, conversation_id: &str, text: &str) -> Result<(), String> {
    if conversation_id.trim().is_empty() || text.trim().is_empty() {
        return Err("会话和消息内容不能为空".to_owned());
    }
    let state = app.state::<AssistantState>();
    let mut stdin = state
        .stdin
        .lock()
        .map_err(|_| "assistant state is unavailable".to_owned())?;
    let writer = stdin.as_mut().ok_or_else(|| "助理尚未连接".to_owned())?;
    writeln!(
        writer,
        "{}",
        json!({ "type": "send_message", "conversationId": conversation_id, "text": text.trim() })
    )
    .map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

fn read_events(app: AppHandle, stdout: impl std::io::Read + Send + 'static) {
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let payload = line
            .strip_prefix("M_DASHBOARD_ASSISTANT_EVENT ")
            .or_else(|| line.trim_start().starts_with('{').then_some(line.as_str()));
        let Some(payload) = payload else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(payload) else {
            let _ = app.emit(
                "assistant-error",
                json!({ "message": "sidecar 返回了无效事件" }),
            );
            continue;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("ready") => set_status(&app, connection("connected", None)),
            Some("status") => {
                let value = event
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("error");
                set_status(
                    &app,
                    connection(
                        value,
                        event
                            .get("detail")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    ),
                );
            }
            Some("message") => {
                if let Ok(message_event) = serde_json::from_value::<AssistantMessageEvent>(
                    event.get("payload").cloned().unwrap_or_default(),
                ) {
                    let _ = persist_message(&app, &message_event);
                    let _ = app.emit("assistant-message", message_event);
                }
            }
            Some("error") => {
                let message = event
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("sidecar error")
                    .to_owned();
                set_status(&app, connection("error", Some(message.clone())));
                let _ = app.emit("assistant-error", json!({ "message": message }));
            }
            _ => {}
        }
    }
    set_status(
        &app,
        connection("stopped", Some("sidecar 已退出".to_owned())),
    );
}

fn assistant_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("assistant");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}
fn conversations_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(assistant_directory(app)?.join("conversations.json"))
}
fn messages_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(assistant_directory(app)?.join(format!("messages-{id}.json")))
}
fn atomic_write(path: &PathBuf, value: &Value) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

pub fn list_conversations(app: &AppHandle) -> Result<Vec<AssistantConversation>, String> {
    let data = fs::read_to_string(conversations_path(app)?).unwrap_or_else(|_| "[]".to_owned());
    Ok(serde_json::from_str(&data).unwrap_or_default())
}
pub fn messages(app: &AppHandle, id: &str) -> Result<Vec<AssistantMessage>, String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') {
        return Err("invalid conversation id".to_owned());
    }
    let data = fs::read_to_string(messages_path(app, id)?).unwrap_or_else(|_| "[]".to_owned());
    Ok(serde_json::from_str(&data).unwrap_or_default())
}

pub fn mark_conversation_read(app: &AppHandle, id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') {
        return Err("invalid conversation id".to_owned());
    }
    let path = conversations_path(app)?;
    let mut conversations = list_conversations(app)?;
    if let Some(conversation) = conversations.iter_mut().find(|item| item.id == id) {
        conversation.unread_count = 0;
    }
    atomic_write(
        &path,
        &serde_json::to_value(&conversations).map_err(|error| error.to_string())?,
    )
}

pub fn delete_conversation(app: &AppHandle, id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') {
        return Err("invalid conversation id".to_owned());
    }
    let path = conversations_path(app)?;
    let mut conversations = list_conversations(app)?;
    conversations.retain(|item| item.id != id);
    atomic_write(
        &path,
        &serde_json::to_value(&conversations).map_err(|error| error.to_string())?,
    )?;
    match fs::remove_file(messages_path(app, id)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
fn persist_message(app: &AppHandle, event: &AssistantMessageEvent) -> Result<(), String> {
    let mut items = messages(app, &event.message.conversation_id)?;
    if !items.iter().any(|item| item.id == event.message.id) {
        items.push(event.message.clone());
    }
    atomic_write(
        &messages_path(app, &event.message.conversation_id)?,
        &serde_json::to_value(&items).map_err(|error| error.to_string())?,
    )?;
    let mut conversations = list_conversations(app)?;
    conversations.retain(|item| item.id != event.conversation.id);
    conversations.push(event.conversation.clone());
    conversations.sort_by(|a, b| b.last_message_at.cmp(&a.last_message_at));
    atomic_write(
        &conversations_path(app)?,
        &serde_json::to_value(&conversations).map_err(|error| error.to_string())?,
    )
}

pub fn persist_outbound(app: &AppHandle, message: &AssistantMessage) -> Result<(), String> {
    let conversation = list_conversations(app)?
        .into_iter()
        .find(|item| item.id == message.conversation_id)
        .ok_or_else(|| "会话不存在".to_owned())?;
    persist_message(
        app,
        &AssistantMessageEvent {
            conversation: AssistantConversation {
                last_message: message.text.clone(),
                last_message_at: message.timestamp.clone(),
                unread_count: 0,
                ..conversation
            },
            message: message.clone(),
        },
    )
}
