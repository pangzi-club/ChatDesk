use crate::services::browser::{BrowserManager, BrowserResponse};
use serde_json::{json, Value};
use tauri::State;

fn request(
    manager: State<'_, BrowserManager>,
    method: &str,
    params: Value,
) -> Result<BrowserResponse, String> {
    manager.request(method, params)
}

#[tauri::command]
pub fn browser_open(
    manager: State<'_, BrowserManager>,
    url: String,
    session_id: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<BrowserResponse, String> {
    request(
        manager,
        "open",
        json!({ "url": url, "sessionId": session_id, "timeoutMs": timeout_ms }),
    )
}

#[tauri::command]
pub fn browser_screenshot(
    manager: State<'_, BrowserManager>,
    session_id: String,
    full_page: Option<bool>,
) -> Result<BrowserResponse, String> {
    request(
        manager,
        "screenshot",
        json!({ "sessionId": session_id, "fullPage": full_page.unwrap_or(false) }),
    )
}

#[tauri::command]
pub fn browser_click(
    manager: State<'_, BrowserManager>,
    session_id: String,
    selector: String,
    button: Option<String>,
    click_count: Option<u8>,
    timeout_ms: Option<u64>,
) -> Result<BrowserResponse, String> {
    request(
        manager,
        "click",
        json!({ "sessionId": session_id, "selector": selector, "button": button, "clickCount": click_count, "timeoutMs": timeout_ms }),
    )
}

#[tauri::command]
pub fn browser_eval(
    manager: State<'_, BrowserManager>,
    session_id: String,
    expression: String,
    timeout_ms: Option<u64>,
) -> Result<BrowserResponse, String> {
    request(
        manager,
        "eval",
        json!({ "sessionId": session_id, "expression": expression, "timeoutMs": timeout_ms }),
    )
}

#[tauri::command]
pub fn browser_close(
    manager: State<'_, BrowserManager>,
    session_id: String,
) -> Result<BrowserResponse, String> {
    request(manager, "close", json!({ "sessionId": session_id }))
}
