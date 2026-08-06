use crate::models::sandbox::{
    SandboxInfo, SandboxMode, SandboxPermissions, ShellCommandResult, WorkspaceListDirResult,
    WorkspaceReadFileResult, WorkspaceWriteFileResult,
};
use crate::services::{seatbelt, workspace_fs};

#[tauri::command]
pub fn get_sandbox_info() -> Result<SandboxInfo, String> {
    seatbelt::sandbox_info()
}

#[tauri::command]
pub fn run_shell_command(
    command: String,
    cwd: Option<String>,
    mode: SandboxMode,
    permissions: Option<SandboxPermissions>,
) -> Result<ShellCommandResult, String> {
    seatbelt::run_command(command, cwd, mode, permissions.unwrap_or_default())
}

#[tauri::command]
pub fn workspace_list_dir(
    cwd: String,
    path: Option<String>,
) -> Result<WorkspaceListDirResult, String> {
    workspace_fs::list_dir(cwd, path)
}

#[tauri::command]
pub fn workspace_read_file(cwd: String, path: String) -> Result<WorkspaceReadFileResult, String> {
    workspace_fs::read_file(cwd, path)
}

#[tauri::command]
pub fn workspace_write_file(
    cwd: String,
    path: String,
    content: String,
) -> Result<WorkspaceWriteFileResult, String> {
    workspace_fs::write_file(cwd, path, content)
}
