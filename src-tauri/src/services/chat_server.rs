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
    state: Arc<Mutex<RuntimeState>>,
    lifecycle: Arc<Mutex<()>>,
}

impl ChatServerManager {
    pub fn start(app: &AppHandle) -> Self {
        let manager = Self {
            app: app.clone(),
            state: Arc::new(Mutex::new(RuntimeState {
                child: None,
                info: default_info(ChatServerState::Starting),
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

    pub fn unavailable(app: &AppHandle) -> Self {
        Self {
            app: app.clone(),
            state: Arc::new(Mutex::new(RuntimeState {
                child: None,
                info: default_info(ChatServerState::Offline),
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

fn default_info(state: ChatServerState) -> ChatServerInfo {
    ChatServerInfo {
        host: "127.0.0.1".to_string(),
        port: DEFAULT_PORT,
        token: String::new(),
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
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位 Chat Server 数据目录：{error}"))?
        .join("chat-server");
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
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        command
            .env(
                "CHAT_SERVER_LEGACY_MEMORY_FILE",
                app_data_dir.join("chat/memory.json"),
            )
            .env(
                "CHAT_SERVER_LEGACY_ARCHIVE_DIR",
                app_data_dir.join("chat-archive"),
            )
            .env(
                "CHAT_SERVER_LEGACY_SETTINGS_FILE",
                app_data_dir.join("settings.json"),
            );
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        for candidate in [
            resource_dir.join("browser-worker"),
            resource_dir.join("resources/browser-worker"),
        ] {
            if candidate.is_file() {
                command.env("CHAT_SERVER_BROWSER_WORKER", candidate);
                break;
            }
        }
        for candidate in [
            resource_dir.join("playwright-browsers"),
            resource_dir.join("resources/playwright-browsers"),
        ] {
            if candidate.is_dir() {
                command.env("CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH", candidate);
                break;
            }
        }
    }
    let legacy_dirs = find_legacy_dirs(app, &data_dir);
    if !legacy_dirs.is_empty() {
        let delimiter = if cfg!(windows) { ';' } else { ':' };
        command.env(
            "CHAT_SERVER_LEGACY_DIRS",
            legacy_dirs
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(&delimiter.to_string()),
        );
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

fn find_legacy_dirs(app: &AppHandle, data_dir: &Path) -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(directory) = std::env::var("M_DASHBOARD_LEGACY_CHAT_DIR") {
        candidates.push(std::path::PathBuf::from(directory));
    }
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        candidates.push(app_data_dir.join("chat"));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join(".data/chat-server"));
        candidates.push(current_dir.join(".data/chat"));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        for ancestor in current_exe.ancestors() {
            candidates.push(ancestor.join(".data/chat-server"));
            candidates.push(ancestor.join(".data/chat"));
        }
    }
    candidates
        .into_iter()
        .filter(|candidate| {
            candidate != data_dir
                && (candidate.join("index.json").is_file() || candidate.join("sessions").is_dir())
        })
        .collect()
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
    use super::restart_delay;
    use std::time::Duration;

    #[test]
    fn restart_backoff_is_bounded() {
        assert_eq!(restart_delay(1), Duration::from_secs(1));
        assert_eq!(restart_delay(2), Duration::from_secs(2));
        assert_eq!(restart_delay(3), Duration::from_secs(5));
        assert_eq!(restart_delay(99), Duration::from_secs(5));
    }
}
