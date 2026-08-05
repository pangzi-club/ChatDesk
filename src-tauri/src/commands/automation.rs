use tauri::State;

use crate::services::automation::{AutomationScheduler, AutomationTask};

#[tauri::command]
pub fn sync_automation_tasks(
    scheduler: State<'_, AutomationScheduler>,
    tasks: Vec<AutomationTask>,
) -> Result<(), String> {
    scheduler.replace_tasks(tasks)
}
