use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldInfo {
    pub folder: String,
    pub name: String,
    pub icon: bool,
    pub last_played: i64,
    pub game_mode: i32,
    pub hardcore: bool,
    pub difficulty: i32,
    pub version_name: Option<String>,
    pub size_bytes: u64,
    pub datapack_count: usize,
    #[serde(default)]
    pub seed: Option<i64>,
    #[serde(default)]
    pub starred: bool,
}

#[derive(Debug, Deserialize)]
struct LevelRoot {
    #[serde(rename = "Data")]
    data: Option<LevelData>,
}

#[derive(Debug, Deserialize)]
struct LevelData {
    #[serde(rename = "LevelName")]
    level_name: Option<String>,
    #[serde(rename = "LastPlayed")]
    last_played: Option<i64>,
    #[serde(rename = "GameType")]
    game_type: Option<i32>,
    #[serde(rename = "hardcore")]
    hardcore: Option<i8>,
    #[serde(rename = "Difficulty")]
    difficulty: Option<i8>,
    #[serde(rename = "Version")]
    version: Option<LevelVersion>,
    #[serde(rename = "WorldGenSettings")]
    world_gen_settings: Option<WorldGenSettings>,
    #[serde(rename = "RandomSeed")]
    random_seed: Option<i64>,
    #[serde(rename = "Player")]
    player: Option<PlayerData>,
}

#[derive(Debug, Deserialize)]
struct WorldGenSettings {
    seed: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct PlayerData {
    #[serde(rename = "playerGameType")]
    player_game_type: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct LevelVersion {
    #[serde(rename = "Name")]
    name: Option<String>,
}

pub fn list_worlds(saves_dir: &Path) -> Vec<WorldInfo> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(saves_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let level = dir.join("level.dat");
        if !level.exists() {
            continue;
        }
        let folder = match dir.file_name().and_then(|n| n.to_str()) {
            Some(f) => f.to_string(),
            None => continue,
        };
        let data = read_level_dat(&level);
        let datapack_count = std::fs::read_dir(dir.join("datapacks"))
            .map(|rd| rd.flatten().filter(|e| !is_hidden(&e.path())).count())
            .unwrap_or(0);
        out.push(WorldInfo {
            name: data
                .as_ref()
                .and_then(|d| d.level_name.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| folder.clone()),
            icon: dir.join("icon.png").exists(),
            last_played: data.as_ref().and_then(|d| d.last_played).unwrap_or(0),
            game_mode: data
                .as_ref()
                .and_then(|d| {
                    d.player
                        .as_ref()
                        .and_then(|p| p.player_game_type)
                        .or(d.game_type)
                })
                .unwrap_or(-1),
            hardcore: data.as_ref().and_then(|d| d.hardcore).unwrap_or(0) != 0,
            difficulty: data
                .as_ref()
                .and_then(|d| d.difficulty)
                .map(|d| d as i32)
                .unwrap_or(-1),
            version_name: data.as_ref().and_then(|d| d.version.as_ref()).and_then(|v| v.name.clone()),
            seed: data.as_ref().and_then(|d| {
                d.world_gen_settings
                    .as_ref()
                    .and_then(|w| w.seed)
                    .or(d.random_seed)
            }),
            size_bytes: dir_size(&dir),
            datapack_count,
            folder,
            starred: false,
        });
    }
    out.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    out
}

fn read_level_dat(path: &Path) -> Option<LevelData> {
    let raw = std::fs::read(path).ok()?;
    let mut decoder = flate2::read::GzDecoder::new(&raw[..]);
    let mut buf = Vec::new();
    if decoder.read_to_end(&mut buf).is_err() {
        buf = raw;
    }
    fastnbt::from_bytes::<LevelRoot>(&buf).ok()?.data
}

pub fn world_icon_path(saves_dir: &Path, folder: &str) -> Option<PathBuf> {
    if !safe_name(folder) {
        return None;
    }
    let p = saves_dir.join(folder).join("icon.png");
    p.exists().then_some(p)
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBackup {
    pub filename: String,
    pub size_bytes: u64,
    pub modified: i64,
}

pub fn zip_world(saves_dir: &Path, world: &str) -> Result<Vec<u8>> {
    use std::io::Write;
    if !safe_name(world) {
        return Err(CoreError::Modpack("invalid world folder".into()));
    }
    let root = saves_dir.join(world);
    if !root.is_dir() {
        return Err(CoreError::Modpack("world not found".into()));
    }
    let zip_err = |e: zip::result::ZipError| CoreError::Modpack(format!("zip: {e}"));
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = zip::write::SimpleFileOptions::default();
        let mut stack = vec![root.clone()];
        while let Some(d) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&d) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                match entry.file_type() {
                    Ok(ft) if ft.is_dir() => stack.push(path),
                    Ok(ft) if ft.is_file() => {
                        let rel = path.strip_prefix(saves_dir).unwrap_or(&path);
                        let name = rel.to_string_lossy().replace('\\', "/");
                        if let Ok(bytes) = std::fs::read(&path) {
                            zip.start_file(name, opts).map_err(zip_err)?;
                            zip.write_all(&bytes)
                                .map_err(|e| CoreError::Modpack(format!("zip write: {e}")))?;
                        }
                    }
                    _ => {}
                }
            }
        }
        zip.finish().map_err(zip_err)?;
    }
    Ok(buf)
}

pub fn backup_world(saves_dir: &Path, game_dir: &Path, world: &str) -> Result<String> {
    let bytes = zip_world(saves_dir, world)?;
    let dir = game_dir.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let filename = format!("{world}_{stamp}.zip");
    let dest = dir.join(&filename);
    std::fs::write(&dest, bytes).map_err(|e| CoreError::io(&dest, e))?;
    Ok(filename)
}

pub fn list_backups(game_dir: &Path) -> Vec<WorldBackup> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(game_dir.join("backups")) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if n.to_lowercase().ends_with(".zip") => n.to_string(),
            _ => continue,
        };
        let meta = entry.metadata().ok();
        out.push(WorldBackup {
            size_bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified: meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
            filename: name,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

pub fn delete_world(saves_dir: &Path, folder: &str) -> Result<()> {
    if !safe_name(folder) {
        return Err(CoreError::Modpack("invalid world folder".into()));
    }
    let dir = saves_dir.join(folder);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
    }
    Ok(())
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatapackInfo {
    pub filename: String,
    pub name: String,
    pub enabled: bool,
    pub is_dir: bool,
    pub size_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackedDatapack {
    pub source: String,
    pub project_id: String,
    #[serde(default)]
    pub version_id: String,
    pub filename: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct DatapackIndex {
    #[serde(default)]
    worlds: std::collections::HashMap<String, Vec<TrackedDatapack>>,
}

fn load_index(index_file: &Path) -> DatapackIndex {
    std::fs::read(index_file)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_index(index_file: &Path, index: &DatapackIndex) -> Result<()> {
    if let Some(parent) = index_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    let bytes = serde_json::to_vec_pretty(index).map_err(|e| CoreError::Serde {
        what: "datapacks.json".into(),
        source: e,
    })?;
    std::fs::write(index_file, bytes).map_err(|e| CoreError::io(index_file, e))
}

#[allow(clippy::too_many_arguments)]
pub fn record_datapack(
    index_file: &Path,
    world: &str,
    source: &str,
    project_id: &str,
    version_id: &str,
    filename: &str,
    title: Option<String>,
    description: Option<String>,
    icon_url: Option<String>,
) -> Result<()> {
    let mut index = load_index(index_file);
    let bucket = index.worlds.entry(world.to_string()).or_default();
    bucket.retain(|t| t.filename != filename && t.project_id != project_id);
    bucket.push(TrackedDatapack {
        source: source.to_string(),
        project_id: project_id.to_string(),
        version_id: version_id.to_string(),
        filename: filename.to_string(),
        title,
        description,
        icon_url,
    });
    save_index(index_file, &index)
}

pub fn tracked_filename(index_file: &Path, world: &str, project_id: &str) -> Option<String> {
    load_index(index_file)
        .worlds
        .get(world)?
        .iter()
        .find(|t| t.project_id == project_id)
        .map(|t| t.filename.clone())
}

fn forget_datapack(index_file: &Path, world: &str, filename: &str) {
    let mut index = load_index(index_file);
    if let Some(bucket) = index.worlds.get_mut(world) {
        let base = filename.trim_end_matches(".disabled");
        bucket.retain(|t| t.filename != filename && t.filename != base);
        let _ = save_index(index_file, &index);
    }
}

pub fn datapacks_dir(saves_dir: &Path, world: &str) -> PathBuf {
    saves_dir.join(world).join("datapacks")
}

pub fn list_datapacks(saves_dir: &Path, world: &str, index_file: &Path) -> Vec<DatapackInfo> {
    let mut out = Vec::new();
    if !safe_name(world) {
        return out;
    }
    let index = load_index(index_file);
    let tracked = index.worlds.get(world);
    let dir = datapacks_dir(saves_dir, world);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if is_hidden(&path) {
            continue;
        }
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(f) => f.to_string(),
            None => continue,
        };
        let enabled = !filename.ends_with(".disabled");
        let base = filename.trim_end_matches(".disabled");
        let name = base
            .trim_end_matches(".zip")
            .replace(['_', '-'], " ")
            .trim()
            .to_string();
        let is_dir = path.is_dir();
        let meta = tracked.and_then(|t| t.iter().find(|t| t.filename == base || t.filename == filename));
        out.push(DatapackInfo {
            size_bytes: if is_dir { dir_size(&path) } else { entry.metadata().map(|m| m.len()).unwrap_or(0) },
            name: meta
                .and_then(|m| m.title.clone())
                .unwrap_or_else(|| if name.is_empty() { base.to_string() } else { name }),
            filename,
            enabled,
            is_dir,
            source: meta.map(|m| m.source.clone()),
            project_id: meta.map(|m| m.project_id.clone()),
            version_id: meta.map(|m| m.version_id.clone()),
            title: meta.and_then(|m| m.title.clone()),
            description: meta.and_then(|m| m.description.clone()),
            icon_url: meta.and_then(|m| m.icon_url.clone()),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn set_datapack_enabled(saves_dir: &Path, world: &str, filename: &str, enabled: bool) -> Result<()> {
    if !safe_name(world) || !safe_name(filename) {
        return Err(CoreError::Modpack("invalid datapack name".into()));
    }
    let dir = datapacks_dir(saves_dir, world);
    let current = dir.join(filename);
    let target = if enabled {
        dir.join(filename.trim_end_matches(".disabled"))
    } else if filename.ends_with(".disabled") {
        return Ok(());
    } else {
        dir.join(format!("{filename}.disabled"))
    };
    if current.exists() && current != target {
        std::fs::rename(&current, &target).map_err(|e| CoreError::io(&target, e))?;
    }
    Ok(())
}

pub fn remove_datapack(
    saves_dir: &Path,
    world: &str,
    filename: &str,
    index_file: &Path,
) -> Result<()> {
    if !safe_name(world) || !safe_name(filename) {
        return Err(CoreError::Modpack("invalid datapack name".into()));
    }
    let path = datapacks_dir(saves_dir, world).join(filename);
    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| CoreError::io(&path, e))?;
    } else if path.exists() {
        std::fs::remove_file(&path).map_err(|e| CoreError::io(&path, e))?;
    }
    forget_datapack(index_file, world, filename);
    Ok(())
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEntry {
    pub name: String,
    pub ip: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accept_textures: Option<i8>,
    #[serde(default)]
    pub featured: bool,
    #[serde(default)]
    pub starred: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ServersFile {
    #[serde(default)]
    servers: Vec<ServerNbt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServerNbt {
    name: String,
    ip: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(rename = "acceptTextures", default, skip_serializing_if = "Option::is_none")]
    accept_textures: Option<i8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hidden: Option<i8>,
}

pub fn read_servers(servers_file: &Path) -> Vec<ServerEntry> {
    let Ok(raw) = std::fs::read(servers_file) else {
        return Vec::new();
    };
    let parsed: ServersFile = match fastnbt::from_bytes(&raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    parsed
        .servers
        .into_iter()
        .filter(|s| s.hidden.unwrap_or(0) == 0)
        .map(|s| ServerEntry {
            name: s.name,
            ip: s.ip,
            icon: s.icon,
            accept_textures: s.accept_textures,
            featured: false,
            starred: false,
        })
        .collect()
}

pub fn write_servers(servers_file: &Path, entries: &[ServerEntry]) -> Result<()> {
    if let Some(parent) = servers_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    let file = ServersFile {
        servers: entries
            .iter()
            .filter(|e| !e.featured) 
            .map(|e| ServerNbt {
                name: e.name.clone(),
                ip: e.ip.clone(),
                icon: e.icon.clone(),
                accept_textures: e.accept_textures,
                hidden: None,
            })
            .collect(),
    };
    let bytes = fastnbt::to_bytes(&file)
        .map_err(|e| CoreError::Modpack(format!("failed to write servers.dat: {e}")))?;
    std::fs::write(servers_file, bytes).map_err(|e| CoreError::io(servers_file, e))
}

pub fn server_key(name: &str, ip: &str) -> String {
    format!("{name}\u{1}{ip}")
}


fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(true)
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        for entry in entries.flatten() {
            match entry.file_type() {
                Ok(ft) if ft.is_dir() => stack.push(entry.path()),
                Ok(ft) if ft.is_file() => {
                    total += entry.metadata().map(|m| m.len()).unwrap_or(0);
                }
                _ => {}
            }
        }
    }
    total
}

#[cfg(test)]
mod saves_tests {
    use super::*;

    #[test]
    fn server_key_uses_unit_separator() {
        assert_eq!(server_key("Home", "1.2.3.4"), "Home\u{1}1.2.3.4");
        assert_ne!(server_key("a", "bc"), server_key("ab", "c"));
    }

    #[test]
    fn safe_name_accepts_plain_names() {
        assert!(safe_name("world"));
        assert!(safe_name("My World 1"));
        assert!(safe_name("ok-name_1"));
    }

    #[test]
    fn safe_name_rejects_traversal() {
        assert!(!safe_name(""));
        assert!(!safe_name("a/b"));
        assert!(!safe_name("a\\b"));
        assert!(!safe_name(".."));
        assert!(!safe_name("a..b"));
    }

    #[test]
    fn is_hidden_dotfiles() {
        assert!(is_hidden(Path::new(".git")));
        assert!(is_hidden(Path::new("dir/.hidden")));
        assert!(!is_hidden(Path::new("visible")));
        assert!(!is_hidden(Path::new("dir/visible.txt")));
    }

    #[test]
    fn is_hidden_empty_path() {
        assert!(is_hidden(Path::new("")));
    }

    #[test]
    fn datapacks_dir_layout() {
        let saves = Path::new("root").join("saves");
        assert_eq!(
            datapacks_dir(&saves, "world1"),
            saves.join("world1").join("datapacks")
        );
    }

    #[test]
    fn read_servers_missing_file_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("servers.dat");
        assert!(read_servers(&file).is_empty());
    }

    #[test]
    fn write_then_read_servers_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested").join("servers.dat");
        let entries = vec![
            ServerEntry {
                name: "Alpha".to_string(),
                ip: "alpha.example:25565".to_string(),
                icon: Some("iconA".to_string()),
                accept_textures: Some(1),
                featured: false,
                starred: false,
            },
            ServerEntry {
                name: "Beta".to_string(),
                ip: "beta.example".to_string(),
                icon: None,
                accept_textures: None,
                featured: false,
                starred: false,
            },
        ];
        write_servers(&file, &entries).unwrap();
        let read = read_servers(&file);
        assert_eq!(read.len(), 2);
        let alpha = read.iter().find(|s| s.name == "Alpha").unwrap();
        assert_eq!(alpha.ip, "alpha.example:25565");
        assert_eq!(alpha.icon.as_deref(), Some("iconA"));
        let beta = read.iter().find(|s| s.name == "Beta").unwrap();
        assert_eq!(beta.ip, "beta.example");
        assert!(beta.icon.is_none());
    }

    #[test]
    fn write_servers_drops_featured() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("servers.dat");
        let entries = vec![
            ServerEntry {
                name: "Kept".to_string(),
                ip: "kept".to_string(),
                icon: None,
                accept_textures: None,
                featured: false,
                starred: false,
            },
            ServerEntry {
                name: "Featured".to_string(),
                ip: "featured".to_string(),
                icon: None,
                accept_textures: None,
                featured: true,
                starred: false,
            },
        ];
        write_servers(&file, &entries).unwrap();
        let read = read_servers(&file);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].name, "Kept");
    }

    #[test]
    fn read_servers_defaults_flags_false() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("servers.dat");
        write_servers(
            &file,
            &[ServerEntry {
                name: "S".to_string(),
                ip: "ip".to_string(),
                icon: None,
                accept_textures: None,
                featured: false,
                starred: true,
            }],
        )
        .unwrap();
        let read = read_servers(&file);
        assert!(!read[0].featured);
        assert!(!read[0].starred);
    }
}
