mod curseforge;
mod mrpack;

use std::collections::HashSet;
use std::io::{Cursor, Read};
use std::path::Path;

use packwiz::{sha512_hex, Curseforge, FileRecord, ManagedMod, Manifest, Modrinth};
use serde::Serialize;

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

#[derive(Debug, Clone, Serialize)]
pub struct OptionalComponent {
            pub id: String,
    pub name: String,
    pub description: Option<String>,
            pub default: bool,
    pub side: String,
    pub category: String,
}

pub fn prettify_name(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    let mut stem = file
        .strip_suffix(".jar")
        .or_else(|| file.strip_suffix(".zip"))
        .unwrap_or(file);
        let lower = stem.to_lowercase();
    const MARKERS: [&str; 8] = ["fabric", "forge", "neoforge", "quilt", "-mc", "+mc", "_mc", "mc1."];
    let mut cut = stem.len();
    for m in MARKERS {
        if let Some(i) = lower.find(m) {
            cut = cut.min(i);
        }
    }
        for (i, ch) in stem.char_indices() {
        if (ch == '-' || ch == '_' || ch == ' ' || ch == '+')
            && stem[i + ch.len_utf8()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_digit())
        {
            cut = cut.min(i);
            break;
        }
    }
    stem = stem[..cut].trim_matches(|c| c == '-' || c == '_' || c == ' ' || c == '+');
    if stem.is_empty() {
        stem = file;
    }
    let spaced = stem.replace(['_', '-'], " ");
    let cleaned = spaced
        .split_whitespace()
        .map(capitalize_first)
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() {
        file.to_string()
    } else {
        cleaned
    }
}

fn capitalize_first(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
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

#[allow(clippy::too_many_arguments)]
pub fn sync_pack(
    paths: &Paths,
    instance_id: &str,
    pack: &PackSource,
    optional: &OptionalSet,
    concurrency: usize,
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
            mrpack::sync(paths, instance_id, &rv.url, version_id, optional, concurrency, modrinth, cancel, progress)
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
                paths, instance_id, &rv.url, project_id, file_id, optional, concurrency, cf,
                modrinth, cancel, progress,
            )
        }
        _ => Err(CoreError::Modpack(
            "This instance has no downloadable modpack".to_string(),
        )),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn install_file(
    paths: &Paths,
    instance_id: &str,
    source: &str,
    bytes: Vec<u8>,
    optional: &OptionalSet,
    concurrency: usize,
    modrinth: &Modrinth,
    cf: Option<&Curseforge>,
    cancel: &dyn Fn() -> bool,
    progress: Progress,
) -> Result<PackResult> {
    if source == "curseforge" {
        let cf = cf.ok_or_else(|| {
            CoreError::Modpack("A CurseForge API key is required".to_string())
        })?;
        curseforge::install_bytes(paths, instance_id, "manual", bytes, optional, concurrency, cf, modrinth, cancel, progress)
    } else {
        mrpack::install_bytes(paths, instance_id, "manual", bytes, optional, concurrency, modrinth, cancel, progress)
    }
}

pub(super) enum FileOutcome {
        AlreadyCurrent,
        Installed(String),
        Failed,
}

pub type OptionalSet = HashSet<String>;

pub fn optional_set(selection: &Option<Vec<String>>) -> OptionalSet {
    selection.iter().flatten().cloned().collect()
}

pub fn inspect_bytes(
    source: &str,
    bytes: Vec<u8>,
    cf: Option<&Curseforge>,
) -> Result<Vec<OptionalComponent>> {
    if source == "curseforge" {
        let cf = cf.ok_or_else(|| {
            CoreError::Modpack("A CurseForge API key is required".to_string())
        })?;
        curseforge::inspect_bytes(bytes, cf)
    } else {
        mrpack::inspect_bytes(bytes)
    }
}

pub fn inspect_remote(
    source: &str,
    project_id: &str,
    version_id: &str,
    modrinth: &Modrinth,
    cf: Option<&Curseforge>,
) -> Result<Vec<OptionalComponent>> {
    if source == "curseforge" {
        let cf = cf.ok_or_else(|| {
            CoreError::Modpack("A CurseForge API key is required".to_string())
        })?;
        let rv = cf
            .resolve_version(project_id, version_id)?
            .ok_or_else(|| CoreError::Modpack("Modpack file not found".to_string()))?;
        let bytes = modrinth.download(&rv.url)?;
        curseforge::inspect_bytes(bytes, cf)
    } else {
        let rv = modrinth
            .resolve_version(version_id)?
            .ok_or_else(|| CoreError::Modpack("Modpack version not found".to_string()))?;
        let bytes = modrinth.download(&rv.url)?;
        mrpack::inspect_bytes(bytes)
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

fn write_bytes(game_dir: &Path, rel: &str, bytes: &[u8]) -> Result<()> {
    let dest = game_dir.join(rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    std::fs::write(&dest, bytes).map_err(|e| CoreError::io(&dest, e))
}

fn write_tracked(game_dir: &Path, rel: &str, bytes: &[u8], manifest: &mut Manifest) -> Result<()> {
    write_bytes(game_dir, rel, bytes)?;
    manifest.files.insert(
        rel.to_string(),
        FileRecord {
            hash: sha512_hex(bytes),
            hash_format: "sha512".to_string(),
        },
    );
    Ok(())
}

pub(super) fn side_label(client: &str, server: &str) -> String {
    let client_ok = client != "unsupported";
    let server_ok = server != "unsupported";
    match (client_ok, server_ok) {
        (true, false) => "client",
        (false, true) => "server",
        _ => "both",
    }
    .to_string()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prettifies_mod_filenames() {
        assert_eq!(prettify_name("mods/iris-1.7.6+mc1.20.1.jar"), "Iris");
        assert_eq!(prettify_name("mods/bobby-5.0.1.jar"), "Bobby");
                assert_eq!(
            prettify_name("mods/AmbientSounds_FABRIC_v6.1.11_mc1.20.1.jar"),
            "AmbientSounds"
        );
        assert_eq!(
            prettify_name("mods/skinlayers3d-fabric-1.9.2-mc1.20.1.jar"),
            "Skinlayers3d"
        );
                assert_eq!(prettify_name("mods/cool_mod.jar"), "Cool Mod");
    }

    #[test]
    fn side_label_collapses_env_pairs() {
        assert_eq!(side_label("optional", "unsupported"), "client");
        assert_eq!(side_label("unsupported", "required"), "server");
        assert_eq!(side_label("required", "required"), "both");
        assert_eq!(side_label("", ""), "both");
    }

    #[test]
    fn optional_set_from_selection() {
        assert!(optional_set(&None).is_empty());
        assert!(optional_set(&Some(vec![])).is_empty());
        let set = optional_set(&Some(vec!["a".into(), "b".into()]));
        assert!(set.contains("a") && set.contains("b") && set.len() == 2);
    }

            #[test]
    #[ignore = "network: downloads the steam-n-rails modpack from modrinth.com"]
    fn steam_n_rails_has_eight_optional() {
        let cache = std::env::temp_dir().join("bw-test-mr-cache");
        let modrinth = packwiz::Installer::new().modrinth(&cache);
        let versions = modrinth.project_versions("steam-n-rails-modpack").unwrap();
        let latest = versions.first().expect("pack has versions");
        let comps = inspect_remote(
            "modrinth",
            "steam-n-rails-modpack",
            &latest.version_id,
            &modrinth,
            None,
        )
        .unwrap();
        assert_eq!(comps.len(), 8, "steam-n-rails ships 8 optional client mods");
        assert!(comps.iter().all(|c| !c.default), "all opt-in by default");
        assert!(comps.iter().any(|c| c.name == "Iris"));
    }

            #[test]
    #[ignore = "network: installs the steam-n-rails modpack from modrinth.com"]
    fn install_respects_optional_selection() {
        let tmp = std::env::temp_dir().join(format!("bw-test-install-{}", std::process::id()));
        let paths = crate::paths::Paths::with_root(&tmp);
        let cache = tmp.join("cache");
        let modrinth = packwiz::Installer::new().modrinth(&cache);

        let versions = modrinth.project_versions("steam-n-rails-modpack").unwrap();
        let vid = versions.first().unwrap().version_id.clone();

                let comps =
            inspect_remote("modrinth", "steam-n-rails-modpack", &vid, &modrinth, None).unwrap();
        let iris = comps.iter().find(|c| c.name == "Iris").unwrap().id.clone();
        let chosen: OptionalSet = std::iter::once(iris.clone()).collect();

        let pack = PackSource::Modrinth {
            project_id: Some("steam-n-rails-modpack".into()),
            version_id: vid.clone(),
        };
        sync_pack(
            &paths,
            "test-inst",
            &pack,
            &chosen,
            8,
            &modrinth,
            None,
            &|| false,
            &mut |_| {},
        )
        .unwrap();

        let game_dir = paths.instance_game_dir("test-inst");
        assert!(game_dir.join(&iris).exists(), "selected optional Iris installed");
        for c in &comps {
            if c.id != iris {
                assert!(
                    !game_dir.join(&c.id).exists(),
                    "unselected optional {} must be skipped",
                    c.id
                );
            }
        }
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
