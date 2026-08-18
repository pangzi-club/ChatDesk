use crate::models::vite::ViteProcess;
use crate::services::process;

#[tauri::command]
pub fn list_vite_processes() -> Result<Vec<ViteProcess>, String> {
    process::list_vite_processes()
}

#[tauri::command]
pub fn kill_vite_process(pid: u32) -> Result<(), String> {
    process::kill_vite_process(pid)
}
