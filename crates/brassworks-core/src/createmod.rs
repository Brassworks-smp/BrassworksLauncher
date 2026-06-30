use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::modpack::InstalledMod;
use crate::instance::Instance;

pub const SCHEMATICS_API_BASE: &str = "https://api.opnsoc.org";

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

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| CoreError::Remote(e.to_string()))
}

fn get_json<T: serde::de::DeserializeOwned>(url: &str, params: &[(&str, String)]) -> Result<T> {
    let resp = client()?
        .get(url)
        .query(params)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CoreError::Remote(format!("{url} -> {}", resp.status())));
    }
    resp.json::<T>()
        .map_err(|e| CoreError::Remote(format!("decode {url}: {e}")))
}

pub fn home() -> Result<SchematicHome> {
    get_json(&format!("{SCHEMATICS_API_BASE}/schematics/home"), &[])
}

pub fn detail(name: &str) -> Result<SchematicDetail> {
    get_json(&format!("{SCHEMATICS_API_BASE}/schematics/{name}"), &[])
}

pub fn filters() -> Result<SchematicFilters> {
    get_json(&format!("{SCHEMATICS_API_BASE}/schematics/filters"), &[])
}

pub fn search(p: &SchematicSearchParams) -> Result<SchematicSearch> {
    let page = if p.page == 0 { 1 } else { p.page };
    let mut params: Vec<(&str, String)> = vec![("page", page.to_string())];
    if !p.query.is_empty() {
        params.push(("query", p.query.clone()));
    }
    if !p.sort.is_empty() {
        params.push(("sort", p.sort.clone()));
    }
    if !p.category.is_empty() && p.category != "all" {
        params.push(("category", p.category.clone()));
    }
    if !p.mc_version.is_empty() && p.mc_version != "all" {
        params.push(("mc_version", p.mc_version.clone()));
    }
    if !p.create_version.is_empty() && p.create_version != "all" {
        params.push(("create_version", p.create_version.clone()));
    }
    get_json(&format!("{SCHEMATICS_API_BASE}/schematics/search"), &params)
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
