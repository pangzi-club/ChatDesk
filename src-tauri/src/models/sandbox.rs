use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SandboxMode {
    Full,
    Sandbox,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxPermissions {
    #[serde(default)]
    pub network: bool,
}

impl Default for SandboxPermissions {
    fn default() -> Self {
        Self { network: false }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandResult {
    pub code: i32,
    pub out: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxInfo {
    pub available: bool,
    pub default_cwd: String,
}
