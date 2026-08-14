use crate::services::terminal::{TerminalEvent, TerminalManager, TerminalSpawnResult};
use tauri::{ipc::Channel, State};

#[tauri::command]
pub fn terminal_spawn(
    manager: State<'_, TerminalManager>,
    cwd: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalSpawnResult, String> {
    manager.spawn(cwd, cols, rows, on_event)
}

#[tauri::command]
pub fn terminal_write(
    manager: State<'_, TerminalManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    manager.write(&id, data)
}

#[tauri::command]
pub fn terminal_resize(
    manager: State<'_, TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(manager: State<'_, TerminalManager>, id: String) -> Result<(), String> {
    manager.close(&id)
}
