
use std::collections::HashMap;

use packwiz::{sha512_hex, FileRecord, Manifest, Modrinth};
use serde::Deserialize;

use super::{
    already_current, cleanup_stale, extract_overrides, note, open_zip, read_entry_string,
    record_content, write_tracked, PackResult, Progress, SyncProgress, SyncStage,
};
use crate::error::{CoreError, Result};
use crate::instance::LoaderKind;
use crate::paths::Paths;

#[derive(Deserialize)]
struct Index {
    #[serde(default)]
    name: String,
    #[serde(default)]
    files: Vec<IndexFile>,
    #[serde(default)]
    dependencies: HashMap<String, String>,
}

#[derive(Deserialize)]
struct IndexFile {
    path: String,
    #[serde(default)]
    hashes: Hashes,
    #[serde(default)]
    env: Option<Env>,
    #[serde(default)]
    downloads: Vec<String>,
}

#[derive(Deserialize, Default)]
struct Hashes {
    #[serde(default)]
    sha512: Option<String>,
}

#[derive(Deserialize)]
struct Env {
    #[serde(default)]
    client: String,
}

fn detect_loader(deps: &HashMap<String, String>) -> (LoaderKind, Option<String>) {
    for (key, kind) in [
        ("neoforge", LoaderKind::NeoForge),
        ("forge", LoaderKind::Forge),
        ("fabric-loader", LoaderKind::Fabric),
        ("quilt-loader", LoaderKind::Quilt),
    ] {
        if let Some(v) = deps.get(key) {
            return (kind, Some(v.clone()));
        }
    }
    (LoaderKind::Vanilla, None)
}

pub fn sync(
    paths: &Paths,
    instance_id: &str,
    mrpack_url: &str,
    version_id: &str,
    modrinth: &Modrinth,
    cancel: &dyn Fn() -> bool,
    progress: Progress,
) -> Result<PackResult> {
    note(progress, SyncStage::Fetching, "Downloading modpack");
    let bytes = modrinth.download(mrpack_url)?;
    install_bytes(paths, instance_id, version_id, bytes, modrinth, cancel, progress)
}

pub fn install_bytes(
    paths: &Paths,
    instance_id: &str,
    version_id: &str,
    bytes: Vec<u8>,
    modrinth: &Modrinth,
    cancel: &dyn Fn() -> bool,
    progress: Progress,
) -> Result<PackResult> {
    let mut archive = open_zip(bytes)?;

    let index: Index = serde_json::from_str(&read_entry_string(&mut archive, "modrinth.index.json")?)
        .map_err(|e| CoreError::Modpack(format!("parse modrinth.index.json: {e}")))?;

    let game_dir = paths.instance_game_dir(instance_id);
    let manifest_path = paths.modpack_manifest(instance_id);
    let old = Manifest::load(&manifest_path)?;

    let mc = index
        .dependencies
        .get("minecraft")
        .cloned()
        .unwrap_or_default();
    let (loader, loader_version) = detect_loader(&index.dependencies);

    let mut manifest = Manifest {
        pack_version: version_id.to_string(),
        minecraft_version: Some(mc.clone()),
        ..Manifest::default()
    };

    let hashes: Vec<String> = index
        .files
        .iter()
        .filter_map(|f| f.hashes.sha512.clone())
        .collect();
    let resolved = modrinth.version_files(&hashes);
    let record = |manifest: &mut Manifest, path: &str, sha: Option<&str>| {
        let mr = sha.and_then(|h| resolved.get(h)).cloned();
        let source = if mr.is_some() { "modrinth" } else { "local" };
        record_content(manifest, path, source, mr, None);
    };

    let total = index.files.len() as u64;
    let mut failed = Vec::new();
    for (i, f) in index.files.iter().enumerate() {
        if cancel() {
            return Err(CoreError::Cancelled);
        }
        if let Some(env) = &f.env {
            if env.client == "unsupported" {
                continue;
            }
        }
        progress(SyncProgress {
            stage: SyncStage::Downloading,
            current: i as u64,
            total,
            message: f.path.clone(),
        });

        let expected = f.hashes.sha512.as_deref();
        if already_current(&game_dir, &f.path, expected) {
            if let Some(hash) = expected {
                manifest.files.insert(
                    f.path.clone(),
                    FileRecord {
                        hash: hash.to_string(),
                        hash_format: "sha512".to_string(),
                    },
                );
            }
            record(&mut manifest, &f.path, expected);
            continue;
        }

        let Some(url) = f.downloads.first() else {
            failed.push(f.path.clone());
            continue;
        };
        match modrinth.download(url) {
            Ok(data) => {
                if let Some(exp) = expected {
                    if !sha512_hex(&data).eq_ignore_ascii_case(exp) {
                        failed.push(f.path.clone());
                        continue;
                    }
                }
                match write_tracked(&game_dir, &f.path, &data, &mut manifest) {
                    Ok(()) => record(&mut manifest, &f.path, expected),
                    Err(_) => failed.push(f.path.clone()),
                }
            }
            Err(_) => failed.push(f.path.clone()),
        }
    }

    note(progress, SyncStage::Downloading, "Extracting overrides");
    extract_overrides(&mut archive, "overrides", &game_dir, &mut manifest)?;
    extract_overrides(&mut archive, "client-overrides", &game_dir, &mut manifest)?;

    note(progress, SyncStage::Cleaning, "Removing files that left the pack");
    cleanup_stale(&game_dir, &old, &manifest);

    manifest.failed = failed;
    manifest.complete = manifest.failed.is_empty();
    manifest.save(&manifest_path)?;

    note(progress, SyncStage::Done, "Modpack ready");
    Ok(PackResult {
        name: if index.name.is_empty() {
            instance_id.to_string()
        } else {
            index.name
        },
        version: version_id.to_string(),
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
    fn detects_loader_from_dependencies() {
        let mut deps = HashMap::new();
        deps.insert("minecraft".to_string(), "1.20.1".to_string());
        deps.insert("fabric-loader".to_string(), "0.15.0".to_string());
        let (loader, ver) = detect_loader(&deps);
        assert_eq!(loader, LoaderKind::Fabric);
        assert_eq!(ver.as_deref(), Some("0.15.0"));

        let mut neo = HashMap::new();
        neo.insert("neoforge".to_string(), "21.1.1".to_string());
        assert_eq!(detect_loader(&neo).0, LoaderKind::NeoForge);
    }
}
