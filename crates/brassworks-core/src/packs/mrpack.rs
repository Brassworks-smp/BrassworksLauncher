use std::collections::HashMap;

use packwiz::{sha512_hex, FileRecord, Manifest, Modrinth};
use serde::Deserialize;

use std::sync::atomic::Ordering;

use super::{
    already_current, cleanup_stale, extract_overrides, note, open_zip, prettify_name,
    read_entry_string, record_content, side_label, write_bytes, FileOutcome, OptionalComponent,
    OptionalSet, PackResult, Progress, SyncProgress, SyncStage,
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

#[derive(Deserialize, Default)]
struct Env {
    #[serde(default)]
    client: String,
    #[serde(default)]
    server: String,
}

impl IndexFile {
        fn is_optional(&self) -> bool {
        self.env
            .as_ref()
            .is_some_and(|e| e.client == "optional" || e.server == "optional")
    }

        fn unsupported_on_client(&self) -> bool {
        self.env.as_ref().is_some_and(|e| e.client == "unsupported")
    }
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

pub fn inspect_bytes(bytes: Vec<u8>) -> Result<Vec<OptionalComponent>> {
    let mut archive = open_zip(bytes)?;
    let index: Index = serde_json::from_str(&read_entry_string(&mut archive, "modrinth.index.json")?)
        .map_err(|e| CoreError::Modpack(format!("parse modrinth.index.json: {e}")))?;
    Ok(index
        .files
        .iter()
        .filter(|f| f.is_optional())
        .map(|f| {
            let env = f.env.as_ref();
            OptionalComponent {
                id: f.path.clone(),
                name: prettify_name(&f.path),
                description: None,
                default: false,
                side: side_label(
                    env.map(|e| e.client.as_str()).unwrap_or(""),
                    env.map(|e| e.server.as_str()).unwrap_or(""),
                ),
                category: f.path.split('/').next().unwrap_or("mods").to_string(),
            }
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
pub fn sync(
    paths: &Paths,
    instance_id: &str,
    mrpack_url: &str,
    version_id: &str,
    optional: &OptionalSet,
    concurrency: usize,
    modrinth: &Modrinth,
    cancel: &dyn Fn() -> bool,
    progress: Progress,
) -> Result<PackResult> {
    let bytes =
        super::fetch_archive(paths, "modrinth", version_id, mrpack_url, modrinth, cancel, progress)?;
    let result = install_bytes(
        paths, instance_id, version_id, bytes, optional, concurrency, modrinth, cancel, progress,
    )?;
    super::clear_archive_cache(paths, "modrinth", version_id);
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
pub fn install_bytes(
    paths: &Paths,
    instance_id: &str,
    version_id: &str,
    bytes: Vec<u8>,
    optional: &OptionalSet,
    concurrency: usize,
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

        let mut selected_optional = Vec::new();
    let mut todo: Vec<&IndexFile> = Vec::new();
    for f in &index.files {
        if f.unsupported_on_client() {
            continue;
        }
        if f.is_optional() {
            if !optional.contains(&f.path) {
                continue;
            }
            selected_optional.push(f.path.clone());
        }
        todo.push(f);
    }

    let outcomes = packwiz::parallel_run(
        &todo,
        concurrency,
        || cancel(),
        |f, stop| {
            if stop.load(Ordering::Relaxed) {
                return FileOutcome::Failed("cancelled".to_string());
            }
            let expected = f.hashes.sha512.as_deref();
            if already_current(&game_dir, &f.path, expected) {
                return FileOutcome::AlreadyCurrent;
            }
            let Some(url) = f.downloads.first() else {
                return FileOutcome::Failed("no download URL in modpack index".to_string());
            };
            let data = match modrinth.download_until(url, stop) {
                Ok(d) => d,
                Err(e) => return FileOutcome::Failed(e.to_string()),
            };
            if let Some(exp) = expected {
                if !sha512_hex(&data).eq_ignore_ascii_case(exp) {
                    return FileOutcome::Failed("hash mismatch (corrupt download)".to_string());
                }
            }
            match write_bytes(&game_dir, &f.path, &data) {
                Ok(()) => FileOutcome::Installed(sha512_hex(&data)),
                Err(e) => FileOutcome::Failed(format!("could not write to disk: {e}")),
            }
        },
        |done, total, j| {
            progress(SyncProgress {
                stage: SyncStage::Downloading,
                current: done,
                total,
                message: todo[j].path.clone(),
            });
        },
    );
    if cancel() {
        return Err(CoreError::Cancelled);
    }

        let mut failed = Vec::new();
    let mut failures = Vec::new();
    for (f, outcome) in todo.iter().zip(&outcomes) {
        let expected = f.hashes.sha512.as_deref();
        match outcome {
            FileOutcome::AlreadyCurrent => {
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
            }
            FileOutcome::Installed(hash) => {
                manifest.files.insert(
                    f.path.clone(),
                    FileRecord {
                        hash: hash.clone(),
                        hash_format: "sha512".to_string(),
                    },
                );
                record(&mut manifest, &f.path, expected);
            }
            FileOutcome::Failed(reason) => {
                failed.push(f.path.clone());
                failures.push(packwiz::FileFailure {
                    path: f.path.clone(),
                    reason: reason.clone(),
                });
            }
        }
    }

    note(progress, SyncStage::Downloading, "Extracting overrides");
    extract_overrides(&mut archive, "overrides", &game_dir, &mut manifest)?;
    extract_overrides(&mut archive, "client-overrides", &game_dir, &mut manifest)?;

    note(progress, SyncStage::Cleaning, "Removing files that left the pack");
    cleanup_stale(&game_dir, &old, &manifest);

    manifest.failed = failed;
    manifest.failures = failures;
    manifest.optional = selected_optional;
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
    use std::io::Write;

        fn mrpack_with(index: &str) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file("modrinth.index.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(index.as_bytes()).unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn inspect_finds_optional_mods() {
        let index = r#"{
            "name": "Test Pack",
            "dependencies": { "minecraft": "1.20.1", "fabric-loader": "0.15.0" },
            "files": [
                { "path": "mods/required.jar", "downloads": ["http://x"],
                  "env": { "client": "required", "server": "required" } },
                { "path": "mods/iris-1.7.6+mc1.20.1.jar", "downloads": ["http://x"],
                  "env": { "client": "optional", "server": "unsupported" } },
                { "path": "mods/server-only.jar", "downloads": ["http://x"],
                  "env": { "client": "unsupported", "server": "required" } }
            ]
        }"#;
        let comps = inspect_bytes(mrpack_with(index)).unwrap();
        assert_eq!(comps.len(), 1);
        assert_eq!(comps[0].id, "mods/iris-1.7.6+mc1.20.1.jar");
        assert_eq!(comps[0].name, "Iris");
        assert_eq!(comps[0].side, "client");
        assert!(!comps[0].default, "mrpack optionals are opt-in");
    }

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
