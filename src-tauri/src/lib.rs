use serde::Serialize;
use std::process::Command;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Debug, Serialize)]
struct ViteProcess {
    pid: u32,
    name: String,
    command: String,
    ports: Vec<u16>,
}

#[tauri::command]
fn list_vite_processes() -> Result<Vec<ViteProcess>, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,comm=,args="])
        .output()
        .map_err(|error| format!("无法读取进程列表：{error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }

    let mut processes = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut fields = line.splitn(3, char::is_whitespace).filter(|field| !field.is_empty());
        let Some(pid) = fields.next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        let Some(name) = fields.next() else {
            continue;
        };
        let command = fields.next().unwrap_or(name).trim();
        if !name.to_ascii_lowercase().contains("vite")
            && !command.to_ascii_lowercase().contains("vite")
        {
            continue;
        }

        processes.push(ViteProcess {
            pid,
            name: name.to_owned(),
            command: command.to_owned(),
            ports: listening_ports(pid),
        });
    }

    processes.sort_by_key(|process| process.pid);
    Ok(processes)
}

fn listening_ports(pid: u32) -> Vec<u16> {
    let Ok(output) = Command::new("lsof")
        .args(["-nP", "-a", "-p", &pid.to_string(), "-iTCP", "-sTCP:LISTEN"])
        .output()
    else {
        return Vec::new();
    };

    let mut ports = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        let Some(listen_index) = fields.iter().position(|field| *field == "(LISTEN)") else {
            continue;
        };
        let Some(address) = listen_index.checked_sub(1).and_then(|index| fields.get(index)) else {
            continue;
        };
        let Some(port) = address.rsplit(':').next().and_then(|value| value.parse::<u16>().ok())
        else {
            continue;
        };
        if !ports.contains(&port) {
            ports.push(port);
        }
    }
    ports.sort_unstable();
    ports
}

#[tauri::command]
fn kill_vite_process(pid: u32) -> Result<(), String> {
    if pid <= 1 {
        return Err("无效的进程 ID".to_owned());
    }

    let process = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm=,args="])
        .output()
        .map_err(|error| format!("无法确认进程：{error}"))?;
    let process_details = String::from_utf8_lossy(&process.stdout).to_ascii_lowercase();
    if !process_details.contains("vite") {
        return Err("该进程已不存在，或不再是 Vite 进程".to_owned());
    }

    let output = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output()
        .map_err(|error| format!("无法终止进程：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![greet, list_vite_processes, kill_vite_process])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
