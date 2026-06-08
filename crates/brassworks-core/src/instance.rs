
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::paths::Paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoaderKind {
    Vanilla,
    NeoForge,
    Forge,
    Fabric,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "channel", content = "value", rename_all = "snake_case")]
pub enum LoaderVersion {
    Stable,
    Unstable,
    Exact(String),
}

impl Default for LoaderVersion {
    fn default() -> Self {
        LoaderVersion::Stable
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub minecraft_version: String,
    pub loader: LoaderKind,
    #[serde(default)]
    pub loader_version: LoaderVersion,

    #[serde(default)]
    pub max_memory_mb: Option<u32>,
    #[serde(default)]
    pub min_memory_mb: Option<u32>,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub extra_jvm_args: Vec<String>,
    #[serde(default)]
    pub resolution: Option<(u16, u16)>,

    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub last_played: Option<DateTime<Utc>>,
    #[serde(default)]
    pub playtime_seconds: u64,
}

impl Instance {
    pub fn brassworks_default() -> Self {
        Self {
            id: "brassworks".to_string(),
            name: "Brassworks SMP".to_string(),
            minecraft_version: "1.21.1".to_string(),
            loader: LoaderKind::NeoForge,
            loader_version: LoaderVersion::Stable,
            max_memory_mb: None,
            min_memory_mb: None,
            java_path: None,
            extra_jvm_args: Vec::new(),
            resolution: None,
            created_at: Utc::now(),
            last_played: None,
            playtime_seconds: 0,
        }
    }

    fn load_from(paths: &Paths, id: &str) -> Result<Self> {
        let file = paths.instance_config(id);
        let bytes = std::fs::read(&file).map_err(|e| CoreError::io(&file, e))?;
        serde_json::from_slice(&bytes).map_err(|e| CoreError::serde(file.display().to_string(), e))
    }

    pub fn save(&self, paths: &Paths) -> Result<()> {
        let dir = paths.instance_dir(&self.id);
        std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        let game_dir = paths.instance_game_dir(&self.id);
        std::fs::create_dir_all(&game_dir).map_err(|e| CoreError::io(&game_dir, e))?;

        let file = paths.instance_config(&self.id);
        let json = serde_json::to_vec_pretty(self)
            .map_err(|e| CoreError::serde(file.display().to_string(), e))?;
        std::fs::write(&file, json).map_err(|e| CoreError::io(&file, e))
    }
}

#[derive(Debug, Clone)]
pub struct InstanceManager {
    paths: Paths,
}

impl InstanceManager {
    pub fn new(paths: Paths) -> Self {
        Self { paths }
    }

    pub fn list(&self) -> Result<Vec<Instance>> {
        let dir = self.paths.instances_dir();
        let mut out = Vec::new();
        let read = match std::fs::read_dir(&dir) {
            Ok(read) => read,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(CoreError::io(&dir, e)),
        };
        for entry in read {
            let entry = entry.map_err(|e| CoreError::io(&dir, e))?;
            if !entry.path().is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            if self.paths.instance_config(&id).exists() {
                out.push(Instance::load_from(&self.paths, &id)?);
            }
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Instance> {
        if !self.paths.instance_config(id).exists() {
            return Err(CoreError::InstanceNotFound(id.to_string()));
        }
        Instance::load_from(&self.paths, id)
    }

    pub fn create(&self, instance: Instance) -> Result<Instance> {
        if self.paths.instance_config(&instance.id).exists() {
            return Err(CoreError::InstanceExists(instance.id.clone()));
        }
        instance.save(&self.paths)?;
        Ok(instance)
    }

    pub fn update(&self, instance: &Instance) -> Result<()> {
        if !self.paths.instance_config(&instance.id).exists() {
            return Err(CoreError::InstanceNotFound(instance.id.clone()));
        }
        instance.save(&self.paths)
    }

    pub fn ensure_default(&self) -> Result<Instance> {
        let default = Instance::brassworks_default();
        match self.get(&default.id) {
            Ok(existing) => Ok(existing),
            Err(CoreError::InstanceNotFound(_)) => self.create(default),
            Err(e) => Err(e),
        }
    }
}
