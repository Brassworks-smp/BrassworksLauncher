use packwiz::{sha512_hex, Curseforge, FileRecord, Manifest, Modrinth};
use serde::Deserialize;

use std::sync::atomic::{AtomicBool, Ordering};

use super::{
    already_current, cleanup_stale, extract_overrides, note, open_zip, prettify_name,
    read_entry_string, record_content, write_bytes, BlockedMod, OptionalComponent, OptionalSet,
    PackResult, Progress, SyncProgress, SyncStage,
};

enum CfOutcome {
    Installed { rel: String, hash: String },
    Failed { id: String, reason: String },
}
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

impl CfFile {
    fn id(&self) -> String {
        format!("{}:{}", self.project_id, self.file_id)
    }
}

pub fn inspect_bytes(bytes: Vec<u8>, cf: &Curseforge) -> Result<Vec<OptionalComponent>> {
    let mut archive = open_zip(bytes)?;
    let cf_manifest: CfManifest = serde_json::from_str(&read_entry_string(&mut archive, "manifest.json")?)
        .map_err(|e| CoreError::Modpack(format!("parse manifest.json: {e}")))?;

    let mut out = Vec::new();
    for f in cf_manifest.files.iter().filter(|f| !f.required) {
        let pid = f.project_id.to_string();
        let fid = f.file_id.to_string();
                let name = cf
            .project(&pid)
            .map(|p| p.title)
            .filter(|t| !t.trim().is_empty())
            .or_else(|| {
                cf.resolve_version(&pid, &fid)
                    .ok()
                    .flatten()
                    .map(|rv| prettify_name(&rv.filename))
            })
            .unwrap_or_else(|| format!("Mod {pid}"));
        out.push(OptionalComponent {
            id: f.id(),
            name,
            description: None,
            default: false,
            side: "both".to_string(),
            category: "mods".to_string(),
        });
    }
    Ok(out)
}

pub fn blocked_bytes(bytes: Vec<u8>, cf: &Curseforge) -> Result<Vec<BlockedMod>> {
    let mut archive = open_zip(bytes)?;
    let cf_manifest: CfManifest =
        serde_json::from_str(&read_entry_string(&mut archive, "manifest.json")?)
            .map_err(|e| CoreError::Modpack(format!("parse manifest.json: {e}")))?;

    let wanted: Vec<&CfFile> = cf_manifest.files.iter().collect();

    let file_ids: Vec<i64> = wanted.iter().map(|f| f.file_id).collect();
    let resolved = match cf.resolve_versions_bulk(&file_ids) {
        Ok(r) if !r.is_empty() => r,
        _ => wanted
            .iter()
            .filter_map(|f| {
                cf.resolve_version(&f.project_id.to_string(), &f.file_id.to_string())
                    .ok()
                    .flatten()
            })
            .collect(),
    };
    let by_id: std::collections::HashMap<String, &packwiz::ResolvedVersion> =
        resolved.iter().map(|rv| (rv.version_id.clone(), rv)).collect();

    let mut out = Vec::new();
    for f in wanted {
        if let Some(rv) = by_id.get(&f.file_id.to_string()) {
            if rv.manual_only {
                out.push(blocked_from(cf, f.project_id, f.file_id, f.required, rv));
            }
        }
    }
    Ok(out)
}

fn blocked_from(
    cf: &Curseforge,
    project_id: i64,
    file_id: i64,
    required: bool,
    rv: &packwiz::ResolvedVersion,
) -> BlockedMod {
    let project = cf.project(&project_id.to_string());
    let name = project
        .as_ref()
        .map(|p| p.title.clone())
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| prettify_name(&rv.filename));
    let url = project
        .as_ref()
        .and_then(|p| p.url.clone())
        .map(|w| format!("{}/download/{file_id}", w.trim_end_matches('/')))
        .unwrap_or_else(|| {
            format!("https://www.curseforge.com/projects/{project_id}/files/{file_id}")
        });
    BlockedMod {
        id: format!("{project_id}:{file_id}"),
        project_id: project_id.to_string(),
        file_id: file_id.to_string(),
        filename: rv.filename.clone(),
        name,
        url,
        required,
    }
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

#[allow(clippy::too_many_arguments)]
pub fn sync(
    paths: &Paths,
    instance_id: &str,
    zip_url: &str,
    _project_id: &str,
    file_id: &str,
    optional: &OptionalSet,
    concurrency: usize,
    cf: &Curseforge,
    modrinth: &Modrinth,
    cancel: &dyn Fn() -> bool,
    progress: Progress,
) -> Result<PackResult> {
    note(progress, SyncStage::Fetching, "Downloading modpack");
    let bytes = modrinth.download(zip_url)?;
    install_bytes(paths, instance_id, file_id, bytes, optional, concurrency, cf, modrinth, cancel, progress)
}

#[allow(clippy::too_many_arguments)]
pub fn install_bytes(
    paths: &Paths,
    instance_id: &str,
    file_id: &str,
    bytes: Vec<u8>,
    optional: &OptionalSet,
    concurrency: usize,
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

            let mut selected_optional = Vec::new();
    let mut todo: Vec<&CfFile> = Vec::new();
    for f in &cf_manifest.files {
        if !f.required {
            if !optional.contains(&f.id()) {
                continue;
            }
            selected_optional.push(f.id());
        }
        todo.push(f);
    }

    let cancelled = AtomicBool::new(false);
    let outcomes = packwiz::parallel_run(
        &todo,
        concurrency,
        |f| {
            let id = format!("curseforge:{}:{}", f.project_id, f.file_id);
            if cancelled.load(Ordering::Relaxed) {
                return CfOutcome::Failed {
                    id,
                    reason: "cancelled".to_string(),
                };
            }
            let pid = f.project_id.to_string();
            let fid = f.file_id.to_string();
            let resolved = match cf.resolve_version(&pid, &fid) {
                Ok(Some(rv)) => rv,
                Ok(None) => {
                    return CfOutcome::Failed {
                        id,
                        reason: "no download available (author disabled third-party downloads)"
                            .to_string(),
                    }
                }
                Err(e) => return CfOutcome::Failed { id, reason: e.to_string() },
            };
            let rel = format!("mods/{}", resolved.filename);
            let prev_hash = old.files.get(&rel).map(|r| r.hash.clone());
            if already_current(&game_dir, &rel, prev_hash.as_deref()) {
                return CfOutcome::Installed {
                    rel,
                    hash: prev_hash.unwrap_or_default(),
                };
            }
            if resolved.manual_only {
                let dest = game_dir.join(&rel);
                return match std::fs::read(&dest) {
                    Ok(bytes) => CfOutcome::Installed {
                        rel,
                        hash: sha512_hex(&bytes),
                    },
                    Err(_) => CfOutcome::Failed {
                        id: rel,
                        reason: "manual download required (author disabled third-party downloads)"
                            .to_string(),
                    },
                };
            }
            let data = match modrinth.download(&resolved.url) {
                Ok(d) => d,
                Err(e) => return CfOutcome::Failed { id: rel, reason: e.to_string() },
            };
            if let Some(exp) = resolved.sha512.as_deref() {
                if !sha512_hex(&data).eq_ignore_ascii_case(exp) {
                    return CfOutcome::Failed {
                        id: rel,
                        reason: "hash mismatch (corrupt download)".to_string(),
                    };
                }
            }
            match write_bytes(&game_dir, &rel, &data) {
                Ok(()) => CfOutcome::Installed {
                    rel,
                    hash: sha512_hex(&data),
                },
                Err(e) => CfOutcome::Failed {
                    id: rel,
                    reason: format!("could not write to disk: {e}"),
                },
            }
        },
        |done, total, _| {
            if cancel() {
                cancelled.store(true, Ordering::Relaxed);
            }
            progress(SyncProgress {
                stage: SyncStage::Downloading,
                current: done,
                total,
                message: format!("{pack_name} — {done}/{total} files"),
            });
        },
    );
    if cancelled.load(Ordering::Relaxed) {
        return Err(CoreError::Cancelled);
    }

    let mut failed = Vec::new();
    let mut failures = Vec::new();
    for (f, outcome) in todo.iter().zip(outcomes) {
        match outcome {
            CfOutcome::Installed { rel, hash } => {
                manifest.files.insert(
                    rel.clone(),
                    FileRecord {
                        hash,
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
            CfOutcome::Failed { id, reason } => {
                failed.push(id.clone());
                failures.push(packwiz::FileFailure { path: id, reason });
            }
        }
    }

    let overrides = cf_manifest.overrides.as_deref().unwrap_or("overrides");
    note(progress, SyncStage::Downloading, "Extracting overrides");
    extract_overrides(&mut archive, overrides, &game_dir, &mut manifest)?;

    note(progress, SyncStage::Cleaning, "Removing files that left the pack");
    cleanup_stale(&game_dir, &old, &manifest);

    manifest.failed = failed;
    manifest.failures = failures;
    manifest.optional = selected_optional;
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
    fn detects_optional_files_and_ids() {
        let manifest = r#"{
            "name": "Test Pack",
            "minecraft": { "version": "1.20.1", "modLoaders": [{ "id": "forge-47.2.0", "primary": true }] },
            "files": [
                { "projectID": 111, "fileID": 222, "required": true },
                { "projectID": 333, "fileID": 444, "required": false },
                { "projectID": 555, "fileID": 666 }
            ]
        }"#;
        let cf: CfManifest = serde_json::from_str(manifest).unwrap();
        let optional: Vec<String> = cf
            .files
            .iter()
            .filter(|f| !f.required)
            .map(|f| f.id())
            .collect();
                assert_eq!(optional, vec!["333:444".to_string()]);
    }

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
