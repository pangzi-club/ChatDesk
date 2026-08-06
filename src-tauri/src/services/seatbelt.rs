use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::models::sandbox::{
    SandboxInfo, SandboxMode, SandboxPermissions, ShellCommandResult,
};

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
) -> Result<ShellCommandResult, String> {
    if command.trim().is_empty() {
        return Err(String::from("命令不能为空"));
    }

    let workspace = resolve_workspace(cwd.as_deref())?;
    let shell = env::var("SHELL").unwrap_or_else(|_| String::from("/bin/sh"));

    match mode {
        SandboxMode::Full => run_unsandboxed(&shell, &command, &workspace),
        SandboxMode::Sandbox => {
            if !cfg!(target_os = "macos") {
                return Err(String::from("Seatbelt 沙箱仅在 macOS 上可用"));
            }
            run_sandboxed(&shell, &command, &workspace, permissions.network)
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
    let tmp = fs::canonicalize(env::temp_dir())
        .map_err(|error| format!("无法解析临时目录：{error}"))?;
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
) -> Result<ShellCommandResult, String> {
    let output = Command::new(shell)
        .args(["-lc", command])
        .current_dir(workspace)
        .output()
        .map_err(|error| format!("无法启动进程：{error}"))?;

    Ok(to_result(output))
}

#[cfg(target_os = "macos")]
fn run_sandboxed(
    shell: &str,
    command: &str,
    workspace: &Path,
    network: bool,
) -> Result<ShellCommandResult, String> {
    let profile = build_seatbelt_profile(workspace, network)?;
    let output = Command::new("/usr/bin/sandbox-exec")
        .args(["-p", &profile, shell, "-lc", command])
        .current_dir(workspace)
        .output()
        .map_err(|error| format!("无法启动沙箱进程：{error}"))?;

    Ok(to_result(output))
}

#[cfg(not(target_os = "macos"))]
fn run_sandboxed(
    _shell: &str,
    _command: &str,
    _workspace: &Path,
    _network: bool,
) -> Result<ShellCommandResult, String> {
    Err(String::from("Seatbelt 沙箱仅在 macOS 上可用"))
}

fn to_result(output: std::process::Output) -> ShellCommandResult {
    let mut out = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(stderr.trim_end());
    }

    ShellCommandResult {
        code: output.status.code().unwrap_or(-1),
        out,
    }
}
