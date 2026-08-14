use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, Instant};

use crate::models::sandbox::{SandboxInfo, SandboxMode, SandboxPermissions, ShellCommandResult};

const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

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
    let path = env::temp_dir().join("chatdesk-sandbox");
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
    configure_process_environment(&mut process, workspace);
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
    configure_process_environment(&mut process, workspace);
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
    let output_limit_hit = Arc::new(AtomicBool::new(false));
    let stdout_limit = Arc::clone(&output_limit_hit);
    let stderr_limit = Arc::clone(&output_limit_hit);
    let stdout_reader = thread::spawn(move || read_limited(&mut stdout, stdout_limit));
    let stderr_reader = thread::spawn(move || read_limited(&mut stderr, stderr_limit));
    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let mut stopped_for_output = false;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        if output_limit_hit.load(Ordering::Relaxed) {
            stopped_for_output = true;
            terminate_process_tree(&mut child);
            break child.wait().map_err(|error| error.to_string())?;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            terminate_process_tree(&mut child);
            break child.wait().map_err(|error| error.to_string())?;
        }
        thread::sleep(Duration::from_millis(40));
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    let output_truncated = stopped_for_output || stdout.truncated || stderr.truncated;
    let mut out = String::from_utf8_lossy(&stdout.bytes).into_owned();
    let stderr = String::from_utf8_lossy(&stderr.bytes);
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
    if output_truncated {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str("命令输出超过限制，进程已终止");
    }
    Ok(ShellCommandResult {
        code: status.code().unwrap_or(-1),
        out,
    })
}

#[derive(Default)]
struct LimitedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_limited(reader: &mut impl Read, output_limit_hit: Arc<AtomicBool>) -> LimitedOutput {
    let mut bytes = Vec::with_capacity(MAX_OUTPUT_BYTES);
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let Ok(size) = reader.read(&mut buffer) else {
            break;
        };
        if size == 0 {
            break;
        }
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(bytes.len());
        if size > remaining {
            bytes.extend_from_slice(&buffer[..remaining]);
            truncated = true;
            output_limit_hit.store(true, Ordering::Relaxed);
        } else {
            bytes.extend_from_slice(&buffer[..size]);
        }
    }
    LimitedOutput { bytes, truncated }
}

fn configure_process_environment(command: &mut Command, cwd: &Path) {
    command.env_clear();
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    for key in [
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TERM",
        "COLORTERM",
        "PATH",
        "SHELL",
        "TMPDIR",
    ] {
        if let Ok(value) = env::var(key) {
            command.env(key, value);
        }
    }
    command
        .env(
            "PATH",
            env::var("PATH").unwrap_or_else(|_| String::from("/usr/local/bin:/usr/bin:/bin")),
        )
        .env(
            "SHELL",
            env::var("SHELL").unwrap_or_else(|_| String::from("/bin/sh")),
        )
        .env("TMPDIR", env::temp_dir())
        .env("HOME", cwd);
}

fn terminate_process_tree(child: &mut std::process::Child) {
    let pid = child.id();
    #[cfg(unix)]
    {
        let _ = Command::new("/bin/kill")
            .args(["-KILL", &format!("-{pid}")])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
    let _ = child.kill();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn limits_captured_output() {
        let mut input = Cursor::new(vec![b'x'; MAX_OUTPUT_BYTES + 1]);
        let output = read_limited(&mut input, Arc::new(AtomicBool::new(false)));
        assert_eq!(output.bytes.len(), MAX_OUTPUT_BYTES);
        assert!(output.truncated);
    }

    #[test]
    fn rejects_oversized_workspace_files() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("chatdesk-workspace-test-{suffix}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test workspace");
        let large = String::from_utf8(vec![b'x'; 512 * 1024 + 1]).expect("utf8");
        fs::write(root.join("large.txt"), large.as_bytes()).expect("write large file");

        let result = crate::services::workspace_fs::read_file(
            root.to_string_lossy().into_owned(),
            String::from("large.txt"),
        );
        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }
}
