use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::models::sandbox::{SandboxInfo, SandboxMode, SandboxPermissions, ShellCommandResult};

pub fn sandbox_info() -> Result<SandboxInfo, String> {
    Ok(SandboxInfo {
        available: cfg!(target_os = "macos"),
        default_cwd: default_workspace()?.to_string_lossy().into_owned(),
    })
}

pub fn run_command(
    command: String,
    cwd: Option<String>,
    mode: SandboxMode,
    permissions: SandboxPermissions,
    timeout_seconds: Option<u64>,
) -> Result<ShellCommandResult, String> {
    if command.trim().is_empty() {
        return Err(String::from("命令不能为空"));
    }

    let workspace = resolve_workspace(cwd.as_deref())?;
    let shell = env::var("SHELL").unwrap_or_else(|_| String::from("/bin/sh"));
    let timeout = Duration::from_secs(timeout_seconds.unwrap_or(120).clamp(1, 600));

    match mode {
        SandboxMode::Full => run_unsandboxed(&shell, &command, &workspace, timeout),
        SandboxMode::Sandbox => {
            if !cfg!(target_os = "macos") {
                return Err(String::from("Seatbelt 沙箱仅在 macOS 上可用"));
            }
            run_sandboxed(&shell, &command, &workspace, permissions.network, timeout)
        }
    }
}

fn default_workspace() -> Result<PathBuf, String> {
    let path = env::temp_dir().join("m-dashboard-sandbox");
    fs::create_dir_all(&path).map_err(|error| format!("无法创建演示工作区：{error}"))?;
    fs::canonicalize(&path).map_err(|error| format!("无法解析演示工作区：{error}"))
}

fn resolve_workspace(cwd: Option<&str>) -> Result<PathBuf, String> {
    let path = match cwd {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
        _ => return default_workspace(),
    };

    if !path.exists() {
        return Err(format!("工作目录不存在：{}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("工作目录不是文件夹：{}", path.display()));
    }

    fs::canonicalize(&path).map_err(|error| format!("无法解析工作目录：{error}"))
}

fn escape_seatbelt_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

fn build_seatbelt_profile(workspace: &Path, network: bool) -> Result<String, String> {
    let tmp =
        fs::canonicalize(env::temp_dir()).map_err(|error| format!("无法解析临时目录：{error}"))?;
    let workspace_escaped = escape_seatbelt_path(workspace);
    let tmp_escaped = escape_seatbelt_path(&tmp);

    let mut rules = vec![
        String::from("(version 1)"),
        String::from("(allow default)"),
        format!(
            "(deny file-write* (require-not (require-any (subpath \"{workspace_escaped}\") (subpath \"{tmp_escaped}\") (subpath \"/dev/null\") (subpath \"/dev/tty\"))))"
        ),
    ];

    if !network {
        rules.push(String::from("(deny network*)"));
    }

    Ok(rules.join(" "))
}

fn run_unsandboxed(
    shell: &str,
    command: &str,
    workspace: &Path,
    timeout: Duration,
) -> Result<ShellCommandResult, String> {
    let mut process = Command::new(shell);
    process.args(["-lc", command]).current_dir(workspace);
    run_process(&mut process, timeout)
}

#[cfg(target_os = "macos")]
fn run_sandboxed(
    shell: &str,
    command: &str,
    workspace: &Path,
    network: bool,
    timeout: Duration,
) -> Result<ShellCommandResult, String> {
    let profile = build_seatbelt_profile(workspace, network)?;
    let mut process = Command::new("/usr/bin/sandbox-exec");
    process
        .args(["-p", &profile, shell, "-lc", command])
        .current_dir(workspace);
    run_process(&mut process, timeout)
}

#[cfg(not(target_os = "macos"))]
fn run_sandboxed(
    _shell: &str,
    _command: &str,
    _workspace: &Path,
    _network: bool,
    _timeout: Duration,
) -> Result<ShellCommandResult, String> {
    Err(String::from("Seatbelt 沙箱仅在 macOS 上可用"))
}

fn run_process(command: &mut Command, timeout: Duration) -> Result<ShellCommandResult, String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动进程：{error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| String::from("无法读取标准输出"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| String::from("无法读取错误输出"))?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            let _ = child.kill();
            break child.wait().map_err(|error| error.to_string())?;
        }
        thread::sleep(Duration::from_millis(40));
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    let mut out = String::from_utf8_lossy(&stdout).into_owned();
    let stderr = String::from_utf8_lossy(&stderr);
    if !stderr.is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(stderr.trim_end());
    }

    if timed_out {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str("命令执行超时，进程已终止");
    }
    Ok(ShellCommandResult {
        code: status.code().unwrap_or(-1),
        out,
    })
}
