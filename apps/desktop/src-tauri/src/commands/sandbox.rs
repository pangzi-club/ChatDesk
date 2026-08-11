use crate::models::sandbox::{
    SandboxInfo, SandboxMode, SandboxPermissions, ShellCommandResult, WorkspaceEditFileResult,
    WorkspaceListDirResult, WorkspaceReadFileResult, WorkspaceSearchFilesResult,
    WorkspaceWriteFileResult,
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
    timeout_seconds: Option<u64>,
) -> Result<ShellCommandResult, String> {
    seatbelt::run_command(
        command,
        cwd,
        mode,
        permissions.unwrap_or_default(),
        timeout_seconds,
    )
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

#[tauri::command]
pub fn workspace_edit_file(
    cwd: String,
    path: String,
    old_text: String,
    new_text: String,
) -> Result<WorkspaceEditFileResult, String> {
    workspace_fs::edit_file(cwd, path, old_text, new_text)
}

#[tauri::command]
pub fn workspace_search_files(
    cwd: String,
    path: Option<String>,
    pattern: Option<String>,
    query: Option<String>,
    max_results: Option<usize>,
) -> Result<WorkspaceSearchFilesResult, String> {
    workspace_fs::search_files(cwd, path, pattern, query, max_results)
}
