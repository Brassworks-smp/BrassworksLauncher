
mod curseforge;
mod mrpack;

use std::io::{Cursor, Read};
use std::path::Path;

use packwiz::{sha512_hex, Curseforge, FileRecord, ManagedMod, Manifest, Modrinth};

use crate::error::{CoreError, Result};
use crate::instance::{LoaderKind, PackSource};
use crate::paths::Paths;

pub use packwiz::{SyncProgress, SyncStage};

#[derive(Debug, Clone)]
pub struct PackResult {
    pub name: String,
    pub version: String,
    pub minecraft_version: String,
    pub loader: LoaderKind,
    pub loader_version: Option<String>,
    pub icon_url: Option<String>,
}

type Progress<'a> = &'a mut dyn FnMut(SyncProgress);

fn note(progress: Progress, stage: SyncStage, message: impl Into<String>) {
    progress(SyncProgress {
        stage,
        current: 0,
        total: 0,
        message: message.into(),
    });
}

pub fn sync_pack(
    paths: &Paths,
    instance_id: &str,
    pack: &PackSource,
    modrinth: &Modrinth,
    cf: Option<&Curseforge>,
    cancel: &dyn Fn() -> bool,
    progress: Progress,
) -> Result<PackResult> {
    match pack {
        PackSource::Modrinth { version_id, .. } => {
            let rv = modrinth
                .resolve_version(version_id)?
                .ok_or_else(|| CoreError::Modpack("Modpack version not found".to_string()))?;
            mrpack::sync(paths, instance_id, &rv.url, version_id, modrinth, cancel, progress)
        }
        PackSource::Curseforge {
            project_id,
            file_id,
        } => {
            let cf = cf.ok_or_else(|| {
                CoreError::Modpack("A CurseForge API key is required".to_string())
            })?;
            let rv = cf
                .resolve_version(project_id, file_id)?
                .ok_or_else(|| CoreError::Modpack("Modpack file not found".to_string()))?;
            curseforge::sync(
                paths, instance_id, &rv.url, project_id, file_id, cf, modrinth, cancel, progress,
            )
        }
        _ => Err(CoreError::Modpack(
            "This instance has no downloadable modpack".to_string(),
        )),
    }
}

pub fn install_file(
    paths: &Paths,
    instance_id: &str,
    source: &str,
    bytes: Vec<u8>,
    modrinth: &Modrinth,
    cf: Option<&Curseforge>,
    cancel: &dyn Fn() -> bool,
    progress: Progress,
) -> Result<PackResult> {
    if source == "curseforge" {
        let cf = cf.ok_or_else(|| {
            CoreError::Modpack("A CurseForge API key is required".to_string())
        })?;
        curseforge::install_bytes(paths, instance_id, "manual", bytes, cf, modrinth, cancel, progress)
    } else {
        mrpack::install_bytes(paths, instance_id, "manual", bytes, modrinth, cancel, progress)
    }
}


fn open_zip(bytes: Vec<u8>) -> Result<zip::ZipArchive<Cursor<Vec<u8>>>> {
    zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| CoreError::Modpack(format!("open modpack archive: {e}")))
}

fn read_entry_string(archive: &mut zip::ZipArchive<Cursor<Vec<u8>>>, name: &str) -> Result<String> {
    let mut file = archive
        .by_name(name)
        .map_err(|_| CoreError::Modpack(format!("modpack is missing {name}")))?;
    let mut s = String::new();
    file.read_to_string(&mut s)
        .map_err(|e| CoreError::Modpack(format!("read {name}: {e}")))?;
    Ok(s)
}

fn extract_overrides(
    archive: &mut zip::ZipArchive<Cursor<Vec<u8>>>,
    prefix: &str,
    game_dir: &Path,
    manifest: &mut Manifest,
) -> Result<()> {
    let prefix = format!("{}/", prefix.trim_end_matches('/'));
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| CoreError::Modpack(format!("read archive entry: {e}")))?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name().map(|p| p.to_string_lossy().to_string()) else {
            continue;
        };
        let Some(rel) = name.strip_prefix(&prefix) else {
            continue;
        };
        if rel.is_empty() {
            continue;
        }
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| CoreError::Modpack(format!("read {name}: {e}")))?;
        write_tracked(game_dir, rel, &bytes, manifest)?;
        record_content(manifest, rel, "local", None, None);
    }
    Ok(())
}

pub(super) fn record_content(
    manifest: &mut Manifest,
    rel: &str,
    source: &str,
    modrinth: Option<(String, String)>,
    curseforge: Option<(i64, i64)>,
) {
    let folder = rel.split('/').next().unwrap_or("");
    if !matches!(folder, "mods" | "resourcepacks" | "shaderpacks") {
        return;
    }
    if !(rel.ends_with(".jar") || rel.ends_with(".zip")) {
        return;
    }
    if manifest.mods.iter().any(|m| m.path == rel) {
        return;
    }
    let filename = rel.rsplit('/').next().unwrap_or(rel).to_string();
    let (modrinth_id, modrinth_version) = match modrinth {
        Some((p, v)) => (Some(p), Some(v)),
        None => (None, None),
    };
    let (curseforge_id, curseforge_file) = match curseforge {
        Some((p, f)) => (Some(p), Some(f)),
        None => (None, None),
    };
    manifest.mods.push(ManagedMod {
        name: filename.clone(),
        filename,
        path: rel.to_string(),
        side: "client".to_string(),
        category: folder.to_string(),
        modrinth_id,
        modrinth_version,
        source: source.to_string(),
        curseforge_id,
        curseforge_file,
    });
}

fn write_tracked(game_dir: &Path, rel: &str, bytes: &[u8], manifest: &mut Manifest) -> Result<()> {
    let dest = game_dir.join(rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    std::fs::write(&dest, bytes).map_err(|e| CoreError::io(&dest, e))?;
    manifest.files.insert(
        rel.to_string(),
        FileRecord {
            hash: sha512_hex(bytes),
            hash_format: "sha512".to_string(),
        },
    );
    Ok(())
}

fn already_current(game_dir: &Path, rel: &str, expected: Option<&str>) -> bool {
    let Some(expected) = expected else {
        return false;
    };
    let path = game_dir.join(rel);
    match std::fs::read(&path) {
        Ok(bytes) => sha512_hex(&bytes).eq_ignore_ascii_case(expected),
        Err(_) => false,
    }
}

fn cleanup_stale(game_dir: &Path, old: &Manifest, new: &Manifest) {
    for path in old.files.keys() {
        if !new.files.contains_key(path) {
            let _ = std::fs::remove_file(game_dir.join(path));
        }
    }
}
