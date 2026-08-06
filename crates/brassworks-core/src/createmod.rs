use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::{CoreError, Result};
use crate::instance::Instance;
use crate::modpack::InstalledMod;

pub const CREATEMOD_API_BASE: &str = match option_env!("CREATEMOD_API_BASE") {
    Some(v) => v,
    None => "https://createmod.com",
};
// Downloads go straight to createmod.com (never the cache, since files aren't
// cached) and are authenticated with the shared HMAC secret distributed with
// the launcher, like a client id. The secret has no per-key rate limit.
const CREATEMOD_DOWNLOAD_BASE: &str = match option_env!("CREATEMOD_DOWNLOAD_BASE") {
    Some(v) => v,
    None => "https://createmod.com",
};
const CREATEMOD_DOWNLOAD_SECRET: &str =
    "9bc0fdf937f05a30befb17abb8a455a41887d3f84e93aaa73c3e3e0c1f202a5f";

fn download_secret() -> &'static str {
    option_env!("CREATEMOD_DOWNLOAD_SECRET").unwrap_or(CREATEMOD_DOWNLOAD_SECRET)
}

pub const INTEGRATION_SCHEMATICS: &str = "createmod_schematics";
pub const CREATE_MODRINTH_ID: &str = "LNytGWDc";
pub const CREATE_CURSEFORGE_ID: &str = "328085";
pub const CREATE_FABRIC_MODRINTH_ID: &str = "Xbc0uyRg";
pub const CREATE_FABRIC_CURSEFORGE_ID: &str = "624165";

const CREATE_PROJECT_IDS: &[&str] = &[
    CREATE_MODRINTH_ID,
    CREATE_CURSEFORGE_ID,
    CREATE_FABRIC_MODRINTH_ID,
    CREATE_FABRIC_CURSEFORGE_ID,
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicCard {
    #[serde(default = "default_createmod_provider")]
    pub provider: String,
    pub name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub featured_image: Option<String>,
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub views: i64,
    #[serde(default)]
    pub downloads: i64,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub web_url: Option<String>,
    #[serde(default)]
    pub formats: Vec<String>,
    #[serde(default = "default_true")]
    pub supports_views: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicMaterial {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub count: i64,
    #[serde(default)]
    pub block_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicRequiredMod {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicVersionHistory {
    pub version: String,
    pub date: String,
    pub changes: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SchematicDimensions {
    #[serde(default)]
    pub x: i64,
    #[serde(default)]
    pub y: i64,
    #[serde(default)]
    pub z: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicDetail {
    #[serde(default = "default_createmod_provider")]
    pub provider: String,
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub uploaded_at: String,
    #[serde(default)]
    pub description_html: String,
    #[serde(default)]
    pub excerpt: String,
    #[serde(default)]
    pub featured_image: Option<String>,
    #[serde(default)]
    pub gallery: Vec<String>,
    #[serde(default)]
    pub video: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub required_mods: Vec<String>,
    #[serde(default)]
    pub required_mod_details: Vec<SchematicRequiredMod>,
    #[serde(default)]
    pub dependencies_html: String,
    #[serde(default)]
    pub materials: Vec<SchematicMaterial>,
    #[serde(default)]
    pub version_history: Vec<SchematicVersionHistory>,
    #[serde(default)]
    pub minecraft_version: String,
    #[serde(default)]
    pub createmod_version: String,
    #[serde(default)]
    pub block_count: i64,
    #[serde(default)]
    pub dimensions: SchematicDimensions,
    #[serde(default)]
    pub views: i64,
    #[serde(default)]
    pub downloads: i64,
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub rating_count: i64,
    #[serde(default)]
    pub comment_count: i64,
    #[serde(default)]
    pub web_url: Option<String>,
    #[serde(default)]
    pub formats: Vec<String>,
    #[serde(default = "default_true")]
    pub supports_views: bool,
}

fn default_createmod_provider() -> String {
    "createmod".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SchematicHome {
    #[serde(default)]
    pub trending: Vec<SchematicCard>,
    #[serde(default)]
    pub latest: Vec<SchematicCard>,
    #[serde(default)]
    pub highest: Vec<SchematicCard>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SchematicSearch {
    #[serde(default)]
    pub items: Vec<SchematicCard>,
    #[serde(default)]
    pub page: u32,
    #[serde(default)]
    pub has_next: bool,
    #[serde(default)]
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterOption {
    pub value: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SchematicFilters {
    #[serde(default)]
    pub categories: Vec<FilterOption>,
    #[serde(default)]
    pub mc_versions: Vec<FilterOption>,
    #[serde(default)]
    pub create_versions: Vec<FilterOption>,
    #[serde(default)]
    pub formats: Vec<FilterOption>,
    #[serde(default)]
    pub themes: Vec<FilterOption>,
    #[serde(default)]
    pub sizes: Vec<FilterOption>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SchematicSearchParams {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub mc_version: String,
    #[serde(default)]
    pub create_version: String,
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub size: String,
    #[serde(default)]
    pub page: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicsStatus {
    pub enabled: bool,
    pub create_detected: bool,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicStat {
    pub name: String,
    #[serde(default)]
    pub views: i64,
    #[serde(default)]
    pub downloads: i64,
    #[serde(default)]
    pub rating: f64,
    #[serde(default, rename = "ratingCount")]
    pub rating_count: i64,
    #[serde(default, rename = "commentCount")]
    pub comment_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledSchematic {
    pub filename: String,
    pub path: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub web_url: Option<String>,
    #[serde(default)]
    pub format: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledSchematicMetadata {
    project_id: String,
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
struct InstalledSchematicsIndex {
    #[serde(default)]
    entries: std::collections::BTreeMap<String, InstalledSchematicMetadata>,
}

fn read_installed_index(path: &std::path::Path) -> InstalledSchematicsIndex {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_installed_index(path: &std::path::Path, index: &InstalledSchematicsIndex) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    let bytes =
        serde_json::to_vec_pretty(index).map_err(|e| CoreError::serde("schematics metadata", e))?;
    std::fs::write(path, bytes).map_err(|e| CoreError::io(path, e))
}

fn local_schematic_title(filename: &str) -> String {
    std::path::Path::new(filename)
        .file_stem()
        .map(|stem| stem.to_string_lossy().replace(['_', '-'], " "))
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| filename.to_string())
}

pub fn list_installed_schematics(
    schematics_dir: &std::path::Path,
    index_path: &std::path::Path,
) -> Result<Vec<InstalledSchematic>> {
    let read = match std::fs::read_dir(schematics_dir) {
        Ok(read) => read,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(CoreError::io(schematics_dir, e)),
    };
    let index = read_installed_index(index_path);
    let mut installed = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if !entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
            || !path
                .extension()
                .map(|ext| ext.eq_ignore_ascii_case("nbt"))
                .unwrap_or(false)
        {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        let metadata = index.entries.get(&filename);
        installed.push(InstalledSchematic {
            title: metadata
                .map(|entry| entry.title.clone())
                .filter(|title| !title.trim().is_empty())
                .unwrap_or_else(|| local_schematic_title(&filename)),
            description: metadata.and_then(|entry| entry.description.clone()),
            image_url: metadata.and_then(|entry| entry.image_url.clone()),
            author: metadata.and_then(|entry| entry.author.clone()),
            source: metadata.map(|_| "createmod".to_string()),
            project_id: metadata.map(|entry| entry.project_id.clone()),
            web_url: metadata.and_then(|entry| entry.web_url.clone()),
            path: path.to_string_lossy().to_string(),
            filename,
            format: "nbt".to_string(),
        });
    }
    installed.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(installed)
}

pub fn record_installed_schematic(
    index_path: &std::path::Path,
    filename: &str,
    project_id: &str,
    detail: Option<&SchematicDetail>,
) -> Result<()> {
    let mut index = read_installed_index(index_path);
    let metadata = InstalledSchematicMetadata {
        project_id: project_id.to_string(),
        title: detail
            .map(|item| item.title.clone())
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| local_schematic_title(filename)),
        description: detail
            .map(|item| item.excerpt.trim().to_string())
            .filter(|text| !text.is_empty()),
        image_url: detail.and_then(|item| item.featured_image.clone()),
        author: detail.and_then(|item| item.author.clone()),
        web_url: detail.and_then(|item| item.web_url.clone()),
    };
    index.entries.insert(filename.to_string(), metadata);
    write_installed_index(index_path, &index)
}

pub fn forget_installed_schematic(index_path: &std::path::Path, filename: &str) -> Result<()> {
    let mut index = read_installed_index(index_path);
    if index.entries.remove(filename).is_some() {
        write_installed_index(index_path, &index)?;
    }
    Ok(())
}

fn sort_to_order(sort: &str) -> i32 {
    match sort {
        "newest" => 2,
        "oldest" => 3,
        "highest_rated" => 4,
        "lowest_rated" => 5,
        "most_viewed" => 6,
        "least_viewed" => 7,
        "trending" => 8,
        _ => 1,
    }
}

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| CoreError::Remote(e.to_string()))
}

// The cache proxy mirrors the createmod paths and is the sole source for
// browsing metadata. Keeping this path unconditional avoids exposing upstream
// credentials in the launcher and prevents transient health-check failures
// from bypassing the shared cache for the rest of the process.
fn cache_base() -> String {
    let raw = std::env::var("SCHEMATICS_CACHE_BASE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("CREATEMOD_CACHE_BASE").ok())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| option_env!("SCHEMATICS_CACHE_BASE").map(|s| s.to_string()))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| option_env!("CREATEMOD_CACHE_BASE").map(|s| s.to_string()))
        .unwrap_or_else(|| "https://api.opnsoc.org/createmodschem".to_string());
    raw.trim().trim_end_matches('/').to_string()
}

// Image/file URLs baked into cards and details use the cache CDN too.
fn image_base() -> String {
    cache_base()
}

fn get_json<T: serde::de::DeserializeOwned>(path: &str, params: &[(&str, String)]) -> Result<T> {
    let client = client()?;
    let url = format!("{}{path}", cache_base());
    let response = client
        .get(&url)
        .query(params)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| CoreError::Remote(error.to_string()))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(CoreError::Remote(format!("{path} -> {status}: {body}")));
    }
    response
        .json()
        .map_err(|error| CoreError::Remote(format!("decode {path}: {error}")))
}

fn null_default<'de, D, T>(deserializer: D) -> std::result::Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Option::<T>::deserialize(deserializer).map(Option::unwrap_or_default)
}

#[derive(Deserialize, Default)]
struct RawSchematic {
    #[serde(default)]
    id: Option<String>,
    #[serde(default, deserialize_with = "null_default")]
    name: String,
    #[serde(default, deserialize_with = "null_default")]
    title: String,
    #[serde(default)]
    author: Option<serde_json::Value>,
    #[serde(default, deserialize_with = "null_default")]
    created: String,
    #[serde(default, rename = "htmlContent", deserialize_with = "null_default")]
    html_content: String,
    #[serde(default, deserialize_with = "null_default")]
    content: String,
    #[serde(default, deserialize_with = "null_default")]
    excerpt: String,
    #[serde(default, rename = "featuredImage", deserialize_with = "null_default")]
    featured_image: String,
    #[serde(default, deserialize_with = "null_default")]
    gallery: Vec<String>,
    #[serde(default, deserialize_with = "null_default")]
    video: String,
    #[serde(default, deserialize_with = "null_default")]
    categories: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "null_default")]
    tags: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "null_default")]
    mods: Vec<String>,
    #[serde(
        default,
        rename = "htmlDependencies",
        deserialize_with = "null_default"
    )]
    html_dependencies: String,
    #[serde(default)]
    materials: serde_json::Value,
    #[serde(
        default,
        rename = "minecraftVersion",
        deserialize_with = "null_default"
    )]
    minecraft_version: String,
    #[serde(
        default,
        rename = "createmodVersion",
        deserialize_with = "null_default"
    )]
    createmod_version: String,
    #[serde(default, rename = "blockCount", deserialize_with = "null_default")]
    block_count: i64,
    #[serde(default, rename = "dimX", deserialize_with = "null_default")]
    dim_x: i64,
    #[serde(default, rename = "dimY", deserialize_with = "null_default")]
    dim_y: i64,
    #[serde(default, rename = "dimZ", deserialize_with = "null_default")]
    dim_z: i64,
    #[serde(default, deserialize_with = "null_default")]
    views: i64,
    #[serde(default, deserialize_with = "null_default")]
    downloads: i64,
    #[serde(default)]
    rating: serde_json::Value,
    #[serde(default, rename = "ratingCount", deserialize_with = "null_default")]
    rating_count: i64,
    #[serde(default, rename = "commentCount", deserialize_with = "null_default")]
    comment_count: i64,
}

fn json_str(v: &serde_json::Value, keys: &[&str]) -> Option<String> {
    if let Some(s) = v.as_str() {
        return Some(s.to_string());
    }
    if let Some(obj) = v.as_object() {
        for k in keys {
            if let Some(s) = obj.get(*k).and_then(|x| x.as_str()) {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
        }
    }
    None
}

fn name_list(vals: &[serde_json::Value]) -> Vec<String> {
    vals.iter()
        .filter_map(|v| json_str(v, &["name", "Name"]))
        .filter(|s| !s.is_empty())
        .collect()
}

fn image_url(id: Option<&str>, file: &str) -> Option<String> {
    if file.is_empty() {
        return None;
    }
    if file.starts_with("http") {
        return Some(file.to_string());
    }
    let id = id?;
    Some(format!("{}/api/files/schematics/{id}/{file}", image_base()))
}

fn parse_rating(v: &serde_json::Value) -> Option<f64> {
    if let Some(n) = v.as_f64() {
        return if n > 0.0 { Some(n) } else { None };
    }
    if let Some(s) = v.as_str() {
        if let Ok(n) = s.trim().parse::<f64>() {
            return if n > 0.0 { Some(n) } else { None };
        }
    }
    None
}

fn parse_material_line(line: &str) -> Option<SchematicMaterial> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let bytes = line.as_bytes();
    if bytes[0].is_ascii_digit() {
        let mut i = 0;
        while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b',' || bytes[i] == b'.')
        {
            i += 1;
        }
        let count: i64 = line[..i].replace(',', "").parse().unwrap_or(0);
        let rest = line[i..]
            .trim_start()
            .trim_start_matches(['x', 'X', '×'])
            .trim();
        return Some(SchematicMaterial {
            name: rest.to_string(),
            count,
            block_id: None,
        });
    }
    Some(SchematicMaterial {
        name: line.to_string(),
        count: 0,
        block_id: None,
    })
}

fn friendly_block_name(id: &str) -> String {
    let local = id.rsplit(':').next().unwrap_or(id);
    let words: Vec<String> = local
        .split('_')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect();
    if words.is_empty() {
        id.to_string()
    } else {
        words.join(" ")
    }
}

fn parse_materials(v: &serde_json::Value) -> Vec<SchematicMaterial> {
    if let Some(arr) = v.as_array() {
        return arr
            .iter()
            .filter_map(|m| {
                let block_id = m
                    .get("block_id")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());
                let name = json_str(m, &["name", "Name"])
                    .or_else(|| block_id.as_deref().map(friendly_block_name))?;
                let count = m.get("count").and_then(|c| c.as_i64()).unwrap_or(0);
                Some(SchematicMaterial {
                    name,
                    count,
                    block_id,
                })
            })
            .collect();
    }
    if let Some(s) = v.as_str() {
        let trimmed = s.trim();
        if trimmed.starts_with('[') || trimmed.starts_with('{') {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if parsed.is_array() || parsed.is_object() {
                    return parse_materials(&parsed);
                }
            }
        }
        return trimmed
            .split(['\n', ','])
            .filter_map(parse_material_line)
            .collect();
    }
    Vec::new()
}

impl RawSchematic {
    fn into_card(self) -> SchematicCard {
        let image = image_url(self.id.as_deref(), &self.featured_image);
        SchematicCard {
            provider: default_createmod_provider(),
            web_url: if self.name.is_empty() {
                None
            } else {
                Some(format!("{CREATEMOD_API_BASE}/schematics/{}", self.name))
            },
            author: self
                .author
                .as_ref()
                .and_then(|a| json_str(a, &["username", "Username", "name"])),
            rating: parse_rating(&self.rating),
            categories: name_list(&self.categories),
            tags: name_list(&self.tags),
            featured_image: image,
            description: self.excerpt.clone(),
            title: if self.title.is_empty() {
                self.name.clone()
            } else {
                self.title.clone()
            },
            name: self.name,
            views: self.views,
            downloads: self.downloads,
            formats: vec!["nbt".to_string()],
            supports_views: true,
        }
    }

    fn into_detail(self) -> SchematicDetail {
        let image = image_url(self.id.as_deref(), &self.featured_image);
        let gallery = self
            .gallery
            .iter()
            .filter_map(|g| image_url(self.id.as_deref(), g))
            .collect();
        let description = if !self.html_content.trim().is_empty() {
            self.html_content.trim().to_string()
        } else {
            self.content.trim().to_string()
        };
        let required_mod_details = self
            .mods
            .iter()
            .map(|id| SchematicRequiredMod {
                id: id.clone(),
                name: friendly_block_name(id),
                image_url: None,
                web_url: Some(format!("{CREATEMOD_API_BASE}/mods/{id}")),
            })
            .collect();
        SchematicDetail {
            provider: default_createmod_provider(),
            web_url: if self.name.is_empty() {
                None
            } else {
                Some(format!("{CREATEMOD_API_BASE}/schematics/{}", self.name))
            },
            author: self
                .author
                .as_ref()
                .and_then(|a| json_str(a, &["username", "Username", "name"])),
            uploaded_at: self.created,
            rating: parse_rating(&self.rating),
            categories: name_list(&self.categories),
            tags: name_list(&self.tags),
            required_mods: self.mods,
            required_mod_details,
            materials: parse_materials(&self.materials),
            version_history: Vec::new(),
            featured_image: image,
            gallery,
            title: if self.title.is_empty() {
                self.name.clone()
            } else {
                self.title.clone()
            },
            description_html: description,
            excerpt: self.excerpt,
            dependencies_html: self.html_dependencies,
            video: self.video,
            minecraft_version: self.minecraft_version,
            createmod_version: self.createmod_version,
            block_count: self.block_count,
            dimensions: SchematicDimensions {
                x: self.dim_x,
                y: self.dim_y,
                z: self.dim_z,
            },
            views: self.views,
            downloads: self.downloads,
            rating_count: self.rating_count,
            comment_count: self.comment_count,
            id: self.id,
            name: self.name,
            formats: vec!["nbt".to_string()],
            supports_views: true,
        }
    }
}

fn decode_html_text(value: &str) -> String {
    value
        .trim()
        .replace("&amp;", "&")
        .replace("&#39;", "'")
        .replace("&#43;", "+")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn enrich_detail_from_page(detail: &mut SchematicDetail, html: &str) {
    static MOD_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static VERSION_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let mod_re = MOD_RE.get_or_init(|| {
        regex::Regex::new(
            r#"(?s)<a href="/mods/([^"]+)" class="cm-modchip[^"]*">\s*<img src="([^"]+)"[^>]*>\s*([^<]+?)\s*</a>"#,
        )
        .expect("valid required-mod regex")
    });
    let version_re = VERSION_RE.get_or_init(|| {
        regex::Regex::new(
            r#"(?s)<div class="cm-vtable__row">\s*<span class="v">([^<]*)</span>\s*<span class="d">([^<]*)</span>\s*<span class="c">([^<]*)</span>\s*</div>"#,
        )
        .expect("valid version-history regex")
    });

    let mods: Vec<SchematicRequiredMod> = mod_re
        .captures_iter(html)
        .map(|capture| {
            let id = decode_html_text(&capture[1]);
            SchematicRequiredMod {
                name: decode_html_text(&capture[3]),
                image_url: Some(decode_html_text(&capture[2])),
                web_url: Some(format!("{CREATEMOD_API_BASE}/mods/{id}")),
                id,
            }
        })
        .collect();
    if !mods.is_empty() {
        detail.required_mod_details = mods;
    }

    detail.version_history = version_re
        .captures_iter(html)
        .map(|capture| SchematicVersionHistory {
            version: decode_html_text(&capture[1]),
            date: decode_html_text(&capture[2]),
            changes: decode_html_text(&capture[3]),
        })
        .collect();
}

#[derive(Deserialize, Default)]
struct RawList {
    #[serde(default)]
    items: Vec<RawSchematic>,
    #[serde(default)]
    page: u32,
    #[serde(default, rename = "hasNext")]
    has_next: bool,
    #[serde(default)]
    total: i64,
}

#[derive(Deserialize, Default)]
struct RawHome {
    #[serde(default)]
    trending: Vec<RawSchematic>,
    #[serde(default)]
    latest: Vec<RawSchematic>,
    #[serde(default, rename = "highestRated")]
    highest_rated: Vec<RawSchematic>,
}

fn cards(items: Vec<RawSchematic>) -> Vec<SchematicCard> {
    items.into_iter().map(RawSchematic::into_card).collect()
}

fn run_search(p: &SchematicSearchParams) -> Result<SchematicSearch> {
    let page = if p.page == 0 { 1 } else { p.page };
    let mut params: Vec<(&str, String)> = vec![
        ("page", page.to_string()),
        ("sort", sort_to_order(&p.sort).to_string()),
    ];
    if !p.query.is_empty() {
        params.push(("query", p.query.clone()));
    }
    if !p.category.is_empty() && p.category != "all" {
        params.push(("category", p.category.clone()));
    }
    if !p.mc_version.is_empty() && p.mc_version != "all" {
        params.push(("mcv", p.mc_version.clone()));
    }
    if !p.create_version.is_empty() && p.create_version != "all" {
        params.push(("cv", p.create_version.clone()));
    }
    let raw: RawList = get_json("/api/schematics", &params)?;
    Ok(SchematicSearch {
        page: if raw.page == 0 { page } else { raw.page },
        has_next: raw.has_next,
        total: raw.total,
        items: cards(raw.items),
    })
}

pub fn home() -> Result<SchematicHome> {
    match get_json::<RawHome>("/api/home", &[]) {
        Ok(raw) => Ok(SchematicHome {
            trending: cards(raw.trending),
            latest: cards(raw.latest),
            highest: cards(raw.highest_rated),
        }),
        Err(_) => {
            let trending = run_search(&SchematicSearchParams {
                sort: "trending".to_string(),
                page: 1,
                ..Default::default()
            })?;
            Ok(SchematicHome {
                trending: trending.items.into_iter().take(12).collect(),
                latest: Vec::new(),
                highest: Vec::new(),
            })
        }
    }
}

pub fn detail(name: &str) -> Result<SchematicDetail> {
    let raw: RawSchematic = get_json(&format!("/api/schematics/{name}"), &[])?;
    let mut detail = raw.into_detail();
    let page_url = format!("{CREATEMOD_DOWNLOAD_BASE}/schematics/{name}");
    if let Ok(response) = client()?
        .get(page_url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
    {
        if response.status().is_success() {
            if let Ok(html) = response.text() {
                enrich_detail_from_page(&mut detail, &html);
            }
        }
    }
    Ok(detail)
}

// sign_download builds the HMAC message the download endpoint expects
// ("timestamp:modversion:mcusername:identifier") and its hex signature.
fn sign_download(username: &str, identifier: &str) -> Result<(String, String)> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let user = if username.trim().is_empty() {
        "player"
    } else {
        username.trim()
    };
    let message = format!(
        "{ts}:brassworks-{}:{user}:{identifier}",
        env!("CARGO_PKG_VERSION")
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(download_secret().as_bytes())
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    mac.update(message.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());
    Ok((message, signature))
}

fn filename_from_disposition(resp: &reqwest::blocking::Response) -> Option<String> {
    let raw = resp
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)?
        .to_str()
        .ok()?;
    let idx = raw.to_ascii_lowercase().find("filename=")?;
    let val = raw[idx + "filename=".len()..]
        .trim()
        .trim_matches('"')
        .trim();
    let val = val.rsplit(['/', '\\']).next().unwrap_or(val);
    if val.is_empty() {
        None
    } else {
        Some(val.to_string())
    }
}

// download_schematic_bytes fetches the raw .nbt for a schematic straight from
// createmod.com using the shared HMAC secret. Returns the suggested filename
// and the file bytes.
pub fn download_schematic_bytes(name: &str, username: &str) -> Result<(String, Vec<u8>)> {
    let (message, signature) = sign_download(username, name)?;
    let url = format!("{CREATEMOD_DOWNLOAD_BASE}/api/schematics/{name}/download");
    let resp = client()?
        .get(&url)
        .header("X-Mod-Message", message)
        .header("X-Mod-Signature", signature)
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(CoreError::Remote(format!("download {name} -> {status}")));
    }
    let filename = filename_from_disposition(&resp).unwrap_or_else(|| format!("{name}.nbt"));
    let bytes = resp
        .bytes()
        .map_err(|e| CoreError::Remote(e.to_string()))?
        .to_vec();
    Ok((filename, bytes))
}

pub fn stats(names: &[String]) -> Result<Vec<SchematicStat>> {
    if names.is_empty() {
        return Ok(Vec::new());
    }
    get_json("/api/schematics/stats", &[("names", names.join(","))])
}

#[derive(Deserialize, Default)]
struct RawFilterOpt {
    #[serde(default)]
    key: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    value: String,
    #[serde(default)]
    group: String,
    #[serde(default)]
    versions: Vec<String>,
}

#[derive(Deserialize, Default)]
struct RawFilters {
    #[serde(default)]
    categories: Vec<RawFilterOpt>,
    #[serde(default, rename = "minecraftVersions")]
    minecraft_versions: Vec<String>,
    #[serde(default, rename = "createVersions")]
    create_versions: Vec<RawFilterOpt>,
}

pub fn filters() -> Result<SchematicFilters> {
    let raw: RawFilters = match get_json("/api/schematics/filters", &[]) {
        Ok(raw) => raw,
        Err(_) => return Ok(SchematicFilters::default()),
    };
    let categories = raw
        .categories
        .into_iter()
        .filter(|c| !c.key.is_empty())
        .map(|c| FilterOption {
            value: c.key,
            label: c.name,
        })
        .collect();
    let mc_versions = raw
        .minecraft_versions
        .into_iter()
        .map(|v| FilterOption {
            label: v.clone(),
            value: v,
        })
        .collect();
    let mut create_versions = Vec::new();
    for g in raw.create_versions {
        if !g.value.is_empty() {
            create_versions.push(FilterOption {
                value: g.value,
                label: if g.group.is_empty() {
                    "All".to_string()
                } else {
                    g.group
                },
            });
        }
        for v in g.versions {
            create_versions.push(FilterOption {
                label: v.clone(),
                value: v,
            });
        }
    }
    Ok(SchematicFilters {
        categories,
        mc_versions,
        create_versions,
        formats: vec![FilterOption {
            value: "nbt".to_string(),
            label: ".nbt".to_string(),
        }],
        ..Default::default()
    })
}

pub fn search(p: &SchematicSearchParams) -> Result<SchematicSearch> {
    run_search(p)
}

pub fn create_mod_detected(mods: &[InstalledMod]) -> bool {
    mods.iter().any(|m| {
        if m.project_id
            .as_deref()
            .map(|id| CREATE_PROJECT_IDS.contains(&id))
            .unwrap_or(false)
        {
            return true;
        }
        let f = m.filename.to_lowercase();
        f.starts_with("create-") && f.ends_with(".jar")
    })
}

pub fn schematics_status(instance: &Instance, mods: &[InstalledMod]) -> SchematicsStatus {
    let detected = create_mod_detected(mods);
    let (enabled, mode) = match instance.integrations.get(INTEGRATION_SCHEMATICS) {
        Some(true) => (true, "on"),
        Some(false) => (false, "off"),
        None => (detected, "auto"),
    };
    SchematicsStatus {
        enabled,
        create_detected: detected,
        mode: mode.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mc(project_id: Option<&str>, filename: &str) -> InstalledMod {
        InstalledMod {
            name: filename.to_string(),
            filename: filename.to_string(),
            path: filename.to_string(),
            side: "client".to_string(),
            category: "mod".to_string(),
            enabled: true,
            managed: false,
            source: "local".to_string(),
            project_id: project_id.map(|s| s.to_string()),
            version_id: None,
            version: None,
            title: None,
            description: None,
            icon_url: None,
        }
    }

    #[test]
    fn detects_create_by_modrinth_id() {
        assert!(create_mod_detected(&[mc(
            Some(CREATE_MODRINTH_ID),
            "create.jar"
        )]));
    }

    #[test]
    fn detects_create_fabric_from_both_providers() {
        assert!(create_mod_detected(&[mc(
            Some(CREATE_FABRIC_MODRINTH_ID),
            "renamed.jar"
        )]));
        assert!(create_mod_detected(&[mc(
            Some(CREATE_FABRIC_CURSEFORGE_ID),
            "renamed.jar"
        )]));
        assert!(create_mod_detected(&[mc(
            None,
            "create-fabric-0.5.1-build.1417.jar"
        )]));
    }

    #[test]
    fn detects_create_by_filename() {
        assert!(create_mod_detected(&[mc(None, "create-1.20.1-0.5.1.jar")]));
    }

    #[test]
    fn parses_materials_from_json_string() {
        let raw = serde_json::Value::String(
            r#"[{"count": 285, "block_id": "minecraft:grass_block"}, {"count": 72, "block_id": "create:gantry_shaft"}]"#
                .to_string(),
        );
        let mats = parse_materials(&raw);
        assert_eq!(mats.len(), 2);
        assert_eq!(mats[0].name, "Grass Block");
        assert_eq!(mats[0].count, 285);
        assert_eq!(mats[0].block_id.as_deref(), Some("minecraft:grass_block"));
        assert_eq!(mats[1].name, "Gantry Shaft");
    }

    #[test]
    fn search_tolerates_nullable_upstream_fields() {
        let raw: RawList = serde_json::from_str(
            r#"{
                "items": [{
                    "id": "abc",
                    "name": "iron-farm",
                    "title": "Iron Farm",
                    "tags": null,
                    "categories": null,
                    "gallery": null,
                    "mods": null,
                    "featuredImage": null,
                    "views": null,
                    "downloads": null
                }],
                "page": 1,
                "hasNext": false,
                "total": 1
            }"#,
        )
        .unwrap();
        assert_eq!(raw.items.len(), 1);
        assert!(raw.items[0].tags.is_empty());
        assert_eq!(raw.items[0].views, 0);
    }

    #[test]
    fn ignores_other_mods() {
        assert!(!create_mod_detected(&[mc(Some("AABBCCDD"), "sodium.jar")]));
    }

    #[test]
    fn tri_state_resolves() {
        let mut inst = Instance::new_custom(
            "i",
            "i",
            "1.20.1",
            crate::instance::LoaderKind::Fabric,
            crate::instance::LoaderVersion::default(),
            crate::instance::PackSource::None,
        );
        let no_mods: Vec<InstalledMod> = vec![];
        assert_eq!(schematics_status(&inst, &no_mods).enabled, false);
        let with_create = vec![mc(Some(CREATE_MODRINTH_ID), "create.jar")];
        assert_eq!(schematics_status(&inst, &with_create).enabled, true);
        inst.integrations
            .insert(INTEGRATION_SCHEMATICS.to_string(), false);
        assert_eq!(schematics_status(&inst, &with_create).enabled, false);
        inst.integrations
            .insert(INTEGRATION_SCHEMATICS.to_string(), true);
        assert_eq!(schematics_status(&inst, &no_mods).enabled, true);
    }

    #[test]
    fn installed_metadata_only_marks_launcher_downloads() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("brassworks-schematics-{nonce}"));
        let dir = root.join("schematics");
        let index = root.join("schematics.json");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("local-build.nbt"), b"local").unwrap();
        std::fs::write(dir.join("launcher-build.nbt"), b"managed").unwrap();

        record_installed_schematic(&index, "launcher-build.nbt", "steam-engine", None).unwrap();
        let installed = list_installed_schematics(&dir, &index).unwrap();
        let local = installed
            .iter()
            .find(|item| item.filename == "local-build.nbt")
            .unwrap();
        let managed = installed
            .iter()
            .find(|item| item.filename == "launcher-build.nbt")
            .unwrap();
        assert_eq!(local.source, None);
        assert_eq!(local.project_id, None);
        assert_eq!(managed.source.as_deref(), Some("createmod"));
        assert_eq!(managed.project_id.as_deref(), Some("steam-engine"));

        forget_installed_schematic(&index, "launcher-build.nbt").unwrap();
        let installed = list_installed_schematics(&dir, &index).unwrap();
        assert!(installed.iter().all(|item| item.source.is_none()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trims_indented_html_descriptions() {
        let detail = RawSchematic {
            name: "hovercraft".to_string(),
            html_content: "        <p>Rendered HTML</p>\r\n    ".to_string(),
            ..Default::default()
        }
        .into_detail();
        assert_eq!(detail.description_html, "<p>Rendered HTML</p>");
    }

    #[test]
    fn enriches_mods_and_version_history_from_detail_page() {
        let mut detail = RawSchematic {
            name: "hovercraft".to_string(),
            mods: vec!["create_connected".to_string()],
            ..Default::default()
        }
        .into_detail();
        let html = r#"
          <a href="/mods/create_connected" class="cm-modchip text-decoration-none">
            <img src="https://cdn.test/create.png" alt="" loading="lazy">
            Create: Connected
          </a>
          <div class="cm-vtable__row"><span class="v">v2</span><span class="d">2026-07-17 19:10 UTC</span><span class="c">Fields changed: content</span></div>
        "#;
        enrich_detail_from_page(&mut detail, html);
        assert_eq!(detail.required_mod_details[0].name, "Create: Connected");
        assert_eq!(
            detail.required_mod_details[0].image_url.as_deref(),
            Some("https://cdn.test/create.png")
        );
        assert_eq!(detail.version_history[0].version, "v2");
    }
}
