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

#[cfg(test)]
mod manifest_tests {
    use super::*;

    #[test]
    fn default_is_empty() {
        let m = Manifest::default();
        assert_eq!(m.pack_version, "");
        assert_eq!(m.index_hash, "");
        assert!(m.minecraft_version.is_none());
        assert!(m.neoforge_version.is_none());
        assert!(!m.complete);
        assert!(m.failed.is_empty());
        assert!(m.files.is_empty());
        assert!(m.mods.is_empty());
        assert!(m.optional.is_empty());
        assert!(m.flavors.is_empty());
    }

    #[test]
    fn load_missing_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.json");
        let m = Manifest::load(&path).unwrap();
        assert_eq!(m.pack_version, "");
        assert!(m.mods.is_empty());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("packwiz.json");
        let mut m = Manifest::default();
        m.pack_version = "2024.1".to_string();
        m.index_hash = "deadbeef".to_string();
        m.minecraft_version = Some("1.21.1".to_string());
        m.neoforge_version = Some("21.1.0".to_string());
        m.complete = true;
        m.failed = vec!["bad.jar".to_string()];
        m.optional = vec!["opt1".to_string()];
        m.flavors = vec!["server".to_string()];
        m.files.insert(
            "config/foo.toml".to_string(),
            FileRecord { hash: "abc".to_string(), hash_format: "sha256".to_string() },
        );
        m.mods.push(ManagedMod {
            name: "Sodium".to_string(),
            filename: "sodium.jar".to_string(),
            path: "mods/sodium.jar".to_string(),
            side: "client".to_string(),
            category: "mod".to_string(),
            modrinth_id: Some("AANobbMI".to_string()),
            modrinth_version: Some("v".to_string()),
            source: "modrinth".to_string(),
            curseforge_id: None,
            curseforge_file: None,
        });
        m.save(&path).unwrap();

        let loaded = Manifest::load(&path).unwrap();
        assert_eq!(loaded.pack_version, "2024.1");
        assert_eq!(loaded.index_hash, "deadbeef");
        assert_eq!(loaded.minecraft_version.as_deref(), Some("1.21.1"));
        assert_eq!(loaded.neoforge_version.as_deref(), Some("21.1.0"));
        assert!(loaded.complete);
        assert_eq!(loaded.failed, vec!["bad.jar".to_string()]);
        assert_eq!(loaded.optional, vec!["opt1".to_string()]);
        assert_eq!(loaded.flavors, vec!["server".to_string()]);
        assert_eq!(loaded.files.len(), 1);
        assert_eq!(loaded.files["config/foo.toml"].hash, "abc");
        assert_eq!(loaded.mods.len(), 1);
        assert_eq!(loaded.mods[0].name, "Sodium");
        assert_eq!(loaded.mods[0].modrinth_id.as_deref(), Some("AANobbMI"));
    }

    #[test]
    fn save_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a").join("b").join("c").join("m.json");
        Manifest::default().save(&path).unwrap();
        assert!(path.is_file());
    }

    #[test]
    fn load_rejects_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, b"{ not json").unwrap();
        assert!(Manifest::load(&path).is_err());
    }
}
