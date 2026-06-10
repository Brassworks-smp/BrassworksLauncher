
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::paths::Paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StarKind {
    Worlds,
    Servers,
    Screenshots,
}

impl StarKind {
    pub fn parse(s: &str) -> Option<StarKind> {
        match s {
            "worlds" | "world" => Some(StarKind::Worlds),
            "servers" | "server" => Some(StarKind::Servers),
            "screenshots" | "screenshot" => Some(StarKind::Screenshots),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Stars {
    #[serde(default)]
    pub worlds: Vec<String>,
    #[serde(default)]
    pub servers: Vec<String>,
    #[serde(default)]
    pub screenshots: Vec<String>,
}

impl Stars {
    fn bucket(&self, kind: StarKind) -> &Vec<String> {
        match kind {
            StarKind::Worlds => &self.worlds,
            StarKind::Servers => &self.servers,
            StarKind::Screenshots => &self.screenshots,
        }
    }

    fn bucket_mut(&mut self, kind: StarKind) -> &mut Vec<String> {
        match kind {
            StarKind::Worlds => &mut self.worlds,
            StarKind::Servers => &mut self.servers,
            StarKind::Screenshots => &mut self.screenshots,
        }
    }

    pub fn contains(&self, kind: StarKind, key: &str) -> bool {
        self.bucket(kind).iter().any(|k| k == key)
    }

    pub fn toggle(&mut self, kind: StarKind, key: &str) -> bool {
        let bucket = self.bucket_mut(kind);
        if let Some(pos) = bucket.iter().position(|k| k == key) {
            bucket.remove(pos);
            false
        } else {
            bucket.push(key.to_string());
            true
        }
    }
}

pub fn load(paths: &Paths, instance_id: &str) -> Stars {
    let file = paths.stars_file(instance_id);
    match std::fs::read(&file) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Stars::default(),
    }
}

pub fn save(paths: &Paths, instance_id: &str, stars: &Stars) -> Result<()> {
    let file = paths.stars_file(instance_id);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    let bytes = serde_json::to_vec_pretty(stars).map_err(|e| CoreError::Serde {
        what: "stars.json".into(),
        source: e,
    })?;
    std::fs::write(&file, bytes).map_err(|e| CoreError::io(&file, e))
}

pub fn toggle(paths: &Paths, instance_id: &str, kind: StarKind, key: &str) -> Result<bool> {
    let mut stars = load(paths, instance_id);
    let now = stars.toggle(kind, key);
    save(paths, instance_id, &stars)?;
    Ok(now)
}
