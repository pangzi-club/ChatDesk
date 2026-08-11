use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use chrono::Local;
use serde::Deserialize;
use tauri::AppHandle;

use crate::commands::system_log::append_system_log;
use crate::services::user_data::read_user_file;

const AUTOMATION_TASKS_STORE_KEY: &str = "automation-tasks";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTask {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub task_type: String,
    pub interval_minutes: f64,
    pub enabled: bool,
}

#[derive(Clone)]
pub struct AutomationScheduler {
    tasks: Arc<Mutex<Vec<AutomationTask>>>,
}

impl AutomationScheduler {
    pub fn start(app: &AppHandle) -> Result<Self, String> {
        let tasks = load_tasks(app)?;
        let shared_tasks = Arc::new(Mutex::new(tasks));
        let scheduler_tasks = Arc::clone(&shared_tasks);
        let scheduler_app = app.clone();

        thread::Builder::new()
            .name("automation-scheduler".into())
            .spawn(move || run_scheduler(scheduler_app, scheduler_tasks))
            .map_err(|error| error.to_string())?;

        Ok(Self {
            tasks: shared_tasks,
        })
    }

    pub fn replace_tasks(&self, tasks: Vec<AutomationTask>) -> Result<(), String> {
        *self.tasks.lock().map_err(|error| error.to_string())? = tasks;
        Ok(())
    }
}

fn load_tasks(app: &AppHandle) -> Result<Vec<AutomationTask>, String> {
    let Some(contents) = read_user_file(app, "settings.json")? else {
        return Ok(Vec::new());
    };
    let value: serde_json::Value =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    let Some(tasks) = value.get(AUTOMATION_TASKS_STORE_KEY) else {
        return Ok(Vec::new());
    };
    serde_json::from_value(tasks.clone()).map_err(|error| error.to_string())
}

fn run_scheduler(app: AppHandle, tasks: Arc<Mutex<Vec<AutomationTask>>>) {
    let mut next_runs: HashMap<String, Instant> = HashMap::new();

    loop {
        let now = Instant::now();
        let current_tasks = load_tasks(&app).unwrap_or_else(|_| match tasks.lock() {
            Ok(tasks) => tasks.clone(),
            Err(_) => Vec::new(),
        });

        next_runs.retain(|id, _| current_tasks.iter().any(|task| task.id == *id));

        for task in current_tasks {
            if !task.enabled
                || task.task_type != "log-current-time"
                || !task.interval_minutes.is_finite()
                || task.interval_minutes <= 0.0
            {
                next_runs.remove(&task.id);
                continue;
            }
            let Some(interval) = Duration::try_from_secs_f64(task.interval_minutes * 60.0).ok()
            else {
                next_runs.remove(&task.id);
                continue;
            };

            let next_run = next_runs
                .entry(task.id.clone())
                .or_insert_with(|| now + interval);
            if now < *next_run {
                continue;
            }

            let current_time = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let _ = append_system_log(
                &app,
                "info",
                &format!("自动化 · {}", task.name),
                &format!("当前时间：{current_time}"),
            );
            *next_run = now + interval;
        }

        thread::sleep(Duration::from_secs(1));
    }
}
