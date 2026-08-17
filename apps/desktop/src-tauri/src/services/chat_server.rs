use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::services::user_data::user_data_dir;

pub const DEFAULT_PORT: u16 = 14317;
const MONITOR_INTERVAL: Duration = Duration::from_secs(5);
const STABLE_RUNTIME: Duration = Duration::from_secs(60);
const MAX_RESTART_ATTEMPTS: u32 = 3;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatServerState {
    Running,
    Starting,
    Restarting,
    Offline,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatServerInfo {
    pub host: String,
    pub port: u16,
    pub token: String,
    pub managed: bool,
    pub running: bool,
    pub state: ChatServerState,
    pub restart_attempt: u32,
    pub last_exit: Option<String>,
}

struct RuntimeState {
    child: Option<Child>,
    info: ChatServerInfo,
    stop_requested: bool,
    stable_since: Option<Instant>,
}

#[derive(Clone)]
pub struct ChatServerManager {
    app: AppHandle,
    managed: bool,
    state: Arc<Mutex<RuntimeState>>,
    lifecycle: Arc<Mutex<()>>,
}

impl ChatServerManager {
    pub fn start(app: &AppHandle) -> Self {
        let manager = Self {
            app: app.clone(),
            managed: true,
            state: Arc::new(Mutex::new(RuntimeState {
                child: None,
                info: default_info(ChatServerState::Starting, true),
                stop_requested: false,
                stable_since: None,
            })),
            lifecycle: Arc::new(Mutex::new(())),
        };
        manager.start_monitor();

        let initial = manager.clone();
        let _ = thread::Builder::new()
            .name("chat-server-start".to_string())
            .spawn(move || initial.spawn_and_store(0));
        manager
    }

    fn start_monitor(&self) {
        let monitor = self.clone();
        let _ = thread::Builder::new()
            .name("chat-server-monitor".to_string())
            .spawn(move || monitor.monitor_loop());
    }

    pub fn external(app: &AppHandle) -> Self {
        let mut info = default_info(ChatServerState::Offline, false);
        info.port = std::env::var("CHAT_SERVER_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|port| *port >= 1024)
            .unwrap_or(DEFAULT_PORT);
        info.token = std::env::var("CHAT_SERVER_TOKEN").unwrap_or_default();
        Self {
            app: app.clone(),
            managed: false,
            state: Arc::new(Mutex::new(RuntimeState {
                child: None,
                info,
                stop_requested: true,
                stable_since: None,
            })),
            lifecycle: Arc::new(Mutex::new(())),
        }
    }

    pub fn info(&self) -> ChatServerInfo {
        self.state
            .lock()
            .expect("Chat Server state lock poisoned")
            .info
            .clone()
    }

    pub fn restart(&self) -> Result<ChatServerInfo, String> {
        if !self.managed {
            return Err(
                "开发模式下 Chat Server 由 pnpm dev 管理，桌面端不会启动 sidecar".to_string(),
            );
        }
        let _lifecycle = self
            .lifecycle
            .lock()
            .map_err(|error| format!("重启 Chat Server 时锁定生命周期失败：{error}"))?;
        let child = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| format!("重启 Chat Server 时锁定状态失败：{error}"))?;
            state.info.state = ChatServerState::Restarting;
            state.info.running = false;
            state.info.restart_attempt = 0;
            state.stop_requested = true;
            state.stable_since = None;
            state.child.take()
        };
        terminate_child(child);

        {
            let mut state = self
                .state
                .lock()
                .map_err(|error| format!("重启 Chat Server 时更新状态失败：{error}"))?;
            state.stop_requested = false;
            state.info.state = ChatServerState::Starting;
        }

        match spawn_server(&self.app) {
            Ok((child, mut info)) => {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|error| format!("重启 Chat Server 时保存状态失败：{error}"))?;
                info.last_exit = state.info.last_exit.clone();
                state.child = Some(child);
                state.info = info;
                state.stable_since = Some(Instant::now());
                Ok(state.info.clone())
            }
            Err(error) => {
                let mut state = self.state.lock().map_err(|lock_error| {
                    format!("重启 Chat Server 时保存失败状态失败：{lock_error}")
                })?;
                state.info.state = ChatServerState::Offline;
                state.info.running = false;
                state.info.last_exit = Some(error.clone());
                tauri_plugin_log::log::error!("Chat Server 手动重启失败：{error}");
                Err(error)
            }
        }
    }

    pub fn shutdown(&self) -> Result<(), String> {
        let _lifecycle = self
            .lifecycle
            .lock()
            .map_err(|error| format!("关闭 Chat Server 时锁定生命周期失败：{error}"))?;
        let child = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| format!("关闭 Chat Server 时锁定状态失败：{error}"))?;
            state.stop_requested = true;
            state.info.running = false;
            state.info.state = ChatServerState::Offline;
            state.stable_since = None;
            state.child.take()
        };
        terminate_child(child);
        Ok(())
    }

    fn spawn_and_store(&self, attempt: u32) {
        let Ok(_lifecycle) = self.lifecycle.lock() else {
            tauri_plugin_log::log::error!("Chat Server 生命周期锁已损坏，无法启动");
            return;
        };
        let Ok(mut state) = self.state.lock() else {
            tauri_plugin_log::log::error!("Chat Server 状态锁已损坏，无法启动");
            return;
        };
        if state.stop_requested || state.child.is_some() {
            return;
        }
        state.info.state = if attempt == 0 {
            ChatServerState::Starting
        } else {
            ChatServerState::Restarting
        };
        state.info.running = false;
        state.info.restart_attempt = attempt;
        drop(state);

        match spawn_server(&self.app) {
            Ok((child, mut info)) => {
                if let Ok(mut state) = self.state.lock() {
                    info.restart_attempt = attempt;
                    if attempt > 0 {
                        info.last_exit = state.info.last_exit.clone();
                    }
                    state.child = Some(child);
                    state.info = info;
                    state.stable_since = Some(Instant::now());
                }
                tauri_plugin_log::log::info!("Chat Server 已启动，重启次数：{attempt}");
            }
            Err(error) => {
                if let Ok(mut state) = self.state.lock() {
                    state.info.state = ChatServerState::Offline;
                    state.info.running = false;
                    state.info.restart_attempt = attempt;
                    state.info.last_exit = Some(error.clone());
                    state.stable_since = None;
                }
                tauri_plugin_log::log::error!("Chat Server 启动失败（第 {attempt} 次）：{error}");
            }
        }
    }

    fn monitor_loop(&self) {
        loop {
            thread::sleep(MONITOR_INTERVAL);
            if self.is_stopping() {
                return;
            }

            let should_restart = {
                let Ok(_lifecycle) = self.lifecycle.lock() else {
                    return;
                };
                let Ok(mut state) = self.state.lock() else {
                    return;
                };
                if state.stop_requested {
                    return;
                }
                if let Some(child) = state.child.as_mut() {
                    match child.try_wait() {
                        Ok(None) => {
                            if state
                                .stable_since
                                .is_some_and(|started| started.elapsed() >= STABLE_RUNTIME)
                            {
                                state.info.restart_attempt = 0;
                            }
                            false
                        }
                        Ok(Some(status)) => {
                            state.child.take();
                            state.info.running = false;
                            state.info.state = ChatServerState::Offline;
                            state.info.last_exit = Some(format!("进程退出：{status}"));
                            state.stable_since = None;
                            tauri_plugin_log::log::error!("Chat Server 异常退出：{status}");
                            true
                        }
                        Err(error) => {
                            state.child.take();
                            state.info.running = false;
                            state.info.state = ChatServerState::Offline;
                            state.info.last_exit = Some(format!("检查进程状态失败：{error}"));
                            state.stable_since = None;
                            tauri_plugin_log::log::error!("检查 Chat Server 进程状态失败：{error}");
                            true
                        }
                    }
                } else {
                    !matches!(state.info.state, ChatServerState::Starting)
                }
            };

            if !should_restart {
                continue;
            }

            let attempt = self
                .state
                .lock()
                .map(|state| state.info.restart_attempt.saturating_add(1))
                .unwrap_or(MAX_RESTART_ATTEMPTS + 1);
            if attempt > MAX_RESTART_ATTEMPTS {
                if let Ok(mut state) = self.state.lock() {
                    state.info.state = ChatServerState::Offline;
                    state.info.running = false;
                }
                tauri_plugin_log::log::error!("Chat Server 自动重启次数已达上限");
                continue;
            }

            if let Ok(mut state) = self.state.lock() {
                state.info.state = ChatServerState::Restarting;
                state.info.restart_attempt = attempt;
            }

            if !sleep_before_restart(self, attempt) {
                return;
            }
            self.spawn_and_store(attempt);
        }
    }

    fn is_stopping(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.stop_requested)
            .unwrap_or(true)
    }
}

fn default_info(state: ChatServerState, managed: bool) -> ChatServerInfo {
    ChatServerInfo {
        host: "127.0.0.1".to_string(),
        port: DEFAULT_PORT,
        token: String::new(),
        managed,
        running: matches!(state, ChatServerState::Running),
        state,
        restart_attempt: 0,
        last_exit: None,
    }
}

fn sleep_before_restart(manager: &ChatServerManager, attempt: u32) -> bool {
    let delay = restart_delay(attempt);
    let started = Instant::now();
    while started.elapsed() < delay {
        if manager.is_stopping() {
            return false;
        }
        thread::sleep(Duration::from_millis(100));
    }
    true
}

fn restart_delay(attempt: u32) -> Duration {
    match attempt {
        1 => Duration::from_secs(1),
        2 => Duration::from_secs(2),
        _ => Duration::from_secs(5),
    }
}

fn terminate_child(child: Option<Child>) {
    let Some(mut child) = child else {
        return;
    };

    if request_graceful_exit(&child) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(error) => {
                    tauri_plugin_log::log::warn!("检查 Chat Server 优雅退出状态失败：{error}");
                    break;
                }
            }
        }
    }

    if let Err(error) = child.kill() {
        tauri_plugin_log::log::warn!("Chat Server 可能已提前退出：{error}");
    }
    if let Err(error) = child.wait() {
        tauri_plugin_log::log::warn!("等待 Chat Server 退出失败：{error}");
    }
}

#[cfg(unix)]
fn request_graceful_exit(child: &Child) -> bool {
    std::process::Command::new("kill")
        .args(["-TERM", &child.id().to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(all(not(unix), not(windows)))]
fn request_graceful_exit(_child: &Child) -> bool {
    false
}

#[cfg(windows)]
fn request_graceful_exit(child: &Child) -> bool {
    std::process::Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn spawn_server(app: &AppHandle) -> Result<(Child, ChatServerInfo), String> {
    let data_dir = user_data_dir(app)?.join("chat-server");
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("无法创建 Chat Server 数据目录：{error}"))?;
    let port = read_persisted_port(&data_dir);
    let token = Uuid::new_v4().to_string();
    let executable = find_sidecar(app)?;
    let mut command = Command::new(executable);
    command
        .env("CHAT_SERVER_HOST", "127.0.0.1")
        .env("CHAT_SERVER_PRODUCTION", "1")
        .env("CHAT_SERVER_TOKEN", &token)
        .env("CHAT_SERVER_DATA_DIR", &data_dir)
        .env("CHAT_SERVER_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Production must ship a real browser-worker resource. Missing it is a
    // startup error so browser tools cannot silently fail later.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法解析应用资源目录：{error}"))?;
    command.env("CHAT_SERVER_BROWSER_WORKER", find_browser_worker(&resource_dir)?);
    if let Some(browsers) = find_playwright_browsers(&resource_dir) {
        command.env("CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH", browsers);
    }
    if let Some(sharp) = find_sharp_node_modules(&resource_dir) {
        command.env("CHAT_SERVER_SHARP_PATH", sharp);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 Chat Server sidecar：{error}"))?;
    if let Some(stdout) = child.stdout.take() {
        spawn_output_logger(stdout, false);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_output_logger(stderr, true);
    }
    if let Err(error) = wait_for_server(&mut child, port) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    Ok((
        child,
        ChatServerInfo {
            host: "127.0.0.1".to_string(),
            port,
            token,
            managed: true,
            running: true,
            state: ChatServerState::Running,
            restart_attempt: 0,
            last_exit: None,
        },
    ))
}

fn spawn_output_logger<R>(reader: R, is_error: bool)
where
    R: Read + Send + 'static,
{
    let _ = thread::Builder::new()
        .name("chat-server-log".to_string())
        .spawn(move || {
            for line in BufReader::new(reader).lines().map_while(Result::ok) {
                if is_error {
                    tauri_plugin_log::log::error!("Chat Server stderr: {line}");
                } else {
                    tauri_plugin_log::log::info!("Chat Server stdout: {line}");
                }
            }
        });
}

fn wait_for_server(child: &mut Child, port: u16) -> Result<(), String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("检查 Chat Server sidecar 状态失败：{error}"))?
        {
            return Err(format!("Chat Server sidecar 启动后退出：{status}"));
        }
        if TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("Chat Server sidecar 在端口 {port} 上未就绪"));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn read_persisted_port(data_dir: &Path) -> u16 {
    let path = data_dir.join("server-config.json");
    let Ok(contents) = fs::read_to_string(path) else {
        return DEFAULT_PORT;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return DEFAULT_PORT;
    };
    let Some(port) = value.get("port").and_then(serde_json::Value::as_u64) else {
        return DEFAULT_PORT;
    };
    if (1024..=65535).contains(&port) {
        port as u16
    } else {
        DEFAULT_PORT
    }
}

fn find_browser_worker(resource_dir: &Path) -> Result<std::path::PathBuf, String> {
    // Packaged builds ship `browser-worker` as a Unix resource. Windows `.exe`
    // names are not handled yet; fail instead of starting without browser tools.
    [
        resource_dir.join("browser-worker"),
        resource_dir.join("resources").join("browser-worker"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| "未找到 browser worker 资源，请先运行 pnpm desktop:sidecars".to_string())
}

fn find_playwright_browsers(resource_dir: &Path) -> Option<std::path::PathBuf> {
    // Chromium is optional at process spawn; the worker reports a runtime error
    // if Playwright cannot locate a browser.
    [
        resource_dir.join("playwright-browsers"),
        resource_dir.join("resources").join("playwright-browsers"),
    ]
    .into_iter()
    .find(|path| path.is_dir())
}

fn find_sharp_node_modules(resource_dir: &Path) -> Option<std::path::PathBuf> {
    [
        resource_dir.join("sharp-node-modules"),
        resource_dir.join("resources").join("sharp-node-modules"),
    ]
    .into_iter()
    .find(|path| path.join("package.json").is_file())
}

fn find_sidecar(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let current_exe = std::env::current_exe().ok();
    let resource_dir = app.path().resource_dir().ok();
    let candidates = [
        current_exe
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.join("chat-server"))),
        current_exe
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.join("chat-server.exe"))),
        resource_dir.as_ref().map(|path| path.join("chat-server")),
        resource_dir
            .as_ref()
            .map(|path| path.join("chat-server.exe")),
        resource_dir
            .as_ref()
            .map(|path| path.join("binaries/chat-server")),
        resource_dir
            .as_ref()
            .map(|path| path.join("binaries/chat-server.exe")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
        .ok_or_else(|| "未找到已构建的 chat-server sidecar".to_string())
}

#[cfg(test)]
mod tests {
    use super::{default_info, find_browser_worker, find_sharp_node_modules, restart_delay, ChatServerState};
    use std::fs;
    use std::time::Duration;

    #[test]
    fn restart_backoff_is_bounded() {
        assert_eq!(restart_delay(1), Duration::from_secs(1));
        assert_eq!(restart_delay(2), Duration::from_secs(2));
        assert_eq!(restart_delay(3), Duration::from_secs(5));
        assert_eq!(restart_delay(99), Duration::from_secs(5));
    }

    #[test]
    fn runtime_info_reports_whether_the_server_is_managed() {
        assert!(default_info(ChatServerState::Running, true).managed);
        assert!(!default_info(ChatServerState::Offline, false).managed);
    }

    #[test]
    fn missing_browser_worker_returns_an_error() {
        let root = std::env::temp_dir().join(format!(
            "chatdesk-browser-worker-missing-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp resource dir");
        let error = find_browser_worker(&root).expect_err("missing worker should fail");
        assert!(error.contains("未找到 browser worker 资源"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_sharp_runtime_is_optional() {
        let root = std::env::temp_dir().join(format!(
            "chatdesk-sharp-missing-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp resource dir");
        assert!(find_sharp_node_modules(&root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn finds_sharp_runtime_package() {
        let root = std::env::temp_dir().join(format!(
            "chatdesk-sharp-present-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let sharp = root.join("sharp-node-modules");
        fs::create_dir_all(&sharp).expect("create sharp dir");
        fs::write(sharp.join("package.json"), "{}").expect("write package.json");
        assert_eq!(
            find_sharp_node_modules(&root).as_deref(),
            Some(sharp.as_path())
        );
        let _ = fs::remove_dir_all(&root);
    }
}
