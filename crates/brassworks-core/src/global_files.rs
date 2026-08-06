use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::export::{self, ExportNode};
use crate::instance::Instance;
use crate::modpack::InstalledMod;
use crate::paths::Paths;

pub const DEFAULT_PROFILE_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalFileProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalFilesConfig {
    #[serde(default)]
    pub profiles: Vec<GlobalFileProfile>,
}

impl Default for GlobalFilesConfig {
    fn default() -> Self {
        Self {
            profiles: vec![GlobalFileProfile {
                id: DEFAULT_PROFILE_ID.to_string(),
                name: "Default".to_string(),
                paths: Vec::new(),
            }],
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GlobalFilesApplyReport {
    pub linked: usize,
    pub detached: usize,
    pub backups: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalFilesSymlinkSupport {
    pub windows: bool,
    pub supported: bool,
    pub error: Option<String>,
}

pub fn symlink_support(paths: &Paths) -> GlobalFilesSymlinkSupport {
    #[cfg(not(windows))]
    {
        let _ = paths;
        GlobalFilesSymlinkSupport {
            windows: false,
            supported: true,
            error: None,
        }
    }

    #[cfg(windows)]
    {
        let probe_root = paths
            .global_files_dir()
            .join(format!(".symlink-probe-{}-{}", std::process::id(), timestamp()));
        let file_target = probe_root.join("target-file");
        let directory_target = probe_root.join("target-directory");
        let file_link = probe_root.join("file-link");
        let directory_link = probe_root.join("directory-link");
        let result = (|| -> Result<()> {
            std::fs::create_dir_all(&directory_target)
                .map_err(|error| CoreError::io(&directory_target, error))?;
            std::fs::write(&file_target, b"brassworks symlink probe")
                .map_err(|error| CoreError::io(&file_target, error))?;
            create_symlink(&file_target, &file_link)?;
            create_symlink(&directory_target, &directory_link)?;
            Ok(())
        })();

        if std::fs::symlink_metadata(&file_link).is_ok() {
            let _ = remove_symlink(&file_link);
        }
        if std::fs::symlink_metadata(&directory_link).is_ok() {
            let _ = remove_symlink(&directory_link);
        }
        let _ = std::fs::remove_dir_all(&probe_root);

        GlobalFilesSymlinkSupport {
            windows: true,
            supported: result.is_ok(),
            error: result.err().map(|error| error.to_string()),
        }
    }
}

pub fn load(paths: &Paths) -> Result<GlobalFilesConfig> {
    let path = paths.global_files_config();
    let mut config = match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<GlobalFilesConfig>(&bytes)
            .map_err(|error| CoreError::serde("global files config", error))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => GlobalFilesConfig::default(),
        Err(error) => return Err(CoreError::io(&path, error)),
    };
    let mut seen_ids = BTreeSet::new();
    for profile in &mut config.profiles {
        profile.id = profile_id(&profile.id);
        if profile.name.trim().is_empty() {
            profile.name = profile.id.clone();
        }
        profile.paths = normalize_paths(&profile.paths)?;
    }
    config.profiles.retain(|profile| seen_ids.insert(profile.id.clone()));
    if !config.profiles.iter().any(|profile| profile.id == DEFAULT_PROFILE_ID) {
        config.profiles.insert(
            0,
            GlobalFilesConfig::default().profiles.into_iter().next().unwrap(),
        );
    }
    Ok(config)
}

pub fn save(paths: &Paths, config: &GlobalFilesConfig) -> Result<()> {
    let path = paths.global_files_config();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| CoreError::io(parent, error))?;
    }
    let bytes = serde_json::to_vec_pretty(config)
        .map_err(|error| CoreError::serde("global files config", error))?;
    std::fs::write(&path, bytes).map_err(|error| CoreError::io(&path, error))
}

pub fn profile_id(name: &str) -> String {
    let id: String = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if id.is_empty() { "profile".to_string() } else { id }
}

pub fn normalize_paths(values: &[String]) -> Result<Vec<String>> {
    let mut paths = BTreeSet::new();
    for value in values {
        let value = value.replace('\\', "/");
        let value = value.trim_matches('/');
        if value.is_empty() {
            continue;
        }
        let path = Path::new(value);
        if path.is_absolute()
            || path.components().any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(CoreError::Modpack(format!("invalid global file path: {value}")));
        }
        paths.insert(value.to_string());
    }
    let mut compact = Vec::<String>::new();
    for path in paths {
        if compact.iter().any(|parent| path == *parent || path.starts_with(&format!("{parent}/"))) {
            continue;
        }
        compact.push(path);
    }
    Ok(compact)
}

pub fn selectable_tree(paths: &Paths, instance_id: &str) -> Vec<ExportNode> {
    let excluded = std::collections::HashSet::new();
    let mut tree = export::build_file_tree(&paths.instance_game_dir(instance_id), &excluded);
    const RUNTIME_ROOTS: &[&str] = &[
        "assets", "libraries", "versions", "runtime", "logs", "crash-reports", "saves",
        "downloads", "webcache", "natives",
    ];
    tree.retain(|node| !RUNTIME_ROOTS.contains(&node.name.as_str()));
    tree
}

pub fn seed_profile(
    paths: &Paths,
    profile: &GlobalFileProfile,
    source_instance_id: &str,
    installed_content: &[InstalledMod],
) -> Result<()> {
    let source_root = paths.instance_game_dir(source_instance_id);
    let profile_root = paths.global_files_profile_dir(&profile.id);
    std::fs::create_dir_all(&profile_root).map_err(|error| CoreError::io(&profile_root, error))?;
    for relative in &profile.paths {
        let target = profile_root.join(relative);
        let source = source_root.join(relative);
        if !source.exists() {
            if target.exists() {
                continue;
            }
            return Err(CoreError::Modpack(format!(
                "{relative} does not exist in the source instance"
            )));
        }
        copy_missing_path(&source, &target)?;
    }
    seed_metadata(paths, profile, source_instance_id, installed_content)?;
    Ok(())
}

pub fn apply_profile(
    paths: &Paths,
    instance: &Instance,
    profile: &GlobalFileProfile,
) -> Result<GlobalFilesApplyReport> {
    let mut report = GlobalFilesApplyReport::default();
    let game_root = paths.instance_game_dir(&instance.id);
    let profile_root = paths.global_files_profile_dir(&profile.id);
    for relative in &profile.paths {
        let target = profile_root.join(relative);
        if !target.exists() {
            continue;
        }
        let destination = game_root.join(relative);
        if symlink_points_to(&destination, &target) {
            continue;
        }
        if std::fs::symlink_metadata(&destination).is_ok() {
            let backup = backup_path(paths, &instance.id, relative);
            if let Some(parent) = backup.parent() {
                std::fs::create_dir_all(parent).map_err(|error| CoreError::io(parent, error))?;
            }
            std::fs::rename(&destination, &backup)
                .map_err(|error| CoreError::io(&destination, error))?;
            report.backups.push(backup.to_string_lossy().into_owned());
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| CoreError::io(parent, error))?;
        }
        create_symlink(&target, &destination)?;
        report.linked += 1;
    }
    for kind in metadata_kinds(&profile.paths, &profile_root) {
        let target = metadata_target(&profile_root, kind);
        if !target.exists() {
            write_metadata(&target, &empty_metadata(kind))?;
        }
        normalize_metadata_target(&target, kind)?;
        let destination = metadata_source(paths, &instance.id, kind);
        if symlink_points_to(&destination, &target) {
            continue;
        }
        if destination.exists() {
            merge_metadata_file(&target, &destination, kind)?;
        }
        link_with_backup(
            paths,
            &instance.id,
            &destination,
            &target,
            &format!(".launcher-metadata/{}", kind.filename()),
            &mut report,
        )?;
    }
    Ok(report)
}

pub fn sync_instance(paths: &Paths, instance: &Instance) -> Result<GlobalFilesApplyReport> {
    if !instance.global_files_enabled {
        return Ok(GlobalFilesApplyReport::default());
    }
    let config = load(paths)?;
    let profile_id = instance
        .global_files_profile
        .as_deref()
        .unwrap_or(DEFAULT_PROFILE_ID);
    let profile = config
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .or_else(|| config.profiles.iter().find(|profile| profile.id == DEFAULT_PROFILE_ID))
        .ok_or_else(|| CoreError::Modpack("default global-files profile is missing".to_string()))?;
    apply_profile(paths, instance, profile)
}

pub fn detach_profile(
    paths: &Paths,
    instance: &Instance,
    selected_paths: &[String],
) -> Result<GlobalFilesApplyReport> {
    let mut report = GlobalFilesApplyReport::default();
    let shared_root = paths.global_files_dir();
    let game_root = paths.instance_game_dir(&instance.id);
    for relative in normalize_paths(selected_paths)? {
        let destination = game_root.join(&relative);
        let Ok(metadata) = std::fs::symlink_metadata(&destination) else { continue };
        if !metadata.file_type().is_symlink() {
            continue;
        }
        let link = std::fs::read_link(&destination).map_err(|error| CoreError::io(&destination, error))?;
        let target = if link.is_absolute() {
            link
        } else {
            destination.parent().unwrap_or(&game_root).join(link)
        };
        if !target.starts_with(&shared_root) {
            continue;
        }
        let temp = destination.with_file_name(format!(
            ".brassworks-detach-{}-{}",
            destination.file_name().unwrap_or_default().to_string_lossy(),
            timestamp()
        ));
        if target.exists() {
            copy_path(&target, &temp)?;
        }
        remove_symlink(&destination).map_err(|error| CoreError::io(&destination, error))?;
        if temp.exists() {
            std::fs::rename(&temp, &destination).map_err(|error| CoreError::io(&destination, error))?;
        }
        report.detached += 1;
    }
    let profile_root = selected_paths
        .iter()
        .find_map(|relative| {
            let destination = game_root.join(relative);
            let target = std::fs::read_link(destination).ok()?;
            let target = if target.is_absolute() { target } else { game_root.join(target) };
            target.ancestors().find(|path| path.parent() == Some(&shared_root)).map(Path::to_path_buf)
        });
    if let Some(profile_root) = profile_root {
        for kind in metadata_kinds(selected_paths, &profile_root) {
            detach_metadata_link(paths, &instance.id, kind, &mut report)?;
        }
    } else {
        // The selected file links may already have been detached. Metadata links
        // identify their profile directly, so safely detach any matching kind.
        for kind in metadata_kinds(selected_paths, &game_root) {
            detach_metadata_link(paths, &instance.id, kind, &mut report)?;
        }
    }
    Ok(report)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MetadataKind {
    Content,
    Schematics,
    Datapacks,
    Stars,
}

impl MetadataKind {
    fn filename(self) -> &'static str {
        match self {
            Self::Content => "user_content.json",
            Self::Schematics => "schematics.json",
            Self::Datapacks => "datapacks.json",
            Self::Stars => "stars.json",
        }
    }
}

fn metadata_source(paths: &Paths, instance_id: &str, kind: MetadataKind) -> PathBuf {
    match kind {
        MetadataKind::Content => paths.user_content(instance_id),
        MetadataKind::Schematics => paths.schematics_index(instance_id),
        MetadataKind::Datapacks => paths.datapacks_index(instance_id),
        MetadataKind::Stars => paths.stars_file(instance_id),
    }
}

fn metadata_target(profile_root: &Path, kind: MetadataKind) -> PathBuf {
    profile_root.join(".brassworks-metadata").join(kind.filename())
}

fn metadata_kinds(selected_paths: &[String], content_root: &Path) -> BTreeSet<MetadataKind> {
    let mut kinds = BTreeSet::new();
    for relative in selected_paths {
        let normalized = relative.replace('\\', "/");
        let components: Vec<_> = normalized.split('/').collect();
        if matches!(components.first().copied(), Some("mods" | "resourcepacks" | "shaderpacks")) {
            kinds.insert(MetadataKind::Content);
        }
        if components.iter().any(|component| *component == "schematics")
            || is_schematic_path(Path::new(&normalized))
            || contains_schematic(content_root.join(&normalized).as_path())
        {
            kinds.insert(MetadataKind::Schematics);
        }
        if components.iter().any(|component| *component == "datapacks") {
            kinds.insert(MetadataKind::Datapacks);
        }
        if normalized == "servers.dat"
            || matches!(components.first().copied(), Some("saves" | "screenshots"))
        {
            kinds.insert(MetadataKind::Stars);
        }
    }
    kinds
}

fn is_schematic_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "nbt" | "litematic" | "schem" | "schematic" | "mcstructure"))
        .unwrap_or(false)
}

fn contains_schematic(path: &Path) -> bool {
    if is_schematic_path(path) {
        return true;
    }
    let Ok(entries) = std::fs::read_dir(path) else { return false };
    entries.flatten().any(|entry| {
        let path = entry.path();
        is_schematic_path(&path) || (path.is_dir() && contains_schematic(&path))
    })
}

fn seed_metadata(
    paths: &Paths,
    profile: &GlobalFileProfile,
    source_instance_id: &str,
    installed_content: &[InstalledMod],
) -> Result<()> {
    let game_root = paths.instance_game_dir(source_instance_id);
    let profile_root = paths.global_files_profile_dir(&profile.id);
    for kind in metadata_kinds(&profile.paths, &game_root) {
        let target = metadata_target(&profile_root, kind);
        let source = metadata_source(paths, source_instance_id, kind);
        let value = match kind {
            MetadataKind::Content => content_metadata(installed_content, &profile.paths),
            MetadataKind::Schematics => schematic_metadata(&source, &game_root, &profile.paths),
            _ => read_metadata(&source).unwrap_or_else(|| empty_metadata(kind)),
        };
        merge_metadata_value(&target, value, kind)?;
    }
    Ok(())
}

fn selected(path: &str, selected_paths: &[String]) -> bool {
    selected_paths.iter().any(|selection| {
        path == selection || path.starts_with(&format!("{selection}/"))
    })
}

fn content_metadata(installed: &[InstalledMod], selected_paths: &[String]) -> serde_json::Value {
    let items: Vec<_> = installed
        .iter()
        .filter(|item| selected(&item.path, selected_paths))
        .map(|item| {
            let curseforge = item.source == "curseforge";
            serde_json::json!({
                "name": item.name,
                "filename": item.filename,
                "path": item.path,
                "category": item.category,
                "modrinth_id": (!curseforge).then(|| item.project_id.clone()).flatten(),
                "modrinth_version": (!curseforge).then(|| item.version_id.clone()).flatten(),
                "source": item.source,
                "curseforge_id": curseforge.then(|| item.project_id.as_deref().and_then(|id| id.parse::<i64>().ok())).flatten(),
                "curseforge_file": curseforge.then(|| item.version_id.as_deref().and_then(|id| id.parse::<i64>().ok())).flatten(),
                "version": item.version,
                "title": item.title,
                "description": item.description,
                "icon_url": item.icon_url,
            })
        })
        .collect();
    serde_json::json!({ "items": items })
}

fn schematic_metadata(index: &Path, game_root: &Path, selected_paths: &[String]) -> serde_json::Value {
    let source = read_metadata(index).unwrap_or_else(|| serde_json::json!({ "entries": {} }));
    let mut entries = serde_json::Map::new();
    if let Some(source_entries) = source.get("entries").and_then(serde_json::Value::as_object) {
        for (key, value) in source_entries {
            let key_path = Path::new(key);
            let relative = key_path.strip_prefix(game_root).ok().and_then(Path::to_str);
            let filename = key_path.file_name().and_then(|name| name.to_str()).unwrap_or(key);
            let matches_path = relative.map(|path| selected(path, selected_paths)).unwrap_or(false);
            let matches_file = selected_paths.iter().any(|selection| {
                let path = game_root.join(selection);
                (path.is_file() && path.file_name().and_then(|name| name.to_str()) == Some(filename))
                    || (path.is_dir() && find_filename(&path, filename))
            });
            if matches_path || matches_file {
                entries.insert(filename.to_string(), value.clone());
            }
        }
    }
    serde_json::json!({ "entries": entries })
}

fn find_filename(root: &Path, filename: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(root) else { return false };
    entries.flatten().any(|entry| {
        let path = entry.path();
        path.file_name().and_then(|name| name.to_str()) == Some(filename)
            || (path.is_dir() && find_filename(&path, filename))
    })
}

fn empty_metadata(kind: MetadataKind) -> serde_json::Value {
    match kind {
        MetadataKind::Content => serde_json::json!({ "items": [] }),
        MetadataKind::Schematics => serde_json::json!({ "entries": {} }),
        MetadataKind::Datapacks => serde_json::json!({ "worlds": {} }),
        MetadataKind::Stars => serde_json::json!({ "worlds": [], "servers": [], "screenshots": [] }),
    }
}

fn read_metadata(path: &Path) -> Option<serde_json::Value> {
    std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn write_metadata(path: &Path, value: &serde_json::Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| CoreError::io(parent, error))?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| CoreError::serde("global files metadata", error))?;
    std::fs::write(path, bytes).map_err(|error| CoreError::io(path, error))
}

fn merge_metadata_file(target: &Path, source: &Path, kind: MetadataKind) -> Result<()> {
    if let Some(mut value) = read_metadata(source) {
        normalize_metadata_value(&mut value, kind);
        merge_metadata_value(target, value, kind)?;
    }
    Ok(())
}

fn normalize_metadata_target(target: &Path, kind: MetadataKind) -> Result<()> {
    let Some(mut value) = read_metadata(target) else { return Ok(()) };
    if normalize_metadata_value(&mut value, kind) {
        write_metadata(target, &value)?;
    }
    Ok(())
}

fn normalize_metadata_value(value: &mut serde_json::Value, kind: MetadataKind) -> bool {
    if kind != MetadataKind::Schematics {
        return false;
    }
    let Some(entries) = value.get_mut("entries").and_then(serde_json::Value::as_object_mut) else {
        return false;
    };
    let aliases: Vec<_> = entries
        .iter()
        .filter_map(|(key, metadata)| {
            let filename = Path::new(key).file_name()?.to_str()?;
            (filename != key).then(|| (filename.to_string(), metadata.clone()))
        })
        .collect();
    let changed = aliases.iter().any(|(filename, _)| !entries.contains_key(filename));
    for (filename, metadata) in aliases {
        entries.entry(filename).or_insert(metadata);
    }
    changed
}

fn merge_metadata_value(target: &Path, incoming: serde_json::Value, kind: MetadataKind) -> Result<()> {
    let mut merged = read_metadata(target).unwrap_or_else(|| empty_metadata(kind));
    match kind {
        MetadataKind::Content => merge_array_by_key(&mut merged, incoming, "items", "path"),
        MetadataKind::Schematics => merge_object(&mut merged, incoming, "entries"),
        MetadataKind::Datapacks => merge_datapacks(&mut merged, incoming),
        MetadataKind::Stars => merge_stars(&mut merged, incoming),
    }
    write_metadata(target, &merged)
}

fn merge_array_by_key(base: &mut serde_json::Value, incoming: serde_json::Value, field: &str, key: &str) {
    let mut keyed = BTreeMap::<String, serde_json::Value>::new();
    for value in base.get(field).and_then(serde_json::Value::as_array).into_iter().flatten()
        .chain(incoming.get(field).and_then(serde_json::Value::as_array).into_iter().flatten())
    {
        if let Some(id) = value.get(key).and_then(serde_json::Value::as_str) {
            keyed.insert(id.to_string(), value.clone());
        }
    }
    base[field] = serde_json::Value::Array(keyed.into_values().collect());
}

fn merge_object(base: &mut serde_json::Value, incoming: serde_json::Value, field: &str) {
    let target = base.get_mut(field).and_then(serde_json::Value::as_object_mut);
    let source = incoming.get(field).and_then(serde_json::Value::as_object);
    if let (Some(target), Some(source)) = (target, source) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
}

fn merge_datapacks(base: &mut serde_json::Value, incoming: serde_json::Value) {
    let Some(worlds) = incoming.get("worlds").and_then(serde_json::Value::as_object) else { return };
    for (world, value) in worlds {
        let wrapper = serde_json::json!({ "items": value });
        let target_world = base["worlds"].as_object_mut().unwrap().entry(world).or_insert_with(|| serde_json::json!([]));
        let mut target_wrapper = serde_json::json!({ "items": target_world.clone() });
        merge_array_by_key(&mut target_wrapper, wrapper, "items", "filename");
        *target_world = target_wrapper["items"].clone();
    }
}

fn merge_stars(base: &mut serde_json::Value, incoming: serde_json::Value) {
    for field in ["worlds", "servers", "screenshots"] {
        let mut values = BTreeSet::new();
        for value in base.get(field).and_then(serde_json::Value::as_array).into_iter().flatten()
            .chain(incoming.get(field).and_then(serde_json::Value::as_array).into_iter().flatten())
            .filter_map(serde_json::Value::as_str)
        {
            values.insert(value.to_string());
        }
        base[field] = serde_json::Value::Array(values.into_iter().map(serde_json::Value::String).collect());
    }
}

fn link_with_backup(
    paths: &Paths,
    instance_id: &str,
    destination: &Path,
    target: &Path,
    backup_relative: &str,
    report: &mut GlobalFilesApplyReport,
) -> Result<()> {
    if std::fs::symlink_metadata(destination).is_ok() {
        let backup = backup_path(paths, instance_id, backup_relative);
        if let Some(parent) = backup.parent() {
            std::fs::create_dir_all(parent).map_err(|error| CoreError::io(parent, error))?;
        }
        std::fs::rename(destination, &backup).map_err(|error| CoreError::io(destination, error))?;
        report.backups.push(backup.to_string_lossy().into_owned());
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| CoreError::io(parent, error))?;
    }
    create_symlink(target, destination)?;
    report.linked += 1;
    Ok(())
}

fn detach_metadata_link(
    paths: &Paths,
    instance_id: &str,
    kind: MetadataKind,
    report: &mut GlobalFilesApplyReport,
) -> Result<()> {
    let destination = metadata_source(paths, instance_id, kind);
    let Ok(metadata) = std::fs::symlink_metadata(&destination) else { return Ok(()) };
    if !metadata.file_type().is_symlink() {
        return Ok(());
    }
    let target = std::fs::read_link(&destination).map_err(|error| CoreError::io(&destination, error))?;
    let target = if target.is_absolute() { target } else { destination.parent().unwrap().join(target) };
    if !target.starts_with(paths.global_files_dir()) {
        return Ok(());
    }
    let temp = destination.with_extension(format!("detach-{}", timestamp()));
    if target.exists() {
        std::fs::copy(&target, &temp).map_err(|error| CoreError::io(&temp, error))?;
    }
    remove_symlink(&destination).map_err(|error| CoreError::io(&destination, error))?;
    if temp.exists() {
        std::fs::rename(&temp, &destination).map_err(|error| CoreError::io(&destination, error))?;
    }
    report.detached += 1;
    Ok(())
}

pub fn archive_profile(paths: &Paths, profile_id: &str) -> Result<Option<String>> {
    let source = paths.global_files_profile_dir(profile_id);
    if !source.exists() {
        return Ok(None);
    }
    let archive_root = paths.shared_dir().join("global-files-archive");
    std::fs::create_dir_all(&archive_root).map_err(|error| CoreError::io(&archive_root, error))?;
    let destination = archive_root.join(format!("{profile_id}-{}", timestamp()));
    std::fs::rename(&source, &destination).map_err(|error| CoreError::io(&source, error))?;
    Ok(Some(destination.to_string_lossy().into_owned()))
}

fn backup_path(paths: &Paths, instance_id: &str, relative: &str) -> PathBuf {
    paths
        .global_files_backups(instance_id)
        .join(timestamp().to_string())
        .join(relative)
}

fn timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn symlink_points_to(link: &Path, target: &Path) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(link) else { return false };
    if !metadata.file_type().is_symlink() {
        return false;
    }
    let Ok(existing) = std::fs::read_link(link) else { return false };
    let existing = if existing.is_absolute() {
        existing
    } else {
        link.parent().unwrap_or(Path::new("")).join(existing)
    };
    existing == target
}

#[cfg(not(windows))]
fn remove_symlink(path: &Path) -> std::io::Result<()> {
    std::fs::remove_file(path)
}

#[cfg(windows)]
fn remove_symlink(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(_) => std::fs::remove_dir(path),
    }
}

fn copy_path(source: &Path, destination: &Path) -> Result<()> {
    let metadata = std::fs::metadata(source).map_err(|error| CoreError::io(source, error))?;
    if metadata.is_dir() {
        std::fs::create_dir_all(destination).map_err(|error| CoreError::io(destination, error))?;
        for entry in std::fs::read_dir(source).map_err(|error| CoreError::io(source, error))? {
            let entry = entry.map_err(|error| CoreError::io(source, error))?;
            copy_path(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| CoreError::io(parent, error))?;
        }
        std::fs::copy(source, destination).map_err(|error| CoreError::io(destination, error))?;
    }
    Ok(())
}

fn copy_missing_path(source: &Path, destination: &Path) -> Result<()> {
    let metadata = std::fs::metadata(source).map_err(|error| CoreError::io(source, error))?;
    if metadata.is_dir() {
        std::fs::create_dir_all(destination).map_err(|error| CoreError::io(destination, error))?;
        for entry in std::fs::read_dir(source).map_err(|error| CoreError::io(source, error))? {
            let entry = entry.map_err(|error| CoreError::io(source, error))?;
            copy_missing_path(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else if !destination.exists() {
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| CoreError::io(parent, error))?;
        }
        std::fs::copy(source, destination).map_err(|error| CoreError::io(destination, error))?;
    }
    Ok(())
}

#[cfg(unix)]
fn create_symlink(target: &Path, link: &Path) -> Result<()> {
    std::os::unix::fs::symlink(target, link).map_err(|error| CoreError::io(link, error))
}

#[cfg(windows)]
fn create_symlink(target: &Path, link: &Path) -> Result<()> {
    let result = if target.is_dir() {
        std::os::windows::fs::symlink_dir(target, link)
    } else {
        std::os::windows::fs::symlink_file(target, link)
    };
    result.map_err(|error| CoreError::Modpack(format!(
        "could not create the global-file link at {}: {error}. Enable Windows Developer Mode or run Brassworks with permission to create symbolic links",
        link.display()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::{LoaderKind, LoaderVersion, PackSource};

    fn instance(id: &str) -> Instance {
        Instance::new_custom(id, id, "1.21.1", LoaderKind::Fabric, LoaderVersion::Stable, PackSource::None)
    }

    #[test]
    fn paths_are_safe_compact_and_parent_first() {
        let values = vec!["config/a.toml".into(), "config".into(), "../bad".into()];
        assert!(normalize_paths(&values).is_err());
        let values = vec!["config/a.toml".into(), "config".into(), "schematics/x.nbt".into()];
        assert_eq!(normalize_paths(&values).unwrap(), vec!["config", "schematics/x.nbt"]);
    }

    #[test]
    fn screenshots_are_selectable_but_runtime_folders_stay_hidden() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(temp.path());
        let game = paths.instance_game_dir("source");
        std::fs::create_dir_all(game.join("screenshots")).unwrap();
        std::fs::create_dir_all(game.join("logs")).unwrap();
        std::fs::write(game.join("screenshots/build.png"), b"png").unwrap();
        std::fs::write(game.join("logs/latest.log"), b"log").unwrap();

        let tree = selectable_tree(&paths, "source");
        assert!(tree.iter().any(|node| node.name == "screenshots"));
        assert!(!tree.iter().any(|node| node.name == "logs"));
    }

    #[test]
    fn apply_and_detach_round_trip_preserves_shared_content() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(temp.path());
        let source = instance("source");
        let other = instance("other");
        for item in [&source, &other] {
            std::fs::create_dir_all(paths.instance_game_dir(&item.id).join("config")).unwrap();
        }
        std::fs::write(paths.instance_game_dir("source").join("config/shared.toml"), b"source").unwrap();
        std::fs::write(paths.instance_game_dir("other").join("config/shared.toml"), b"other").unwrap();
        let profile = GlobalFileProfile {
            id: "default".into(),
            name: "Default".into(),
            paths: vec!["config/shared.toml".into()],
        };
        seed_profile(&paths, &profile, "source", &[]).unwrap();
        let report = apply_profile(&paths, &other, &profile).unwrap();
        assert_eq!(report.linked, 1);
        assert_eq!(std::fs::read(paths.instance_game_dir("other").join("config/shared.toml")).unwrap(), b"source");
        detach_profile(&paths, &other, &profile.paths).unwrap();
        let detached = paths.instance_game_dir("other").join("config/shared.toml");
        assert!(!std::fs::symlink_metadata(&detached).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(detached).unwrap(), b"source");
    }

    #[test]
    fn a_selected_folder_is_one_live_shared_link() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(temp.path());
        let source = instance("source");
        let other = instance("other");
        std::fs::create_dir_all(paths.instance_game_dir("source").join("schematics/nested")).unwrap();
        std::fs::create_dir_all(paths.instance_game_dir("other")).unwrap();
        std::fs::write(
            paths.instance_game_dir("source").join("schematics/nested/build.nbt"),
            b"first",
        ).unwrap();
        let profile = GlobalFileProfile {
            id: "builders".into(),
            name: "Builders".into(),
            paths: vec!["schematics".into()],
        };
        seed_profile(&paths, &profile, "source", &[]).unwrap();
        apply_profile(&paths, &source, &profile).unwrap();
        apply_profile(&paths, &other, &profile).unwrap();

        let linked_folder = paths.instance_game_dir("other").join("schematics");
        assert!(std::fs::symlink_metadata(&linked_folder).unwrap().file_type().is_symlink());
        std::fs::write(linked_folder.join("nested/build.nbt"), b"changed").unwrap();
        assert_eq!(
            std::fs::read(paths.instance_game_dir("source").join("schematics/nested/build.nbt")).unwrap(),
            b"changed"
        );
    }

    #[test]
    fn linked_content_carries_provider_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(temp.path());
        let other = instance("other");
        std::fs::create_dir_all(paths.instance_game_dir("source").join("mods")).unwrap();
        std::fs::create_dir_all(paths.instance_game_dir("other")).unwrap();
        std::fs::write(
            paths.instance_game_dir("source").join("mods/example.jar"),
            b"mod",
        )
        .unwrap();
        let tracked = InstalledMod {
            name: "Example Mod".into(),
            filename: "example.jar".into(),
            path: "mods/example.jar".into(),
            side: "client".into(),
            category: "mods".into(),
            enabled: true,
            managed: false,
            source: "modrinth".into(),
            project_id: Some("example-project".into()),
            version_id: Some("example-version".into()),
            version: Some("1.0.0".into()),
            title: Some("Example Mod".into()),
            description: Some("Provider description".into()),
            icon_url: Some("https://example.invalid/icon.png".into()),
        };
        let profile = GlobalFileProfile {
            id: "content".into(),
            name: "Content".into(),
            paths: vec!["mods".into()],
        };
        seed_profile(&paths, &profile, "source", &[tracked]).unwrap();
        apply_profile(&paths, &other, &profile).unwrap();

        let metadata = std::fs::read(paths.user_content("other")).unwrap();
        let metadata: serde_json::Value = serde_json::from_slice(&metadata).unwrap();
        assert_eq!(metadata["items"][0]["name"], "Example Mod");
        assert_eq!(metadata["items"][0]["modrinth_id"], "example-project");
        assert_eq!(metadata["items"][0]["description"], "Provider description");
        assert!(std::fs::symlink_metadata(paths.user_content("other"))
            .unwrap()
            .file_type()
            .is_symlink());

        detach_profile(&paths, &other, &profile.paths).unwrap();
        assert!(!std::fs::symlink_metadata(paths.user_content("other"))
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn linked_schematics_use_portable_metadata_keys() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(temp.path());
        let other = instance("other");
        let source_file = paths.instance_game_dir("source").join("schematics/cabin.nbt");
        std::fs::create_dir_all(source_file.parent().unwrap()).unwrap();
        std::fs::create_dir_all(paths.instance_game_dir("other")).unwrap();
        std::fs::write(&source_file, b"schematic").unwrap();
        write_metadata(
            &paths.schematics_index("source"),
            &serde_json::json!({
                "entries": {
                    source_file.to_string_lossy(): {
                        "provider": "createmod",
                        "project_id": "cabin",
                        "format": "nbt",
                        "title": "Cozy Cabin",
                        "description": "A small cabin"
                    }
                }
            }),
        )
        .unwrap();
        let profile = GlobalFileProfile {
            id: "schematics".into(),
            name: "Schematics".into(),
            paths: vec!["schematics".into()],
        };
        seed_profile(&paths, &profile, "source", &[]).unwrap();
        apply_profile(&paths, &other, &profile).unwrap();

        let metadata = read_metadata(&paths.schematics_index("other")).unwrap();
        assert_eq!(metadata["entries"]["cabin.nbt"]["title"], "Cozy Cabin");
        assert_eq!(metadata["entries"]["cabin.nbt"]["provider"], "createmod");
        let listed = crate::schematics::list_installed(
            &paths.instance_game_dir("other"),
            &paths.schematics_index("other"),
            &other,
            &[],
        )
        .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "Cozy Cabin");
        assert_eq!(listed[0].description.as_deref(), Some("A small cabin"));
    }

    #[test]
    fn repair_migrates_legacy_absolute_schematic_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(temp.path());
        let other = instance("other");
        let profile = GlobalFileProfile {
            id: "legacy".into(),
            name: "Legacy".into(),
            paths: vec!["schematics".into()],
        };
        let profile_root = paths.global_files_profile_dir("legacy");
        std::fs::create_dir_all(profile_root.join("schematics")).unwrap();
        std::fs::create_dir_all(paths.instance_game_dir("other")).unwrap();
        std::fs::write(profile_root.join("schematics/legacy.nbt"), b"schematic").unwrap();
        write_metadata(
            &metadata_target(&profile_root, MetadataKind::Schematics),
            &serde_json::json!({
                "entries": {
                    "/old/instance/minecraft/schematics/legacy.nbt": {
                        "provider": "abfielder",
                        "project_id": "legacy-build",
                        "format": "nbt",
                        "title": "Legacy Build",
                        "description": "Migrated metadata"
                    }
                }
            }),
        )
        .unwrap();

        apply_profile(&paths, &other, &profile).unwrap();
        let listed = crate::schematics::list_installed(
            &paths.instance_game_dir("other"),
            &paths.schematics_index("other"),
            &other,
            &[],
        )
        .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "Legacy Build");
        assert_eq!(listed[0].description.as_deref(), Some("Migrated metadata"));
    }
}
