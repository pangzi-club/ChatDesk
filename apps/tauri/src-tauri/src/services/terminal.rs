use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use uuid::Uuid;

const MIN_TERMINAL_DIMENSION: u16 = 2;
const MAX_TERMINAL_DIMENSION: u16 = 1_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpawnResult {
    pub id: String,
    pub shell: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output { data: Vec<u8> },
    Exit { code: u32, signal: Option<String> },
    Error { message: String },
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Clone, Default)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl TerminalManager {
    pub fn spawn(
        &self,
        cwd: String,
        cols: u16,
        rows: u16,
        channel: Channel<TerminalEvent>,
    ) -> Result<TerminalSpawnResult, String> {
        let cwd = validate_cwd(&cwd)?;
        let size = terminal_size(cols, rows);
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|error| format!("创建终端失败：{error}"))?;
        let mut command = CommandBuilder::new_default_prog();
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let shell = command.get_shell();
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("启动终端失败：{error}"))?;
        let mut killer = child.clone_killer();
        let mut reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                let _ = killer.kill();
                return Err(format!("连接终端输出失败：{error}"));
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                let _ = killer.kill();
                return Err(format!("连接终端输入失败：{error}"));
            }
        };
        let id = Uuid::new_v4().to_string();

        self.sessions
            .lock()
            .map_err(|_| "终端会话状态不可用".to_string())?
            .insert(
                id.clone(),
                TerminalSession {
                    master: pair.master,
                    writer,
                    killer,
                },
            );

        let output_channel = channel.clone();
        std::thread::spawn(move || {
            let mut buffer = vec![0_u8; 8 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(length) => {
                        if output_channel
                            .send(TerminalEvent::Output {
                                data: buffer[..length].to_vec(),
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = output_channel.send(TerminalEvent::Error {
                            message: format!("读取终端输出失败：{error}"),
                        });
                        break;
                    }
                }
            }
        });

        let sessions = Arc::clone(&self.sessions);
        let session_id = id.clone();
        std::thread::spawn(move || match child.wait() {
            Ok(status) => {
                let _ = channel.send(TerminalEvent::Exit {
                    code: status.exit_code(),
                    signal: status.signal().map(str::to_owned),
                });
                remove_session(&sessions, &session_id);
            }
            Err(error) => {
                let _ = channel.send(TerminalEvent::Error {
                    message: format!("等待终端退出失败：{error}"),
                });
                remove_session(&sessions, &session_id);
            }
        });

        Ok(TerminalSpawnResult { id, shell })
    }

    pub fn write(&self, id: &str, data: String) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "终端会话状态不可用".to_string())?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| "终端会话不存在或已结束".to_string())?;
        session
            .writer
            .write_all(data.as_bytes())
            .and_then(|_| session.writer.flush())
            .map_err(|error| format!("写入终端失败：{error}"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "终端会话状态不可用".to_string())?;
        let session = sessions
            .get(id)
            .ok_or_else(|| "终端会话不存在或已结束".to_string())?;
        session
            .master
            .resize(terminal_size(cols, rows))
            .map_err(|error| format!("调整终端尺寸失败：{error}"))
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| "终端会话状态不可用".to_string())?
            .remove(id);
        if let Some(mut session) = session {
            session
                .killer
                .kill()
                .map_err(|error| format!("关闭终端失败：{error}"))?;
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        let sessions = match self.sessions.lock() {
            Ok(mut sessions) => sessions
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>(),
            Err(_) => return,
        };
        for mut session in sessions {
            let _ = session.killer.kill();
        }
    }
}

fn validate_cwd(cwd: &str) -> Result<PathBuf, String> {
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Err("请先选择 Workspace".to_string());
    }
    let path = fs::canonicalize(cwd).map_err(|_| format!("终端工作目录不存在：{cwd}"))?;
    if !path.is_dir() {
        return Err(format!("终端工作目录不是目录：{}", path.display()));
    }
    Ok(path)
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(MIN_TERMINAL_DIMENSION, MAX_TERMINAL_DIMENSION),
        rows: rows.clamp(MIN_TERMINAL_DIMENSION, MAX_TERMINAL_DIMENSION),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn remove_session(sessions: &Arc<Mutex<HashMap<String, TerminalSession>>>, id: &str) {
    if let Ok(mut sessions) = sessions.lock() {
        sessions.remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_dimensions_are_bounded() {
        assert_eq!(terminal_size(0, 1).cols, MIN_TERMINAL_DIMENSION);
        assert_eq!(terminal_size(0, 1).rows, MIN_TERMINAL_DIMENSION);
        assert_eq!(
            terminal_size(u16::MAX, u16::MAX).cols,
            MAX_TERMINAL_DIMENSION
        );
        assert_eq!(
            terminal_size(u16::MAX, u16::MAX).rows,
            MAX_TERMINAL_DIMENSION
        );
    }

    #[test]
    fn cwd_must_be_a_directory() {
        assert!(validate_cwd("").is_err());
        assert!(validate_cwd(env!("CARGO_MANIFEST_DIR")).is_ok());
        assert!(validate_cwd(file!()).is_err());
    }
}
