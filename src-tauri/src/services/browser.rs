use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct BrowserResponse {
    pub ok: bool,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

pub struct BrowserManager {
    app: AppHandle,
    worker: Mutex<Option<Worker>>,
}

impl BrowserManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            worker: Mutex::new(None),
        }
    }

    fn start_worker(&self) -> Result<Worker, String> {
        let resource_dir = self.app.path().resource_dir().ok();
        let binary = resource_dir.as_ref().and_then(|directory| {
            [
                directory.join("browser-worker"),
                directory.join("browser-worker.exe"),
                directory.join("resources/browser-worker"),
                directory.join("resources/browser-worker.exe"),
            ]
            .into_iter()
            .find(|candidate| candidate.is_file())
        });
        if let Some(binary) = binary {
            let mut command = Command::new(binary);
            if let Some(directory) = resource_dir {
                for browser_dir in [
                    directory.join("playwright-browsers"),
                    directory.join("resources/playwright-browsers"),
                ] {
                    if browser_dir.is_dir() {
                        command.env("PLAYWRIGHT_BROWSERS_PATH", browser_dir);
                        break;
                    }
                }
            }
            return spawn_worker(command);
        }

        let script = std::env::var("M_DASHBOARD_BROWSER_WORKER").unwrap_or_else(|_| {
            let source = format!(
                "{}/src/sidecar/browser-worker.mjs",
                env!("CARGO_MANIFEST_DIR")
            );
            if Path::new(&source).exists() {
                return source;
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(parent) = exe.parent() {
                    for candidate in [
                        parent.join("resources/src/sidecar/browser-worker.mjs"),
                        parent.join("resources/sidecar/browser-worker.mjs"),
                    ] {
                        if candidate.exists() {
                            return candidate.to_string_lossy().into_owned();
                        }
                    }
                }
            }
            source
        });
        let mut command = Command::new("node");
        command.arg(script);
        spawn_worker(command)
    }
}

fn spawn_worker(mut command: Command) -> Result<Worker, String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("无法启动浏览器 sidecar：{error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "sidecar stdin 不可用".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout 不可用".to_string())?;
    Ok(Worker {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

impl BrowserManager {
    pub fn request(&self, method: &str, params: Value) -> Result<BrowserResponse, String> {
        let mut guard = self
            .worker
            .lock()
            .map_err(|_| "浏览器管理器锁失败".to_string())?;
        if let Some(worker) = guard.as_mut() {
            if worker.child.try_wait().ok().flatten().is_some() {
                *guard = None;
            }
        }
        if guard.is_none() {
            *guard = Some(self.start_worker()?);
        }
        let worker = guard.as_mut().expect("worker initialized");
        let request =
            json!({ "id": uuid::Uuid::new_v4().to_string(), "method": method, "params": params });
        writeln!(worker.stdin, "{}", request)
            .map_err(|error| format!("发送浏览器请求失败：{error}"))?;
        worker
            .stdin
            .flush()
            .map_err(|error| format!("刷新浏览器请求失败：{error}"))?;
        let mut line = String::new();
        worker
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("读取浏览器响应失败：{error}"))?;
        if line.trim().is_empty() {
            return Err("浏览器 sidecar 已退出".to_string());
        }
        serde_json::from_str(line.trim()).map_err(|error| format!("解析浏览器响应失败：{error}"))
    }
}

impl Drop for BrowserManager {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.worker.lock() {
            if let Some(mut worker) = guard.take() {
                let _ = worker.child.kill();
                let _ = worker.child.wait();
            }
        }
    }
}
