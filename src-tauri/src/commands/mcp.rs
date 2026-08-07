use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDefinition {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<Value>,
}

struct ProcessHandle {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

#[derive(Default)]
pub struct McpManager {
    processes: Mutex<HashMap<String, Arc<Mutex<ProcessHandle>>>>,
}

impl Drop for McpManager {
    fn drop(&mut self) {
        if let Ok(mut processes) = self.processes.lock() {
            for (_, process) in processes.drain() {
                if let Ok(mut process) = process.lock() {
                    let _ = process.child.kill();
                }
            }
        }
    }
}

fn validate_server(server: &McpServerConfig) -> Result<(), String> {
    if server.transport != "npx" {
        return Err("stdio bridge 只支持 npx MCP".to_string());
    }
    let command = server.command.as_deref().unwrap_or("npx");
    if command != "npx" {
        return Err("为安全起见，本地 MCP command 必须是 npx".to_string());
    }
    if server.id.is_empty() || server.id.len() > 128 {
        return Err("invalid MCP server id".to_string());
    }
    let args = server.args.as_deref().unwrap_or_default();
    if args
        .iter()
        .any(|arg| arg.contains('\n') || arg.contains('\r'))
    {
        return Err("MCP 参数不能包含换行".to_string());
    }
    Ok(())
}

fn rpc(process: &mut ProcessHandle, method: &str, params: Value) -> Result<Value, String> {
    process.next_id += 1;
    let id = process.next_id;
    let request = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params});
    writeln!(process.stdin, "{}", request).map_err(|error| error.to_string())?;
    process.stdin.flush().map_err(|error| error.to_string())?;
    let mut line = String::new();
    loop {
        line.clear();
        let read = process
            .stdout
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("MCP 进程已退出".to_string());
        }
        let response: Value =
            serde_json::from_str(line.trim()).map_err(|error| error.to_string())?;
        if response.get("id") == Some(&json!(id)) {
            if let Some(error) = response.get("error") {
                return Err(error.to_string());
            }
            return Ok(response.get("result").cloned().unwrap_or(Value::Null));
        }
    }
}

fn start_process(server: &McpServerConfig) -> Result<ProcessHandle, String> {
    validate_server(server)?;
    let command = server.command.as_deref().unwrap_or("npx");
    let mut process = Command::new(command);
    process.args(server.args.as_deref().unwrap_or_default());
    process
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(env) = &server.env {
        process.envs(env);
    }
    let mut child = process.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "启动 MCP 失败：未找到 npx，请先安装 Node.js 并确保 npx 在 PATH 中".to_string()
        } else {
            format!("启动 MCP 失败: {error}")
        }
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "MCP stdin 不可用".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "MCP stdout 不可用".to_string())?;
    let mut handle = ProcessHandle {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        next_id: 0,
    };
    rpc(
        &mut handle,
        "initialize",
        json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "m-dashboard", "version": "0.2.0"}
        }),
    )?;
    writeln!(
        handle.stdin,
        "{}",
        json!({"jsonrpc":"2.0","method":"notifications/initialized"})
    )
    .map_err(|error| error.to_string())?;
    handle.stdin.flush().map_err(|error| error.to_string())?;
    Ok(handle)
}

#[tauri::command]
pub fn mcp_start(state: State<'_, McpManager>, server: McpServerConfig) -> Result<(), String> {
    {
        let processes = state
            .processes
            .lock()
            .map_err(|_| "MCP manager 锁失败".to_string())?;
        if processes.contains_key(&server.id) {
            return Ok(());
        }
    }
    let handle = start_process(&server)?;
    let mut processes = state
        .processes
        .lock()
        .map_err(|_| "MCP manager 锁失败".to_string())?;
    if processes.contains_key(&server.id) {
        let mut handle = handle;
        let _ = handle.child.kill();
        return Ok(());
    }
    processes.insert(server.id, Arc::new(Mutex::new(handle)));
    Ok(())
}

#[tauri::command]
pub fn mcp_list_tools(
    state: State<'_, McpManager>,
    server_id: String,
) -> Result<Vec<McpToolDefinition>, String> {
    let mut processes = state
        .processes
        .lock()
        .map_err(|_| "MCP manager 锁失败".to_string())?;
    let process = processes
        .get_mut(&server_id)
        .cloned()
        .ok_or_else(|| "MCP 尚未启动".to_string())?;
    drop(processes);
    let mut process = process
        .lock()
        .map_err(|_| "MCP 进程锁失败".to_string())?;
    let result = rpc(&mut process, "tools/list", json!({}))?;
    let tools = result
        .get("tools")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(tools
        .into_iter()
        .filter_map(|item| {
            Some(McpToolDefinition {
                name: item.get("name")?.as_str()?.to_string(),
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                input_schema: item.get("inputSchema").cloned(),
            })
        })
        .collect())
}

#[tauri::command]
pub fn mcp_call_tool(
    state: State<'_, McpManager>,
    server_id: String,
    tool_name: String,
    arguments: Value,
) -> Result<Value, String> {
    let mut processes = state
        .processes
        .lock()
        .map_err(|_| "MCP manager 锁失败".to_string())?;
    let process = processes
        .get_mut(&server_id)
        .cloned()
        .ok_or_else(|| "MCP 尚未启动".to_string())?;
    drop(processes);
    let mut process = process
        .lock()
        .map_err(|_| "MCP 进程锁失败".to_string())?;
    rpc(
        &mut process,
        "tools/call",
        json!({"name":tool_name,"arguments":arguments}),
    )
}

#[tauri::command]
pub fn mcp_stop(state: State<'_, McpManager>, server_id: String) -> Result<(), String> {
    let mut processes = state
        .processes
        .lock()
        .map_err(|_| "MCP manager 锁失败".to_string())?;
    if let Some(process) = processes.remove(&server_id) {
        if let Ok(mut process) = process.lock() {
            let _ = process.child.kill();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_test_connection(
    state: State<'_, McpManager>,
    server: McpServerConfig,
) -> Result<Vec<McpToolDefinition>, String> {
    mcp_start(state.clone(), server.clone())?;
    mcp_list_tools(state, server.id)
}
