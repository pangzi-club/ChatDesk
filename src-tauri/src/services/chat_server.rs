use serde::Serialize;
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub const DEFAULT_PORT: u16 = 14317;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatServerInfo {
    pub host: String,
    pub port: u16,
    pub token: String,
    pub running: bool,
}

pub struct ChatServerManager {
    child: Mutex<Option<Child>>,
    info: ChatServerInfo,
}

impl ChatServerManager {
    pub fn start(app: &AppHandle) -> Result<Self, String> {
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
        let mut child = Command::new(executable)
            .env("CHAT_SERVER_HOST", "127.0.0.1")
            .env("CHAT_SERVER_TOKEN", &token)
            .env("CHAT_SERVER_DATA_DIR", &data_dir)
            .env("CHAT_SERVER_PORT", port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("无法启动 Chat Server sidecar：{error}"))?;
        if let Err(error) = wait_for_server(&mut child, port) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }

        Ok(Self {
            child: Mutex::new(Some(child)),
            info: ChatServerInfo {
                host: "127.0.0.1".to_string(),
                port,
                token,
                running: true,
            },
        })
    }

    pub fn unavailable() -> Self {
        Self {
            child: Mutex::new(None),
            info: ChatServerInfo {
                host: "127.0.0.1".to_string(),
                port: DEFAULT_PORT,
                token: String::new(),
                running: false,
            },
        }
    }

    pub fn info(&self) -> ChatServerInfo {
        self.info.clone()
    }
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

impl Drop for ChatServerManager {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut child) = child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
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
