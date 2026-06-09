
use packwiz::{sha512_hex, Curseforge, FileRecord, Manifest, Modrinth};
use serde::Deserialize;

use super::{
    cleanup_stale, extract_overrides, note, open_zip, read_entry_string, record_content,
    PackResult, Progress, SyncProgress, SyncStage,
};
use crate::error::{CoreError, Result};
use crate::instance::LoaderKind;
use crate::paths::Paths;

#[derive(Deserialize)]
struct CfManifest {
    #[serde(default)]
    name: String,
    minecraft: CfMinecraft,
    #[serde(default)]
    files: Vec<CfFile>,
    #[serde(default)]
    overrides: Option<String>,
}

#[derive(Deserialize)]
struct CfMinecraft {
    version: String,
    #[serde(default, rename = "modLoaders")]
    mod_loaders: Vec<CfLoader>,
}

#[derive(Deserialize)]
struct CfLoader {
    #[serde(default)]
    id: String,
    #[serde(default)]
    primary: bool,
}

#[derive(Deserialize)]
struct CfFile {
    #[serde(rename = "projectID")]
    project_id: i64,
    #[serde(rename = "fileID")]
    file_id: i64,
    #[serde(default = "default_true")]
    required: bool,
}

fn default_true() -> bool {
    true
}

fn parse_loader(loaders: &[CfLoader]) -> (LoaderKind, Option<String>) {
    let chosen = loaders
        .iter()
        .find(|l| l.primary)
        .or_else(|| loaders.first());
    let Some(loader) = chosen else {
        return (LoaderKind::Vanilla, None);
    };
    match loader.id.split_once('-') {
        Some((name, ver)) => (LoaderKind::parse(name), Some(ver.to_string())),
        None => (LoaderKind::parse(&loader.id), None),
    }
}

pub fn sync(
    paths: &Paths,
    instance_id: &str,
    zip_url: &str,
    _project_id: &str,
    file_id: &str,
    cf: &Curseforge,
    modrinth: &Modrinth,
    cancel: &dyn Fn() -> bool,
    progress: Progress,
) -> Result<PackResult> {
    note(progress, SyncStage::Fetching, "Downloading modpack");
    let bytes = modrinth.download(zip_url)?;
    install_bytes(paths, instance_id, file_id, bytes, cf, modrinth, cancel, progress)
}

pub fn install_bytes(
    paths: &Paths,
    instance_id: &str,
    file_id: &str,
    bytes: Vec<u8>,
    cf: &Curseforge,
    modrinth: &Modrinth,
    cancel: &dyn Fn() -> bool,
    progress: Progress,
) -> Result<PackResult> {
    let mut archive = open_zip(bytes)?;

    let cf_manifest: CfManifest = serde_json::from_str(&read_entry_string(&mut archive, "manifest.json")?)
        .map_err(|e| CoreError::Modpack(format!("parse manifest.json: {e}")))?;

    let game_dir = paths.instance_game_dir(instance_id);
    let manifest_path = paths.modpack_manifest(instance_id);
    let old = Manifest::load(&manifest_path)?;

    let mc = cf_manifest.minecraft.version.clone();
    let (loader, loader_version) = parse_loader(&cf_manifest.minecraft.mod_loaders);

    let mut manifest = Manifest {
        pack_version: file_id.to_string(),
        minecraft_version: Some(mc.clone()),
        ..Manifest::default()
    };

    let pack_name = if cf_manifest.name.is_empty() {
        "Modpack".to_string()
    } else {
        cf_manifest.name.clone()
    };
    let total = cf_manifest.files.len() as u64;
    let mut failed = Vec::new();
    for (i, f) in cf_manifest.files.iter().enumerate() {
        if cancel() {
            return Err(CoreError::Cancelled);
        }
        if !f.required {
            continue;
        }
        progress(SyncProgress {
            stage: SyncStage::Downloading,
            current: i as u64,
            total,
            message: format!("{pack_name} — file {}/{total}", i + 1),
        });

        let pid = f.project_id.to_string();
        let fid = f.file_id.to_string();
        let resolved = match cf.resolve_version(&pid, &fid) {
            Ok(Some(rv)) => rv,
            _ => {
                failed.push(format!("curseforge:{pid}:{fid}"));
                continue;
            }
        };
        let rel = format!("mods/{}", resolved.filename);
        let data = match modrinth.download(&resolved.url) {
            Ok(d) => d,
            Err(_) => {
                failed.push(rel);
                continue;
            }
        };
        if let Some(exp) = resolved.sha512.as_deref() {
            if !sha512_hex(&data).eq_ignore_ascii_case(exp) {
                failed.push(rel);
                continue;
            }
        }
        let dest = game_dir.join(&rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
        }
        if std::fs::write(&dest, &data).is_err() {
            failed.push(rel);
            continue;
        }
        manifest.files.insert(
            rel.clone(),
            FileRecord {
                hash: sha512_hex(&data),
                hash_format: "sha512".to_string(),
            },
        );
        record_content(
            &mut manifest,
            &rel,
            "curseforge",
            None,
            Some((f.project_id, f.file_id)),
        );
    }

    let overrides = cf_manifest.overrides.as_deref().unwrap_or("overrides");
    note(progress, SyncStage::Downloading, "Extracting overrides");
    extract_overrides(&mut archive, overrides, &game_dir, &mut manifest)?;

    note(progress, SyncStage::Cleaning, "Removing files that left the pack");
    cleanup_stale(&game_dir, &old, &manifest);

    manifest.failed = failed;
    manifest.complete = manifest.failed.is_empty();
    manifest.save(&manifest_path)?;

    note(progress, SyncStage::Done, "Modpack ready");
    Ok(PackResult {
        name: if cf_manifest.name.is_empty() {
            instance_id.to_string()
        } else {
            cf_manifest.name
        },
        version: file_id.to_string(),
        minecraft_version: mc,
        loader,
        loader_version,
        icon_url: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_curseforge_loader_id() {
        let loaders = vec![CfLoader {
            id: "neoforge-21.1.1".to_string(),
            primary: true,
        }];
        let (loader, ver) = parse_loader(&loaders);
        assert_eq!(loader, LoaderKind::NeoForge);
        assert_eq!(ver.as_deref(), Some("21.1.1"));

        let forge = vec![CfLoader {
            id: "forge-43.2.0".to_string(),
            primary: true,
        }];
        assert_eq!(parse_loader(&forge).0, LoaderKind::Forge);
    }
}
