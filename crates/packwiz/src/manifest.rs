use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{PackwizError, Result};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub pack_version: String,
    #[serde(default)]
    pub index_hash: String,
    #[serde(default)]
    pub minecraft_version: Option<String>,
    #[serde(default)]
    pub neoforge_version: Option<String>,
    #[serde(default)]
    pub complete: bool,
    #[serde(default)]
    pub failed: Vec<String>,
    #[serde(default)]
    pub files: BTreeMap<String, FileRecord>,
    #[serde(default)]
    pub mods: Vec<ManagedMod>,
                #[serde(default)]
    pub optional: Vec<String>,
                #[serde(default)]
    pub flavors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRecord {
    pub hash: String,
    pub hash_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedMod {
    pub name: String,
    pub filename: String,
    pub path: String,
    pub side: String,
    pub category: String,
    #[serde(default)]
    pub modrinth_id: Option<String>,
    #[serde(default)]
    pub modrinth_version: Option<String>,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub curseforge_id: Option<i64>,
    #[serde(default)]
    pub curseforge_file: Option<i64>,
}

impl Manifest {
    pub fn load(path: &Path) -> Result<Self> {
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| PackwizError::Other(format!("parse manifest: {e}"))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(PackwizError::io(path.display().to_string(), e)),
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| PackwizError::io(parent.display().to_string(), e))?;
        }
        let json = serde_json::to_vec_pretty(self)
            .map_err(|e| PackwizError::Other(format!("serialize manifest: {e}")))?;
        std::fs::write(path, json).map_err(|e| PackwizError::io(path.display().to_string(), e))
    }
}
