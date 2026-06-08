
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Pack {
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    #[serde(rename = "pack-format", default)]
    pub pack_format: String,
    pub index: PackIndex,
    #[serde(default)]
    pub versions: Versions,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PackIndex {
    pub file: String,
    #[serde(rename = "hash-format", default)]
    pub hash_format: String,
    #[serde(default)]
    pub hash: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Versions {
    #[serde(default)]
    pub minecraft: Option<String>,
    #[serde(default)]
    pub neoforge: Option<String>,
    #[serde(default)]
    pub forge: Option<String>,
    #[serde(default)]
    pub fabric: Option<String>,
    #[serde(default)]
    pub quilt: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Index {
    #[serde(rename = "hash-format", default = "default_index_hash_format")]
    pub hash_format: String,
    #[serde(default)]
    pub files: Vec<IndexFile>,
}

fn default_index_hash_format() -> String {
    "sha256".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct IndexFile {
    pub file: String,
    #[serde(default)]
    pub hash: String,
    #[serde(rename = "hash-format", default)]
    pub hash_format: Option<String>,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(default)]
    pub metafile: bool,
    #[serde(default)]
    pub preserve: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetaFile {
    pub name: String,
    pub filename: String,
    #[serde(default = "default_side")]
    pub side: String,
    pub download: Download,
    #[serde(default)]
    pub update: Option<Update>,
}

fn default_side() -> String {
    "both".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct Download {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(rename = "hash-format", default)]
    pub hash_format: String,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Update {
    #[serde(default)]
    pub modrinth: Option<ModrinthUpdate>,
    #[serde(default)]
    pub curseforge: Option<CurseforgeUpdate>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModrinthUpdate {
    #[serde(rename = "mod-id")]
    pub mod_id: String,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CurseforgeUpdate {
    #[serde(rename = "project-id", default)]
    pub project_id: i64,
    #[serde(rename = "file-id", default)]
    pub file_id: i64,
}
