
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LauncherSettings {
    pub default_max_memory_mb: u32,
    pub default_min_memory_mb: u32,
    pub java_path: Option<String>,
    pub keep_open: bool,
    pub theme: String,
    #[serde(default)]
    pub pack_url: Option<String>,
    #[serde(default)]
    pub dev_mode: bool,
    #[serde(default = "default_true")]
    pub modpack_locked: bool,
}

fn default_true() -> bool {
    true
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            default_max_memory_mb: 4096,
            default_min_memory_mb: 512,
            java_path: None,
            keep_open: true,
            theme: "brass-dark".to_string(),
            pack_url: None,
            dev_mode: false,
            modpack_locked: true,
        }
    }
}
