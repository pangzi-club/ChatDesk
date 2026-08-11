use rfd::FileDialog;

use crate::services::git;

#[tauri::command]
pub fn select_workspace_directory() -> Option<String> {
    FileDialog::new()
        .set_title("选择项目文件夹")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn inspect_workspace(path: String) -> crate::models::workspace::WorkspaceGitInfo {
    git::inspect_workspace(&path)
}
