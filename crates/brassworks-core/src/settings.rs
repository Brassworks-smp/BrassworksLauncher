use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

fn default_locale() -> String {
    "en".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LauncherSettings {
    pub default_max_memory_mb: u32,
    pub default_min_memory_mb: u32,
    pub java_path: Option<String>,
    pub java_policy: String,
    pub keep_open: bool,
    pub theme: String,
    #[serde(default)]
    pub accent_color: Option<String>,
    pub pack_url: Option<String>,
    pub dev_mode: bool,
    pub curseforge_api_key: Option<String>,
    pub selected_instance: Option<String>,

    pub pre_launch_command: Option<String>,
    pub post_exit_command: Option<String>,
    pub launch_behavior: String,
    pub default_resolution: Option<(u16, u16)>,
    pub start_minimized: bool,

    pub console_on_launch: bool,
    pub console_on_crash: bool,
    pub console_on_quit: bool,

    pub record_playtime: bool,
    pub show_playtime: bool,
    pub playtime_in_hours: bool,

    pub discord_rpc: bool,
    pub reduce_motion: bool,

        #[serde(default = "default_locale")]
    pub locale: String,

            #[serde(default)]
    pub pseudo_localize: bool,

            #[serde(default)]
    pub high_contrast: bool,

    #[serde(default)]
    pub close_to_tray: bool,

                #[serde(default = "default_true", alias = "show_featured_servers")]
    pub show_featured: bool,

    #[serde(default)]
    pub instance_folders: Vec<InstanceFolder>,

    pub auto_update: bool,
    pub last_version: Option<String>,

            pub download_concurrency: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstanceFolder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub collapsed: bool,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            default_max_memory_mb: 4096,
            default_min_memory_mb: 512,
            java_path: None,
            java_policy: "auto".to_string(),
            keep_open: true,
            theme: "brass-grey".to_string(),
            accent_color: None,
            pack_url: None,
            dev_mode: false,
            curseforge_api_key: None,
            selected_instance: None,

            pre_launch_command: None,
            post_exit_command: None,
            launch_behavior: "keep".to_string(),
            default_resolution: None,
            start_minimized: false,

            console_on_launch: false,
            console_on_crash: true,
            console_on_quit: false,

            record_playtime: true,
            show_playtime: true,
            playtime_in_hours: false,

            discord_rpc: true,
            reduce_motion: false,
            locale: default_locale(),
            pseudo_localize: false,
            high_contrast: false,
            close_to_tray: false,
            show_featured: true,
            instance_folders: Vec::new(),

            auto_update: true,
            last_version: None,
            download_concurrency: packwiz::DEFAULT_CONCURRENCY,
        }
    }
}
