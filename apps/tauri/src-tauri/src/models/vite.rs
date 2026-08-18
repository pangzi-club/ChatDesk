use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ViteProcess {
    pub pid: u32,
    pub name: String,
    pub command: String,
    pub ports: Vec<u16>,
}
