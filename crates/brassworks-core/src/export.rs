use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::paths::Paths;
use crate::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Packwiz,
    Modrinth,
    Curseforge,
}

impl ExportFormat {
    pub fn parse(s: &str) -> Option<ExportFormat> {
        match s.trim().to_ascii_lowercase().as_str() {
            "packwiz" => Some(ExportFormat::Packwiz),
            "modrinth" | "mrpack" => Some(ExportFormat::Modrinth),
            "curseforge" | "cf" => Some(ExportFormat::Curseforge),
            _ => None,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Packwiz => "zip",
            ExportFormat::Modrinth => "mrpack",
            ExportFormat::Curseforge => "zip",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportTreeMod {
    pub path: String,
    pub name: String,
    pub filename: String,
    pub category: String,
    pub side: String,
    pub source: String,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportNode {
    pub rel_path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub default_selected: bool,
    pub children: Vec<ExportNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportTree {
    pub mods: Vec<ExportTreeMod>,
    pub files: Vec<ExportNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportMeta {
    pub name: String,
    #[serde(default)]
    pub author: String,
    pub version: String,
    pub mc_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionalSpec {
    #[serde(default = "default_true")]
    pub default: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExportSelection {
    #[serde(default)]
    pub mods: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub optional: HashMap<String, OptionalSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportConfig {
    pub id: String,
    pub name: String,
    pub format: ExportFormat,
    pub pack_name: String,
    #[serde(default)]
    pub author: String,
    pub version: String,
    pub selection: ExportSelection,
    #[serde(default)]
    pub created_at: u64,
}

fn is_hidden_or_system(name: &str) -> bool {
    name.starts_with('.')
        || name.eq_ignore_ascii_case("thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
}

fn default_selected_root(name: &str) -> bool {
    matches!(
        name,
        "defaultconfigs" | "kubejs" | "scripts" | "mods" | "resourcepacks" | "shaderpacks"
    )
}

pub fn build_file_tree(game_dir: &Path, exclude: &HashSet<String>) -> Vec<ExportNode> {
    let mut roots = Vec::new();
    let entries = match std::fs::read_dir(game_dir) {
        Ok(e) => e,
        Err(_) => return roots,
    };
    let mut items: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    items.sort();
    for path in items {
        let name = match path.file_name() {
            Some(n) => n.to_string_lossy().into_owned(),
            None => continue,
        };
        let Some(node) = node_for(game_dir, &path, default_selected_root(&name), exclude) else {
            continue;
        };
        if node.is_dir
            && node.children.is_empty()
            && (name == "resourcepacks" || name == "shaderpacks")
        {
            continue;
        }
        roots.push(node);
    }
    roots
}

fn node_for(
    game_dir: &Path,
    path: &Path,
    default_selected: bool,
    exclude: &HashSet<String>,
) -> Option<ExportNode> {
    let rel = path.strip_prefix(game_dir).ok()?;
    let rel_path = rel.to_string_lossy().replace('\\', "/");
    let name = path.file_name()?.to_string_lossy().into_owned();
    if is_hidden_or_system(&name) {
        return None;
    }
    let meta = std::fs::metadata(path).ok()?;
    if meta.is_dir() {
        let mut children = Vec::new();
        if let Ok(entries) = std::fs::read_dir(path) {
            let mut items: Vec<_> = entries.flatten().map(|e| e.path()).collect();
            items.sort();
            for child in items {
                if let Some(node) = node_for(game_dir, &child, default_selected, exclude) {
                    children.push(node);
                }
            }
        }
        let size = children.iter().map(|c| c.size).sum();
        Some(ExportNode {
            rel_path,
            name,
            is_dir: true,
            size,
            default_selected,
            children,
        })
    } else if meta.is_file() {
        if exclude.contains(&rel_path) {
            return None;
        }
        Some(ExportNode {
            rel_path,
            name,
            is_dir: false,
            size: meta.len(),
            default_selected,
            children: Vec::new(),
        })
    } else {
        None
    }
}

pub fn is_file_selected(rel_path: &str, selected: &[String]) -> bool {
    selected.iter().any(|sel| {
        sel == rel_path || rel_path.starts_with(&format!("{}/", sel.trim_end_matches('/')))
    })
}

pub fn collect_selected_files(nodes: &[ExportNode], selected: &[String], out: &mut Vec<String>) {
    for node in nodes {
        if node.is_dir {
            collect_selected_files(&node.children, selected, out);
        } else if is_file_selected(&node.rel_path, selected) {
            out.push(node.rel_path.clone());
        }
    }
}

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "modpack".to_string()
    } else {
        trimmed
    }
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn load_configs(paths: &Paths, instance_id: &str) -> Vec<ExportConfig> {
    let path = paths.export_configs(instance_id);
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_configs(paths: &Paths, instance_id: &str, configs: &[ExportConfig]) -> Result<()> {
    let path = paths.export_configs(instance_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    let json =
        serde_json::to_vec_pretty(configs).map_err(|e| CoreError::serde("export configs", e))?;
    std::fs::write(&path, json).map_err(|e| CoreError::io(&path, e))
}

pub fn upsert_config(paths: &Paths, instance_id: &str, config: ExportConfig) -> Result<ExportConfig> {
    let mut configs = load_configs(paths, instance_id);
    match configs.iter_mut().find(|c| c.id == config.id) {
        Some(existing) => *existing = config.clone(),
        None => configs.push(config.clone()),
    }
    save_configs(paths, instance_id, &configs)?;
    Ok(config)
}

pub fn delete_config(paths: &Paths, instance_id: &str, config_id: &str) -> Result<()> {
    let mut configs = load_configs(paths, instance_id);
    configs.retain(|c| c.id != config_id);
    save_configs(paths, instance_id, &configs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_parse_and_extension() {
        assert_eq!(ExportFormat::parse("packwiz"), Some(ExportFormat::Packwiz));
        assert_eq!(ExportFormat::parse("MRPACK"), Some(ExportFormat::Modrinth));
        assert_eq!(ExportFormat::parse("cf"), Some(ExportFormat::Curseforge));
        assert_eq!(ExportFormat::parse("nope"), None);
        assert_eq!(ExportFormat::Packwiz.extension(), "zip");
        assert_eq!(ExportFormat::Modrinth.extension(), "mrpack");
        assert_eq!(ExportFormat::Curseforge.extension(), "zip");
    }

    #[test]
    fn sanitize_filename_strips_specials() {
        assert_eq!(sanitize_filename("My Pack!"), "My-Pack");
        assert_eq!(sanitize_filename("  ***  "), "modpack");
        assert_eq!(sanitize_filename("ok"), "ok");
    }

    #[test]
    fn is_file_selected_matches_exact_and_dir_prefix() {
        let sel = vec!["config".to_string(), "options.txt".to_string()];
        assert!(is_file_selected("config/foo.toml", &sel));
        assert!(is_file_selected("config", &sel));
        assert!(is_file_selected("options.txt", &sel));
        assert!(!is_file_selected("scripts/a.js", &sel));
        assert!(!is_file_selected("configuration/x", &sel));
    }

    #[test]
    fn collect_selected_files_walks_tree() {
        let nodes = vec![ExportNode {
            rel_path: "config".to_string(),
            name: "config".to_string(),
            is_dir: true,
            size: 0,
            default_selected: true,
            children: vec![
                ExportNode {
                    rel_path: "config/a.toml".to_string(),
                    name: "a.toml".to_string(),
                    is_dir: false,
                    size: 1,
                    default_selected: true,
                    children: vec![],
                },
                ExportNode {
                    rel_path: "config/b.toml".to_string(),
                    name: "b.toml".to_string(),
                    is_dir: false,
                    size: 1,
                    default_selected: true,
                    children: vec![],
                },
            ],
        }];
        let mut out = Vec::new();
        collect_selected_files(&nodes, &["config/a.toml".to_string()], &mut out);
        assert_eq!(out, vec!["config/a.toml".to_string()]);

        let mut all = Vec::new();
        collect_selected_files(&nodes, &["config".to_string()], &mut all);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn build_file_tree_reads_disk() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path();
        std::fs::create_dir_all(game.join("config/sub")).unwrap();
        std::fs::write(game.join("config/a.toml"), b"a").unwrap();
        std::fs::write(game.join("config/sub/b.toml"), b"bb").unwrap();
        std::fs::write(game.join("options.txt"), b"opts").unwrap();
        std::fs::create_dir_all(game.join("saves/world")).unwrap();
        std::fs::write(game.join("saves/world/level.dat"), b"x").unwrap();

        std::fs::create_dir_all(game.join("scripts")).unwrap();
        std::fs::write(game.join("scripts/main.js"), b"//").unwrap();

        let tree = build_file_tree(game, &HashSet::new());
        let config = tree.iter().find(|n| n.rel_path == "config").unwrap();
        assert!(config.is_dir);
        assert!(!config.default_selected);
        assert_eq!(config.size, 3);
        let options = tree.iter().find(|n| n.rel_path == "options.txt").unwrap();
        assert!(!options.is_dir);
        assert!(!options.default_selected);
        let scripts = tree.iter().find(|n| n.rel_path == "scripts").unwrap();
        assert!(scripts.default_selected);
        let saves = tree.iter().find(|n| n.rel_path == "saves").unwrap();
        assert!(!saves.default_selected);
    }

    #[test]
    fn build_file_tree_skips_hidden_and_system_files() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path();
        std::fs::create_dir_all(game.join("config")).unwrap();
        std::fs::write(game.join("config/real.toml"), b"a").unwrap();
        std::fs::write(game.join("config/.DS_Store"), b"junk").unwrap();
        std::fs::write(game.join(".fabric_marker"), b"x").unwrap();
        std::fs::create_dir_all(game.join(".fabric")).unwrap();
        std::fs::write(game.join(".fabric/cache"), b"y").unwrap();
        std::fs::write(game.join("Thumbs.db"), b"z").unwrap();

        let tree = build_file_tree(game, &HashSet::new());
        assert!(!tree.iter().any(|n| n.name.starts_with('.')));
        assert!(!tree.iter().any(|n| n.name == "Thumbs.db"));
        let config = tree.iter().find(|n| n.rel_path == "config").unwrap();
        assert_eq!(config.children.len(), 1);
        assert_eq!(config.children[0].name, "real.toml");
    }

    #[test]
    fn build_file_tree_excludes_managed_and_hides_empty_content_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path();
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::write(game.join("mods/managed.jar"), b"m").unwrap();
        std::fs::write(game.join("mods/local.jar"), b"l").unwrap();
        std::fs::create_dir_all(game.join("resourcepacks")).unwrap();
        std::fs::write(game.join("resourcepacks/managed.zip"), b"r").unwrap();
        std::fs::create_dir_all(game.join("shaderpacks")).unwrap();
        std::fs::write(game.join("shaderpacks/managed.zip"), b"s").unwrap();

        let mut exclude = HashSet::new();
        exclude.insert("mods/managed.jar".to_string());
        exclude.insert("resourcepacks/managed.zip".to_string());
        exclude.insert("shaderpacks/managed.zip".to_string());

        let tree = build_file_tree(game, &exclude);
        let mods = tree.iter().find(|n| n.rel_path == "mods").unwrap();
        assert_eq!(mods.children.len(), 1);
        assert_eq!(mods.children[0].rel_path, "mods/local.jar");
        assert!(mods.default_selected);
        assert!(!tree.iter().any(|n| n.rel_path == "resourcepacks"));
        assert!(!tree.iter().any(|n| n.rel_path == "shaderpacks"));
    }

    #[test]
    fn config_crud_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(dir.path());
        assert!(load_configs(&paths, "inst").is_empty());

        let cfg = ExportConfig {
            id: "c1".to_string(),
            name: "My Export".to_string(),
            format: ExportFormat::Packwiz,
            pack_name: "Pack".to_string(),
            author: "swzo".to_string(),
            version: "1.0.0".to_string(),
            selection: ExportSelection {
                mods: vec!["mods/a.jar".to_string()],
                files: vec!["config".to_string()],
                optional: HashMap::new(),
            },
            created_at: 123,
        };
        upsert_config(&paths, "inst", cfg.clone()).unwrap();
        let loaded = load_configs(&paths, "inst");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "My Export");

        let mut updated = cfg.clone();
        updated.name = "Renamed".to_string();
        upsert_config(&paths, "inst", updated).unwrap();
        let loaded = load_configs(&paths, "inst");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "Renamed");

        delete_config(&paths, "inst", "c1").unwrap();
        assert!(load_configs(&paths, "inst").is_empty());
    }
}
