
use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};

#[derive(Debug, Clone)]
pub struct Paths {
    root: PathBuf,
}

impl Paths {
    pub fn with_root(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn default() -> Result<Self> {
        let base = dirs::data_dir().ok_or(CoreError::NoDataDir)?;
        Ok(Self::with_root(base.join("BrassworksLauncher")))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn shared_dir(&self) -> PathBuf {
        self.root.join("shared")
    }

    pub fn instances_dir(&self) -> PathBuf {
        self.root.join("instances")
    }

    pub fn instance_dir(&self, id: &str) -> PathBuf {
        self.instances_dir().join(id)
    }

    pub fn instance_game_dir(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("minecraft")
    }

    pub fn instance_config(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("instance.json")
    }

    pub fn modpack_manifest(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("packwiz.json")
    }

    pub fn user_content(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("user_content.json")
    }

    pub fn instance_game_subdir(&self, id: &str, sub: &str) -> PathBuf {
        self.instance_game_dir(id).join(sub)
    }

    pub fn modrinth_cache_dir(&self) -> PathBuf {
        self.shared_dir().join("modrinth-cache")
    }

    pub fn curseforge_cache_dir(&self) -> PathBuf {
        self.shared_dir().join("curseforge-cache")
    }

    pub fn jvm_dir(&self) -> PathBuf {
        self.shared_dir().join("jvm")
    }

    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    pub fn accounts_file(&self) -> PathBuf {
        self.root.join("accounts.json")
    }

    pub fn msa_db_file(&self) -> PathBuf {
        self.root.join("msa_accounts.json")
    }

    pub fn ensure_base(&self) -> Result<()> {
        for dir in [self.root.clone(), self.shared_dir(), self.instances_dir()] {
            std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        }
        Ok(())
    }
}
