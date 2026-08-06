use crate::models::sandbox::{
    SandboxInfo, SandboxMode, SandboxPermissions, ShellCommandResult,
};
use crate::services::seatbelt;

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
