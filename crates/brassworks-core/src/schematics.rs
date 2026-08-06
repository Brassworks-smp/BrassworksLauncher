use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

use crate::createmod::{
    FilterOption, InstalledSchematic, SchematicDetail, SchematicFilters, SchematicHome,
    SchematicSearch, SchematicSearchParams, CREATE_CURSEFORGE_ID, CREATE_FABRIC_CURSEFORGE_ID,
    CREATE_FABRIC_MODRINTH_ID, CREATE_MODRINTH_ID,
};
use crate::error::{CoreError, Result};
use crate::instance::Instance;
use crate::modpack::InstalledMod;

pub const CREATE_PROVIDER: &str = "createmod";
pub const MINECRAFT_SCHEMATICS_PROVIDER: &str = "minecraft-schematics";
pub const ABFIELDER_PROVIDER: &str = "abfielder";
pub const CREATE_INTEGRATION: &str = "createmod_schematics";
pub const MINECRAFT_SCHEMATICS_INTEGRATION: &str = "minecraft_schematics";
pub const ABFIELDER_INTEGRATION: &str = "abfielder_schematics";

const CREATE_PROJECT_IDS: &[&str] = &[
    CREATE_MODRINTH_ID,
    CREATE_CURSEFORGE_ID,
    CREATE_FABRIC_MODRINTH_ID,
    CREATE_FABRIC_CURSEFORGE_ID,
];
const LITEMATICA_MODRINTH_IDS: &[&str] = &["bEpr0Arc", "dCKRaeBC", "eJObCFt0"];
const LITEMATICA_CURSEFORGE_IDS: &[&str] = &["308892", "912441"];
const WORLDEDIT_MODRINTH_IDS: &[&str] = &["1u6JkXh5"];
const WORLDEDIT_CURSEFORGE_IDS: &[&str] = &["225608"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicProviderStatus {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub detected: bool,
    pub formats: Vec<String>,
    pub native_formats: Vec<String>,
    pub recommended_format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicsStatus {
    pub enabled: bool,
    pub create_detected: bool,
    pub litematica_detected: bool,
    pub worldedit_detected: bool,
    pub mode: String,
    pub providers: Vec<SchematicProviderStatus>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledMetadata {
    provider: String,
    project_id: String,
    format: String,
    #[serde(default)]
    original_format: Option<String>,
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    image_url: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    web_url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledIndex {
    #[serde(default)]
    entries: BTreeMap<String, InstalledMetadata>,
}

fn cache_base() -> String {
    std::env::var("SCHEMATICS_CACHE_BASE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("CREATEMOD_CACHE_BASE").ok())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| option_env!("SCHEMATICS_CACHE_BASE").map(str::to_string))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "https://api.opnsoc.org/createmodschem".to_string())
        .trim()
        .trim_end_matches('/')
        .to_string()
}

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("BrassworksLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| CoreError::Remote(e.to_string()))
}

fn provider_url(provider: &str, suffix: &str) -> String {
    format!("{}/providers/{provider}/{suffix}", cache_base())
}

fn is_rate_limited(status: u16, body: &str) -> bool {
    status == 429 || body.to_ascii_lowercase().contains("rate limit")
}

fn get_json<T: serde::de::DeserializeOwned>(
    url: &str,
    params: &[(&str, String)],
) -> std::result::Result<T, (bool, CoreError)> {
    let response = client()
        .map_err(|error| (false, error))?
        .get(url)
        .query(params)
        .send()
        .map_err(|error| (false, CoreError::Remote(error.to_string())))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        let rate_limited = is_rate_limited(status.as_u16(), &body);
        return Err((
            rate_limited,
            CoreError::Remote(format!("{url} -> {status}: {body}")),
        ));
    }
    response
        .json()
        .map_err(|error| (false, CoreError::Remote(format!("decode {url}: {error}"))))
}

fn proxy_asset(provider: &str, value: &str) -> String {
    if provider == CREATE_PROVIDER || value.is_empty() || value.starts_with(&cache_base()) {
        return value.to_string();
    }
    let Ok(mut url) = reqwest::Url::parse(&provider_url(provider, "asset")) else {
        return value.to_string();
    };
    url.query_pairs_mut().append_pair("url", value);
    url.to_string()
}

fn normalize_home(provider: &str, mut home: SchematicHome) -> SchematicHome {
    for item in home
        .trending
        .iter_mut()
        .chain(home.latest.iter_mut())
        .chain(home.highest.iter_mut())
    {
        item.provider = provider.to_string();
        item.featured_image = item
            .featured_image
            .as_deref()
            .map(|v| proxy_asset(provider, v));
        if item.formats.is_empty() {
            item.formats = default_provider_formats(provider);
        }
    }
    home
}

fn normalize_search(provider: &str, mut search: SchematicSearch) -> SchematicSearch {
    for item in &mut search.items {
        item.provider = provider.to_string();
        item.featured_image = item
            .featured_image
            .as_deref()
            .map(|v| proxy_asset(provider, v));
        if item.formats.is_empty() {
            item.formats = default_provider_formats(provider);
        }
    }
    search
}

fn normalize_detail(provider: &str, mut detail: SchematicDetail) -> SchematicDetail {
    detail.provider = provider.to_string();
    detail.featured_image = detail
        .featured_image
        .as_deref()
        .map(|v| proxy_asset(provider, v));
    detail.gallery = detail
        .gallery
        .iter()
        .map(|v| proxy_asset(provider, v))
        .collect();
    if detail.formats.is_empty() {
        detail.formats = default_provider_formats(provider);
    }
    detail
}

fn default_provider_formats(provider: &str) -> Vec<String> {
    match provider {
        CREATE_PROVIDER => vec!["nbt".into()],
        MINECRAFT_SCHEMATICS_PROVIDER => vec!["schem".into(), "schematic".into()],
        ABFIELDER_PROVIDER => vec!["litematic".into(), "schem".into(), "mcstructure".into()],
        _ => Vec::new(),
    }
}

pub fn home(provider: &str) -> Result<SchematicHome> {
    if provider == CREATE_PROVIDER {
        return crate::createmod::home().map(|v| normalize_home(provider, v));
    }
    match get_json(&provider_url(provider, "home"), &[]) {
        Ok(value) => Ok(normalize_home(provider, value)),
        Err((true, _)) => crate::schematic_client_cache::home(provider)
            .map(|value| normalize_home(provider, value)),
        Err((false, error)) => Err(error),
    }
}

pub fn search(provider: &str, params: &SchematicSearchParams) -> Result<SchematicSearch> {
    if provider == CREATE_PROVIDER {
        return crate::createmod::search(params).map(|v| normalize_search(provider, v));
    }
    let query = vec![
        ("query", params.query.clone()),
        ("sort", params.sort.clone()),
        ("category", params.category.clone()),
        ("mc_version", params.mc_version.clone()),
        ("create_version", params.create_version.clone()),
        ("theme", params.theme.clone()),
        ("size", params.size.clone()),
        ("page", params.page.to_string()),
    ];
    match get_json(&provider_url(provider, "schematics"), &query) {
        Ok(value) => Ok(normalize_search(provider, value)),
        Err((true, _)) => crate::schematic_client_cache::search(provider, params)
            .map(|value| normalize_search(provider, value)),
        Err((false, error)) => Err(error),
    }
}

pub fn detail(provider: &str, id: &str) -> Result<SchematicDetail> {
    if provider == CREATE_PROVIDER {
        return crate::createmod::detail(id).map(|v| normalize_detail(provider, v));
    }
    match get_json(&provider_url(provider, &format!("schematics/{id}")), &[]) {
        Ok(value) => Ok(normalize_detail(provider, value)),
        Err((true, _)) => crate::schematic_client_cache::detail(provider, id)
            .map(|value| normalize_detail(provider, value)),
        Err((false, error)) => Err(error),
    }
}

pub fn filters(provider: &str) -> Result<SchematicFilters> {
    if provider == CREATE_PROVIDER {
        return crate::createmod::filters();
    }
    match get_json(&provider_url(provider, "filters"), &[]) {
        Ok(value) => Ok(value),
        Err((true, _)) => crate::schematic_client_cache::filters(provider),
        Err((false, error)) => Err(error),
    }
}

pub fn download(provider: &str, id: &str, format: &str) -> Result<(String, Vec<u8>)> {
    download_with_progress(provider, id, format, &AtomicBool::new(false), &mut |_, _| {})
}

pub fn download_with_progress(
    provider: &str,
    id: &str,
    format: &str,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(String, Vec<u8>)> {
    if provider == MINECRAFT_SCHEMATICS_PROVIDER {
        return Err(CoreError::Modpack(
            "Minecraft Schematics requires an account; use the browser download flow".to_string(),
        ));
    }
    if !default_provider_formats(provider)
        .iter()
        .any(|v| v == format)
    {
        return Err(CoreError::Modpack(format!(
            "{provider} does not provide .{format} files"
        )));
    }
    let mut response = client()?
        .get(provider_url(provider, &format!("schematics/{id}/download")))
        .query(&[("format", format)])
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !response.status().is_success() {
        return Err(CoreError::Remote(format!(
            "download {provider}/{id} -> {}",
            response.status()
        )));
    }
    let filename = response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split("filename=").nth(1))
        .map(|v| v.trim().trim_matches('"').to_string())
        .unwrap_or_else(|| format!("{provider}-{id}.{format}"));
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let total = response.content_length().unwrap_or(0);
    let mut bytes = Vec::with_capacity(total.min(32 * 1024 * 1024) as usize);
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) { return Err(CoreError::Cancelled); }
        let read = response.read(&mut buffer).map_err(|e| CoreError::Remote(e.to_string()))?;
        if read == 0 { break; }
        bytes.extend_from_slice(&buffer[..read]);
        progress(bytes.len() as u64, total);
    }
    let trimmed = bytes
        .iter()
        .copied()
        .skip_while(|byte| byte.is_ascii_whitespace())
        .take(16)
        .collect::<Vec<_>>();
    if bytes.is_empty()
        || content_type.contains("json")
        || content_type.contains("html")
        || trimmed.starts_with(b"<")
        || trimmed.starts_with(b"{")
        || trimmed.starts_with(b"[")
    {
        return Err(CoreError::Remote(format!(
            "{provider} returned an error page instead of a .{format} file"
        )));
    }
    Ok((filename, bytes))
}

fn mod_haystack(item: &InstalledMod) -> String {
    format!(
        "{} {} {} {}",
        item.filename,
        item.name,
        item.title.as_deref().unwrap_or_default(),
        item.project_id.as_deref().unwrap_or_default()
    )
    .to_ascii_lowercase()
}

fn id_matches(item: &InstalledMod, ids: &[&str]) -> bool {
    item.project_id
        .as_deref()
        .map(|id| ids.iter().any(|known| id == *known))
        .unwrap_or(false)
}

pub fn detect_tools(mods: &[InstalledMod]) -> (bool, bool, bool) {
    let mut create = false;
    let mut litematica = false;
    let mut worldedit = false;
    for item in mods.iter().filter(|m| m.enabled) {
        let hay = mod_haystack(item);
        create |= id_matches(item, CREATE_PROJECT_IDS)
            || (hay.contains("create-") && !hay.contains("creative"));
        litematica |= id_matches(item, LITEMATICA_MODRINTH_IDS)
            || id_matches(item, LITEMATICA_CURSEFORGE_IDS)
            || [
                "litematica",
                "forgematica",
                "litematica-forge",
                "schematica",
            ]
            .iter()
            .any(|name| hay.contains(name));
        worldedit |= id_matches(item, WORLDEDIT_MODRINTH_IDS)
            || id_matches(item, WORLDEDIT_CURSEFORGE_IDS)
            || hay.contains("worldedit");
    }
    (create, litematica, worldedit)
}

fn resolved(instance: &Instance, key: &str, detected: bool) -> bool {
    instance.integrations.get(key).copied().unwrap_or(detected)
}

pub fn status(instance: &Instance, mods: &[InstalledMod]) -> SchematicsStatus {
    let (create, litematica, worldedit) = detect_tools(mods);
    let any_detected = create || litematica || worldedit;
    let targets = compatible_formats(
        litematica,
        worldedit,
        &["nbt", "litematic", "schem", "schematic", "mcstructure"],
    );
    let recommended = (create && !worldedit).then(|| "nbt".to_string());
    let create_provider = SchematicProviderStatus {
            id: CREATE_PROVIDER.into(),
            label: "CreateMod.com".into(),
            enabled: resolved(instance, CREATE_INTEGRATION, any_detected),
            detected: any_detected,
            formats: targets.clone(),
            native_formats: vec!["nbt".into()],
            recommended_format: recommended.clone(),
        };
    let abfielder_provider = SchematicProviderStatus {
            id: ABFIELDER_PROVIDER.into(),
            label: "Abfielder".into(),
            enabled: resolved(instance, ABFIELDER_INTEGRATION, any_detected),
            detected: any_detected,
            formats: targets.clone(),
            native_formats: vec!["litematic".into(), "schem".into(), "mcstructure".into()],
            recommended_format: recommended.clone(),
        };
    let minecraft_provider = SchematicProviderStatus {
            id: MINECRAFT_SCHEMATICS_PROVIDER.into(),
            label: "Minecraft Schematics".into(),
            enabled: resolved(instance, MINECRAFT_SCHEMATICS_INTEGRATION, any_detected),
            detected: any_detected,
            formats: targets,
            native_formats: vec!["schem".into(), "schematic".into()],
            recommended_format: recommended,
        };
    let providers = if create {
        vec![create_provider, abfielder_provider, minecraft_provider]
    } else {
        vec![abfielder_provider, minecraft_provider, create_provider]
    };
    SchematicsStatus {
        enabled: providers.iter().any(|p| p.enabled),
        create_detected: create,
        litematica_detected: litematica,
        worldedit_detected: worldedit,
        mode: "providers".into(),
        providers,
    }
}

fn compatible_formats(litematica: bool, worldedit: bool, available: &[&str]) -> Vec<String> {
    let mut formats = Vec::new();
    for value in available {
        if crate::schematic_convert::can_convert(value)
            || (*value == "litematic" && litematica)
            || ((*value == "schem" || *value == "schematic") && (worldedit || litematica))
            || (*value == "mcstructure" && litematica)
        {
            formats.push((*value).to_string());
        }
    }
    if formats.is_empty() {
        formats = available.iter().map(|v| (*v).to_string()).collect();
    }
    formats
}

pub fn folder_for_format(
    game_dir: &Path,
    instance: &Instance,
    mods: &[InstalledMod],
    format: &str,
) -> PathBuf {
    if let Some(custom) = instance
        .schematic_folders
        .get(format)
        .map(|value| value.trim())
        .filter(|v| !v.is_empty())
    {
        let path = Path::new(custom);
        return if path.is_absolute() {
            path.to_path_buf()
        } else {
            game_dir.join(path)
        };
    }
    let (_, litematica, worldedit) = detect_tools(mods);
    if matches!(format, "schem" | "schematic") && worldedit && !litematica {
        game_dir.join("config/worldedit/schematics")
    } else {
        game_dir.join("schematics")
    }
}

fn supported_format(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "nbt" | "litematic" | "schem" | "schematic" | "mcstructure"
    )
    .then_some(ext)
}

fn provider_native_format(provider: &str, format: &str) -> bool {
    match provider {
        CREATE_PROVIDER => format == "nbt",
        MINECRAFT_SCHEMATICS_PROVIDER => matches!(format, "schem" | "schematic"),
        ABFIELDER_PROVIDER => matches!(format, "litematic" | "schem" | "mcstructure"),
        _ => false,
    }
}

fn read_index(path: &Path) -> InstalledIndex {
    std::fs::read(path)
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_default()
}
fn write_index(path: &Path, index: &InstalledIndex) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    let bytes =
        serde_json::to_vec_pretty(index).map_err(|e| CoreError::serde("schematics metadata", e))?;
    std::fs::write(path, bytes).map_err(|e| CoreError::io(path, e))
}
fn path_key(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
fn local_title(filename: &str) -> String {
    Path::new(filename)
        .file_stem()
        .map(|v| v.to_string_lossy().replace(['_', '-'], " "))
        .unwrap_or_else(|| filename.into())
}

pub fn list_installed(
    game_dir: &Path,
    index_path: &Path,
    instance: &Instance,
    mods: &[InstalledMod],
) -> Result<Vec<InstalledSchematic>> {
    let index = read_index(index_path);
    let mut dirs = BTreeSet::new();
    for format in ["nbt", "litematic", "schem", "schematic", "mcstructure"] {
        dirs.insert(folder_for_format(game_dir, instance, mods, format));
    }
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for dir in dirs {
        let read = match std::fs::read_dir(&dir) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(CoreError::io(&dir, e)),
        };
        for entry in read.flatten() {
            let path = entry.path();
            if !entry.file_type().map(|v| v.is_file()).unwrap_or(false) {
                continue;
            }
            let Some(format) = supported_format(&path) else {
                continue;
            };
            if !seen.insert(path.clone()) {
                continue;
            }
            let filename = entry.file_name().to_string_lossy().to_string();
            let meta = index
                .entries
                .get(&path_key(&path))
                .or_else(|| index.entries.get(&filename));
            out.push(InstalledSchematic {
                filename: filename.clone(),
                path: path_key(&path),
                title: meta
                    .map(|m| m.title.clone())
                    .unwrap_or_else(|| local_title(&filename)),
                description: meta.and_then(|m| m.description.clone()),
                image_url: meta.and_then(|m| m.image_url.clone()),
                author: meta.and_then(|m| m.author.clone()),
                source: meta
                    .map(|m| m.provider.clone())
                    .filter(|value| !value.is_empty()),
                project_id: meta
                    .map(|m| m.project_id.clone())
                    .filter(|value| !value.is_empty()),
                web_url: meta.and_then(|m| m.web_url.clone()),
                format,
                original_format: meta.and_then(|m| m.original_format.clone()),
            });
        }
    }
    // Older index entries predate explicit conversion provenance. Backfill only
    // when a matching native provider file makes the relationship unambiguous.
    let installed_snapshot = out.clone();
    for item in &mut out {
        if item.original_format.is_some() {
            continue;
        }
        let (Some(source), Some(project_id)) = (&item.source, &item.project_id) else {
            continue;
        };
        if provider_native_format(source, &item.format) {
            continue;
        }
        let native_formats: BTreeSet<_> = installed_snapshot
            .iter()
            .filter(|candidate| {
                candidate.source.as_ref() == Some(source)
                    && candidate.project_id.as_ref() == Some(project_id)
                    && candidate.path != item.path
                    && provider_native_format(source, &candidate.format)
            })
            .map(|candidate| candidate.format.clone())
            .collect();
        if native_formats.len() == 1 {
            item.original_format = native_formats.into_iter().next();
        }
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(out)
}

pub fn record(
    index_path: &Path,
    path: &Path,
    provider: &str,
    id: &str,
    format: &str,
    original_format: Option<&str>,
    detail: Option<&SchematicDetail>,
) -> Result<()> {
    let mut index = read_index(index_path);
    let filename = path
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{id}.{format}"));
    let metadata = InstalledMetadata {
            provider: provider.into(),
            project_id: id.into(),
            format: format.into(),
            original_format: original_format
                .filter(|source| !source.eq_ignore_ascii_case(format))
                .map(str::to_string),
            title: detail
                .map(|d| d.title.clone())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| local_title(&filename)),
            description: detail.map(|d| d.excerpt.clone()).filter(|v| !v.is_empty()),
            image_url: detail.and_then(|d| d.featured_image.clone()),
            author: detail.and_then(|d| d.author.clone()),
            web_url: detail.and_then(|d| d.web_url.clone()),
        };
    index.entries.insert(path_key(path), metadata.clone());
    // Global schematic folders share this index between instances. Absolute
    // paths differ per instance, while the filename remains portable.
    index.entries.insert(filename, metadata);
    write_index(index_path, &index)
}

pub fn forget(index_path: &Path, path: &Path) -> Result<()> {
    let mut index = read_index(index_path);
    index.entries.remove(&path_key(path));
    index.entries.remove(
        path.file_name()
            .and_then(|v| v.to_str())
            .unwrap_or_default(),
    );
    write_index(index_path, &index)
}

pub fn safe_download_filename(suggested: &str, id: &str, format: &str) -> String {
    Path::new(suggested)
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .filter(|v| v.to_ascii_lowercase().ends_with(&format!(".{format}")))
        .unwrap_or_else(|| format!("{id}.{format}"))
}

pub fn converted_filename(source: &Path, source_format: &str, target_format: &str) -> PathBuf {
    let stem = source
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "schematic".to_string());
    let base = stem
        .rsplit_once("-converted-from-")
        .map(|(base, _)| base)
        .filter(|base| !base.is_empty())
        .unwrap_or(&stem);
    PathBuf::from(format!(
        "{base}-converted-from-{}.{}",
        source_format.to_ascii_lowercase(),
        target_format.to_ascii_lowercase()
    ))
}

pub fn non_overwriting_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "schematic".to_string());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_string());
    for copy in 2.. {
        let mut candidate = parent.join(format!("{stem}-{copy}"));
        if let Some(extension) = &extension {
            candidate.set_extension(extension);
        }
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

pub fn formats_filter(provider: &str) -> Vec<FilterOption> {
    default_provider_formats(provider)
        .into_iter()
        .map(|v| FilterOption {
            label: format!(".{v}"),
            value: v,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mc(id: Option<&str>, file: &str) -> InstalledMod {
        InstalledMod {
            name: file.into(),
            filename: file.into(),
            path: file.into(),
            side: "client".into(),
            category: "mod".into(),
            enabled: true,
            managed: false,
            source: "local".into(),
            project_id: id.map(str::to_string),
            version_id: None,
            version: None,
            title: None,
            description: None,
            icon_url: None,
        }
    }
    #[test]
    fn detects_known_tools_and_forks() {
        let (c, l, w) = detect_tools(&[
            mc(Some("LNytGWDc"), "create.jar"),
            mc(Some("dCKRaeBC"), "port.jar"),
            mc(Some("225608"), "we.jar"),
        ]);
        assert!(c && l && w);
    }

    #[test]
    fn detects_create_fabric_by_modrinth_curseforge_and_filename() {
        assert!(detect_tools(&[mc(Some(CREATE_FABRIC_MODRINTH_ID), "renamed.jar")]).0);
        assert!(detect_tools(&[mc(Some(CREATE_FABRIC_CURSEFORGE_ID), "renamed.jar")]).0);
        assert!(detect_tools(&[mc(None, "create-fabric-1.20.1-0.5.1.jar")]).0);
    }
    #[test]
    fn worldedit_only_uses_config_folder() {
        let i = Instance::new_custom(
            "i",
            "i",
            "1.21.1",
            crate::instance::LoaderKind::Fabric,
            crate::instance::LoaderVersion::default(),
            crate::instance::PackSource::None,
        );
        let p = folder_for_format(
            Path::new("/game"),
            &i,
            &[mc(None, "worldedit-mod.jar")],
            "schem",
        );
        assert_eq!(p, Path::new("/game/config/worldedit/schematics"));
    }

    #[test]
    fn createmod_provider_can_be_forced_on_without_detection() {
        let mut instance = Instance::new_custom(
            "i",
            "i",
            "1.21.1",
            crate::instance::LoaderKind::Fabric,
            crate::instance::LoaderVersion::default(),
            crate::instance::PackSource::None,
        );
        instance
            .integrations
            .insert(CREATE_INTEGRATION.into(), true);
        let result = status(&instance, &[mc(None, "worldedit-mod.jar")]);
        let create = result
            .providers
            .iter()
            .find(|provider| provider.id == CREATE_PROVIDER)
            .unwrap();
        assert!(create.enabled);
        assert!(
            result
                .providers
                .iter()
                .find(|provider| provider.id == MINECRAFT_SCHEMATICS_PROVIDER)
                .unwrap()
                .enabled
        );
    }

    #[test]
    fn all_providers_are_available_for_create_only_instances() {
        let instance = Instance::new_custom(
            "i", "i", "1.21.1", crate::instance::LoaderKind::Fabric,
            crate::instance::LoaderVersion::default(), crate::instance::PackSource::None,
        );
        let result = status(&instance, &[mc(None, "create-fabric.jar")]);
        assert_eq!(result.providers[0].id, CREATE_PROVIDER);
        assert!(result.providers.iter().all(|provider| provider.enabled));
        assert!(result.providers.iter().all(|provider| {
            provider.recommended_format.as_deref() == Some("nbt")
                && provider.formats.iter().any(|format| format == "litematic")
        }));
    }

    #[test]
    fn abfielder_leads_and_createmod_is_available_without_create() {
        let instance = Instance::new_custom(
            "i", "i", "1.21.1", crate::instance::LoaderKind::Fabric,
            crate::instance::LoaderVersion::default(), crate::instance::PackSource::None,
        );
        let result = status(&instance, &[mc(None, "worldedit-mod.jar")]);
        assert_eq!(result.providers[0].id, ABFIELDER_PROVIDER);
        assert!(result.providers.iter().find(|provider| provider.id == CREATE_PROVIDER).unwrap().enabled);
        assert!(result.providers.iter().all(|provider| provider.recommended_format.is_none()));
    }

    #[test]
    fn detects_cache_rate_limit_responses() {
        assert!(is_rate_limited(429, ""));
        assert!(is_rate_limited(502, r#"{"error":"rate limited upstream"}"#));
        assert!(!is_rate_limited(502, r#"{"error":"bad gateway"}"#));
    }

    #[test]
    fn classic_schematic_files_are_scanned_as_supported() {
        assert_eq!(
            supported_format(Path::new("Roxwood Cabin.SCHEMATIC")).as_deref(),
            Some("schematic")
        );
    }

    #[test]
    fn converted_filenames_are_explicit_and_never_reuse_the_original_name() {
        assert_eq!(
            converted_filename(Path::new("Roxwood Cabin.nbt"), "nbt", "schem"),
            Path::new("Roxwood Cabin-converted-from-nbt.schem")
        );
        assert_eq!(
            converted_filename(
                Path::new("Roxwood Cabin-converted-from-nbt.schem"),
                "schem",
                "nbt",
            ),
            Path::new("Roxwood Cabin-converted-from-schem.nbt")
        );
    }

    #[test]
    fn converted_filenames_do_not_overwrite_an_existing_conversion() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("cabin-converted-from-nbt.schem");
        std::fs::write(&first, b"first").unwrap();
        assert_eq!(
            non_overwriting_path(&first),
            root.path().join("cabin-converted-from-nbt-2.schem")
        );
    }

    #[test]
    fn converted_local_schematics_keep_their_source_format() {
        let root = tempfile::tempdir().unwrap();
        let schematics_dir = root.path().join("schematics");
        std::fs::create_dir_all(&schematics_dir).unwrap();
        let schematic = schematics_dir.join("cabin.schem");
        std::fs::write(&schematic, b"converted").unwrap();
        let index = root.path().join("installed-schematics.json");
        record(&index, &schematic, "", "", "schem", Some("nbt"), None).unwrap();

        let instance = Instance::new_custom(
            "i",
            "i",
            "1.21.1",
            crate::instance::LoaderKind::Fabric,
            crate::instance::LoaderVersion::default(),
            crate::instance::PackSource::None,
        );
        let installed = list_installed(root.path(), &index, &instance, &[]).unwrap();

        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].format, "schem");
        assert_eq!(installed[0].original_format.as_deref(), Some("nbt"));
        assert_eq!(installed[0].source, None);
        assert_eq!(installed[0].project_id, None);
    }

    #[test]
    fn legacy_provider_conversion_is_inferred_from_its_native_copy() {
        let root = tempfile::tempdir().unwrap();
        let schematics_dir = root.path().join("schematics");
        std::fs::create_dir_all(&schematics_dir).unwrap();
        let native = schematics_dir.join("cabin.nbt");
        let converted = schematics_dir.join("cabin.schem");
        std::fs::write(&native, b"native").unwrap();
        std::fs::write(&converted, b"converted").unwrap();
        let index = root.path().join("installed-schematics.json");
        record(&index, &native, CREATE_PROVIDER, "42", "nbt", None, None).unwrap();
        record(
            &index,
            &converted,
            CREATE_PROVIDER,
            "42",
            "schem",
            None,
            None,
        )
        .unwrap();

        let instance = Instance::new_custom(
            "i",
            "i",
            "1.21.1",
            crate::instance::LoaderKind::Fabric,
            crate::instance::LoaderVersion::default(),
            crate::instance::PackSource::None,
        );
        let installed = list_installed(root.path(), &index, &instance, &[]).unwrap();
        let native = installed.iter().find(|item| item.format == "nbt").unwrap();
        let converted = installed
            .iter()
            .find(|item| item.format == "schem")
            .unwrap();

        assert_eq!(native.original_format, None);
        assert_eq!(converted.original_format.as_deref(), Some("nbt"));
    }
}
