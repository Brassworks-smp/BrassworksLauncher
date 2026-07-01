use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::modpack::InstalledMod;
use crate::instance::Instance;

pub const CREATEMOD_API_BASE: &str = match option_env!("CREATEMOD_API_BASE") {
    Some(v) => v,
    None => "https://createmod.com",
};
const CREATEMOD_API_KEY: &str =
    "05c26e2012eb82ddd88d40b04ff0ddddc6159385a516338d8cda798f0ea275ea";

fn api_key() -> &'static str {
    option_env!("CREATEMOD_API_KEY").unwrap_or(CREATEMOD_API_KEY)
}

pub const INTEGRATION_SCHEMATICS: &str = "createmod_schematics";
pub const CREATE_MODRINTH_ID: &str = "LNytGWDc";
pub const CREATE_CURSEFORGE_ID: &str = "328085";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicCard {
    pub name: String,
    #[serde(default)]
    pub title: String,
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
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: Option<String>,
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
    pub dependencies_html: String,
    #[serde(default)]
    pub materials: Vec<SchematicMaterial>,
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

fn get_json<T: serde::de::DeserializeOwned>(path: &str, params: &[(&str, String)]) -> Result<T> {
    let url = format!("{CREATEMOD_API_BASE}{path}");
    let resp = client()?
        .get(&url)
        .query(params)
        .header("Accept", "application/json")
        .header("X-API-Key", api_key())
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(CoreError::Remote(format!("{path} -> {status}")));
    }
    resp.json::<T>()
        .map_err(|e| CoreError::Remote(format!("decode {path}: {e}")))
}

#[derive(Deserialize, Default)]
struct RawSchematic {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    author: Option<serde_json::Value>,
    #[serde(default, rename = "htmlContent")]
    html_content: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    excerpt: String,
    #[serde(default, rename = "featuredImage")]
    featured_image: String,
    #[serde(default)]
    gallery: Vec<String>,
    #[serde(default)]
    video: String,
    #[serde(default)]
    categories: Vec<serde_json::Value>,
    #[serde(default)]
    tags: Vec<serde_json::Value>,
    #[serde(default)]
    mods: Vec<String>,
    #[serde(default, rename = "htmlDependencies")]
    html_dependencies: String,
    #[serde(default)]
    materials: serde_json::Value,
    #[serde(default, rename = "minecraftVersion")]
    minecraft_version: String,
    #[serde(default, rename = "createmodVersion")]
    createmod_version: String,
    #[serde(default, rename = "blockCount")]
    block_count: i64,
    #[serde(default, rename = "dimX")]
    dim_x: i64,
    #[serde(default, rename = "dimY")]
    dim_y: i64,
    #[serde(default, rename = "dimZ")]
    dim_z: i64,
    #[serde(default)]
    views: i64,
    #[serde(default)]
    downloads: i64,
    #[serde(default)]
    rating: serde_json::Value,
    #[serde(default, rename = "ratingCount")]
    rating_count: i64,
    #[serde(default, rename = "commentCount")]
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
    Some(format!("{CREATEMOD_API_BASE}/api/files/schematics/{id}/{file}"))
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
        while i < bytes.len()
            && (bytes[i].is_ascii_digit() || bytes[i] == b',' || bytes[i] == b'.')
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
                let count = m
                    .get("count")
                    .and_then(|c| c.as_i64())
                    .unwrap_or(0);
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
            title: if self.title.is_empty() {
                self.name.clone()
            } else {
                self.title.clone()
            },
            name: self.name,
            views: self.views,
            downloads: self.downloads,
        }
    }

    fn into_detail(self) -> SchematicDetail {
        let image = image_url(self.id.as_deref(), &self.featured_image);
        let gallery = self
            .gallery
            .iter()
            .filter_map(|g| image_url(self.id.as_deref(), g))
            .collect();
        let description = if !self.html_content.is_empty() {
            self.html_content.clone()
        } else {
            self.content.clone()
        };
        SchematicDetail {
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
            required_mods: self.mods,
            materials: parse_materials(&self.materials),
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
        }
    }
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
    Ok(raw.into_detail())
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
    })
}

pub fn search(p: &SchematicSearchParams) -> Result<SchematicSearch> {
    run_search(p)
}

pub fn create_mod_detected(mods: &[InstalledMod]) -> bool {
    mods.iter().any(|m| {
        if m.project_id.as_deref() == Some(CREATE_MODRINTH_ID)
            || m.project_id.as_deref() == Some(CREATE_CURSEFORGE_ID)
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
        assert!(create_mod_detected(&[mc(Some(CREATE_MODRINTH_ID), "create.jar")]));
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
}
