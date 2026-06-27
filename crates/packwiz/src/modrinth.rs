use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{PackwizError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthProject {
    pub id: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub downloads: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub project_id: String,
    #[serde(default)]
    pub slug: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub project_type: String,
    #[serde(default)]
    pub versions: Vec<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub date_modified: Option<String>,
    #[serde(default)]
    pub follows: Option<u64>,
}

fn default_source() -> String {
    "modrinth".to_string()
}

pub(crate) fn modrinth_index(sort: Option<&str>) -> &'static str {
    match sort {
        Some("downloads") => "downloads",
        Some("follows") => "follows",
        Some("newest") => "newest",
        Some("updated") => "updated",
        _ => "relevance",
    }
}

pub(crate) fn build_search_facets(
    project_type: &str,
    loader: Option<&str>,
    game_version: &str,
    filters: &crate::SearchFilters,
) -> String {
    let mut groups: Vec<String> = vec![or_group(&[format!("project_type:{project_type}")])];

    if !filters.game_versions.is_empty() {
        groups.push(or_group(
            &filters
                .game_versions
                .iter()
                .map(|v| format!("versions:{v}"))
                .collect::<Vec<_>>(),
        ));
    } else if !filters.allow_any_version && !game_version.is_empty() {
        groups.push(or_group(&[format!("versions:{game_version}")]));
    }

    if !filters.loaders.is_empty() {
        groups.push(or_group(
            &filters
                .loaders
                .iter()
                .map(|l| format!("categories:{l}"))
                .collect::<Vec<_>>(),
        ));
    } else if !filters.allow_any_loader {
        if let Some(loader) = loader {
            groups.push(or_group(&[format!("categories:{loader}")]));
        }
    }

    for cat in &filters.categories {
        groups.push(or_group(&[format!("categories:{cat}")]));
    }

    match filters.environment.as_deref() {
        Some("client") => groups.push(or_group(&["client_side:required".into()])),
        Some("server") => groups.push(or_group(&["server_side:required".into()])),
        _ => {}
    }
    if filters.open_source {
        groups.push(or_group(&["open_source:true".into()]));
    }
    if let Some(license) = &filters.license {
        groups.push(or_group(&[format!("license:{license}")]));
    }
    if let Some(ts) = filters.created_after {
        groups.push(format!("[\"created_timestamp\",\">=\",\"{ts}\"]"));
    }
    if let Some(ts) = filters.updated_after {
        groups.push(format!("[\"modified_timestamp\",\">=\",\"{ts}\"]"));
    }

    format!("[{}]", groups.join(","))
}

fn or_group(values: &[String]) -> String {
    let inner = values
        .iter()
        .map(|v| format!("\"{}\"", v.replace('"', "")))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{inner}]")
}

#[derive(Deserialize, Default)]
struct ApiCategoryTag {
    name: String,
    project_type: String,
    #[serde(default)]
    icon: String,
}

#[derive(Deserialize, Default)]
struct ApiLoaderTag {
    name: String,
    #[serde(default)]
    supported_project_types: Vec<String>,
}

#[derive(Deserialize, Default)]
struct ApiGameVersionTag {
    version: String,
    version_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedVersion {
    pub version_id: String,
    pub version_number: String,
    pub filename: String,
    pub url: String,
    pub sha512: Option<String>,
    pub sha1: Option<String>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<VersionDep>,
    #[serde(default)]
    pub manual_only: bool,
}

impl ResolvedVersion {
    pub fn verify_data(&self, data: &[u8]) -> std::result::Result<(), String> {
        if let Some(expected) = self.sha512.as_deref().filter(|h| !h.is_empty()) {
            if !crate::sha512_hex(data).eq_ignore_ascii_case(expected) {
                return Err("hash mismatch (corrupt download)".to_string());
            }
        } else if let Some(expected) = self.sha1.as_deref().filter(|h| !h.is_empty()) {
            if !crate::sha1_hex(data).eq_ignore_ascii_case(expected) {
                return Err("hash mismatch (corrupt download)".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionDep {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub required: bool,
}


#[derive(Deserialize)]
struct SearchResponse {
    hits: Vec<SearchHit>,
}

#[derive(Deserialize, Default)]
struct HashVersion {
    #[serde(default)]
    id: String,
    #[serde(default)]
    project_id: String,
}

#[derive(Deserialize)]
struct ApiVersion {
    id: String,
    version_number: String,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default)]
    files: Vec<ApiFile>,
    #[serde(default)]
    dependencies: Vec<ApiDep>,
    #[serde(default)]
    changelog: Option<String>,
}

#[derive(Deserialize, Clone)]
struct ApiDep {
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    version_id: Option<String>,
    #[serde(default)]
    dependency_type: String,
}

impl ApiVersion {
    fn resolve(self) -> Option<ResolvedVersion> {
        let file = self
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| self.files.first())
            .cloned()?;
        let dependencies = self
            .dependencies
            .into_iter()
            .filter_map(|d| {
                if d.project_id.is_none() && d.version_id.is_none() {
                    return None;
                }
                Some(VersionDep {
                    project_id: d.project_id,
                    version_id: d.version_id,
                    required: d.dependency_type == "required",
                })
            })
            .collect();
        Some(ResolvedVersion {
            version_id: self.id,
            version_number: self.version_number,
            filename: file.filename,
            url: file.url,
            sha512: file.hashes.sha512,
            sha1: file.hashes.sha1,
            game_versions: self.game_versions,
            loaders: self.loaders,
            dependencies,
            manual_only: false,
        })
    }
}

#[derive(Deserialize, Clone)]
struct ApiFile {
    url: String,
    filename: String,
    #[serde(default)]
    primary: bool,
    #[serde(default)]
    hashes: ApiHashes,
}

#[derive(Deserialize, Clone, Default)]
struct ApiHashes {
    #[serde(default)]
    sha512: Option<String>,
    #[serde(default)]
    sha1: Option<String>,
}

pub struct Modrinth {
    client: reqwest::blocking::Client,
    cache_dir: PathBuf,
}

impl Modrinth {
    pub fn new(client: reqwest::blocking::Client, cache_dir: impl Into<PathBuf>) -> Self {
        Self {
            client,
            cache_dir: cache_dir.into(),
        }
    }

    fn cache_path(&self, key: &str) -> PathBuf {
        self.cache_dir.join(format!("{key}.v2.json"))
    }

    fn read_cache<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        let bytes = std::fs::read(self.cache_path(key)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    fn write_cache<T: Serialize>(&self, key: &str, value: &T) {
        let _ = std::fs::create_dir_all(&self.cache_dir);
        if let Ok(json) = serde_json::to_vec(value) {
            let _ = std::fs::write(self.cache_path(key), json);
        }
    }

    pub fn project(&self, id: &str) -> Option<ModrinthProject> {
        if let Some(p) = self.read_cache::<ModrinthProject>(id) {
            return Some(p);
        }
        let url = format!("https://api.modrinth.com/v2/project/{id}");
        let resp = self.client.get(&url).send().ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let project: ModrinthProject = resp.json().ok()?;
        self.write_cache(id, &project);
        Some(project)
    }

    pub fn version_changelog(&self, version_id: &str) -> Option<String> {
        let url = format!("https://api.modrinth.com/v2/version/{version_id}");
        let resp = self.client.get(&url).send().ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let v: ApiVersion = resp.json().ok()?;
        v.changelog.filter(|c| !c.trim().is_empty())
    }

    pub fn version_number(&self, version_id: &str) -> Option<String> {
        let key = format!("v-{version_id}");
        if let Some(n) = self.read_cache::<String>(&key) {
            return Some(n);
        }
        let url = format!("https://api.modrinth.com/v2/version/{version_id}");
        let resp = self.client.get(&url).send().ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let v: ApiVersion = resp.json().ok()?;
        self.write_cache(&key, &v.version_number);
        Some(v.version_number)
    }

    pub fn search(
        &self,
        query: &str,
        project_type: &str,
        loader: Option<&str>,
        game_version: &str,
        filters: &crate::SearchFilters,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        let facets = build_search_facets(project_type, loader, game_version, filters);
        let index = modrinth_index(filters.sort.as_deref());

        let resp = self
            .client
            .get("https://api.modrinth.com/v2/search")
            .query(&[
                ("query", query),
                ("limit", &limit.to_string()),
                ("offset", &offset.to_string()),
                ("index", index),
                ("facets", &facets),
            ])
            .send()
            .map_err(PackwizError::http)?;
        if !resp.status().is_success() {
            return Err(PackwizError::Http(format!("search -> {}", resp.status())));
        }
        let body: SearchResponse = resp.json().map_err(PackwizError::http)?;
        Ok(body.hits)
    }

    pub fn search_modpacks(
        &self,
        query: &str,
        filters: &crate::SearchFilters,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        let loader = filters.loaders.first().map(|s| s.as_str());
        let facets = build_search_facets("modpack", loader, "", filters);
        let index = modrinth_index(filters.sort.as_deref());
        let resp = self
            .client
            .get("https://api.modrinth.com/v2/search")
            .query(&[
                ("query", query),
                ("limit", &limit.to_string()),
                ("offset", &offset.to_string()),
                ("index", index),
                ("facets", &facets),
            ])
            .send()
            .map_err(PackwizError::http)?;
        if !resp.status().is_success() {
            return Err(PackwizError::Http(format!("search -> {}", resp.status())));
        }
        let body: SearchResponse = resp.json().map_err(PackwizError::http)?;
        Ok(body.hits)
    }

    pub fn filter_options(&self, project_type: &str) -> crate::FilterOptions {
        let key = format!("filteropts-v2-{project_type}");
        if let Some(o) = self.read_cache::<crate::FilterOptions>(&key) {
            return o;
        }
        let categories = self.fetch_tag_categories(project_type);
        let loaders = self.fetch_tag_loaders(project_type);
        let game_versions = self.fetch_release_versions();
        let licenses = self.fetch_tag_licenses();
        let opts = crate::FilterOptions {
            categories,
            game_versions,
            loaders,
            licenses,
            sorts: vec![
                "relevance".into(),
                "downloads".into(),
                "follows".into(),
                "newest".into(),
                "updated".into(),
            ],
            supports_environment: true,
            supports_advanced_facets: true,
        };
        if !opts.categories.is_empty() || !opts.game_versions.is_empty() {
            self.write_cache(&key, &opts);
        }
        opts
    }

    fn fetch_tag_categories(&self, project_type: &str) -> Vec<crate::FilterCategory> {
        let resp = match self.client.get("https://api.modrinth.com/v2/tag/category").send() {
            Ok(r) if r.status().is_success() => r,
            _ => return Vec::new(),
        };
        let tags: Vec<ApiCategoryTag> = resp.json().unwrap_or_default();
        tags.into_iter()
            .filter(|t| t.project_type == project_type)
            .map(|t| crate::FilterCategory {
                id: t.name.clone(),
                name: t.name,
                icon: Some(t.icon).filter(|s| !s.is_empty()),
            })
            .collect()
    }

    fn fetch_tag_loaders(&self, project_type: &str) -> Vec<String> {
        let resp = match self.client.get("https://api.modrinth.com/v2/tag/loader").send() {
            Ok(r) if r.status().is_success() => r,
            _ => return Vec::new(),
        };
        let tags: Vec<ApiLoaderTag> = resp.json().unwrap_or_default();
        tags.into_iter()
            .filter(|t| t.supported_project_types.iter().any(|p| p == project_type))
            .map(|t| t.name)
            .collect()
    }

    fn fetch_release_versions(&self) -> Vec<String> {
        let resp = match self.client.get("https://api.modrinth.com/v2/tag/game_version").send() {
            Ok(r) if r.status().is_success() => r,
            _ => return Vec::new(),
        };
        let tags: Vec<ApiGameVersionTag> = resp.json().unwrap_or_default();
        let mut versions: Vec<String> = tags
            .into_iter()
            .filter(|t| t.version_type == "release")
            .map(|t| t.version)
            .collect();
        crate::sort_mc_versions_desc(&mut versions);
        versions
    }

    fn fetch_tag_licenses(&self) -> Vec<crate::FilterCategory> {
        ["MIT", "Apache-2.0", "GPL-3.0-or-later", "LGPL-3.0-or-later", "MPL-2.0", "BSD-3-Clause", "Unlicense", "CC0-1.0"]
            .iter()
            .map(|id| crate::FilterCategory { id: id.to_string(), name: id.to_string(), icon: None })
            .collect()
    }

    pub fn version_files(
        &self,
        hashes: &[String],
    ) -> std::collections::HashMap<String, (String, String)> {
        if hashes.is_empty() {
            return Default::default();
        }
        let body = serde_json::json!({ "hashes": hashes, "algorithm": "sha512" });
        let resp = match self
            .client
            .post("https://api.modrinth.com/v2/version_files")
            .json(&body)
            .send()
        {
            Ok(r) if r.status().is_success() => r,
            _ => return Default::default(),
        };
        let map: std::collections::HashMap<String, HashVersion> =
            resp.json().unwrap_or_default();
        map.into_iter()
            .map(|(hash, v)| (hash, (v.project_id, v.id)))
            .collect()
    }

    pub fn project_versions(&self, project_id: &str) -> Result<Vec<ResolvedVersion>> {
        let resp = self
            .client
            .get(format!(
                "https://api.modrinth.com/v2/project/{project_id}/version"
            ))
            .send()
            .map_err(PackwizError::http)?;
        if !resp.status().is_success() {
            return Err(PackwizError::Http(format!("versions -> {}", resp.status())));
        }
        let versions: Vec<ApiVersion> = resp.json().map_err(PackwizError::http)?;
        Ok(versions.into_iter().filter_map(ApiVersion::resolve).collect())
    }

    pub fn list_versions(
        &self,
        project_id: &str,
        game_version: &str,
        loader: Option<&str>,
    ) -> Result<Vec<ResolvedVersion>> {
        let game_versions = format!("[\"{game_version}\"]");
        let mut req = self
            .client
            .get(format!(
                "https://api.modrinth.com/v2/project/{project_id}/version"
            ))
            .query(&[("game_versions", game_versions.as_str())]);
        if let Some(loader) = loader {
            let loaders = format!("[\"{loader}\"]");
            req = req.query(&[("loaders", loaders.as_str())]);
        }
        let resp = req.send().map_err(PackwizError::http)?;
        if !resp.status().is_success() {
            return Err(PackwizError::Http(format!("versions -> {}", resp.status())));
        }
        let versions: Vec<ApiVersion> = resp.json().map_err(PackwizError::http)?;
        Ok(versions.into_iter().filter_map(ApiVersion::resolve).collect())
    }

    pub fn best_version(
        &self,
        project_id: &str,
        game_version: &str,
        loader: Option<&str>,
    ) -> Result<Option<ResolvedVersion>> {
        Ok(self.list_versions(project_id, game_version, loader)?.into_iter().next())
    }

    pub fn resolve_version(&self, version_id: &str) -> Result<Option<ResolvedVersion>> {
        let key = format!("ver-{version_id}");
        if let Some(rv) = self.read_cache::<ResolvedVersion>(&key) {
            return Ok(Some(rv));
        }
        const ATTEMPTS: usize = 4;
        let mut last = PackwizError::Other("version resolve failed".into());
        for attempt in 0..ATTEMPTS {
            match self
                .client
                .get(format!("https://api.modrinth.com/v2/version/{version_id}"))
                .send()
            {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        let v: ApiVersion = resp.json().map_err(PackwizError::http)?;
                        let resolved = v.resolve();
                        if let Some(rv) = &resolved {
                            self.write_cache(&key, rv);
                        }
                        return Ok(resolved);
                    } else if status.as_u16() == 429 || status.is_server_error() {
                        last = PackwizError::Http(format!("version -> {status}"));
                    } else {
                        return Err(PackwizError::Http(format!("version -> {status}")));
                    }
                }
                Err(e) => last = PackwizError::http(e),
            }
            if attempt + 1 < ATTEMPTS {
                std::thread::sleep(std::time::Duration::from_millis(
                    500 * (attempt as u64 + 1),
                ));
            }
        }
        Err(last)
    }

    pub fn download(&self, url: &str) -> Result<Vec<u8>> {
        const ATTEMPTS: usize = 4;
        let mut last = PackwizError::Other("download failed".into());
        for attempt in 0..ATTEMPTS {
            match self.client.get(url).send() {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        match resp.bytes() {
                            Ok(b) => return Ok(b.to_vec()),
                            Err(e) => last = PackwizError::http(e),
                        }
                    } else if status.as_u16() == 429 || status.is_server_error() {
                        last = PackwizError::Http(format!("download -> {status}"));
                    } else {
                        return Err(PackwizError::Http(format!("download -> {status}")));
                    }
                }
                Err(e) => last = PackwizError::http(e),
            }
            if attempt + 1 < ATTEMPTS {
                std::thread::sleep(std::time::Duration::from_millis(
                    500 * (attempt as u64 + 1),
                ));
            }
        }
        Err(last)
    }

    pub fn download_progress(
        &self,
        url: &str,
        cancel: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(u64, u64),
    ) -> Result<Vec<u8>> {
        use std::io::Read;
        const ATTEMPTS: usize = 4;
        let mut last = PackwizError::Other("download failed".into());
        for attempt in 0..ATTEMPTS {
            if cancel() {
                return Err(PackwizError::Cancelled);
            }
            match self.client.get(url).send() {
                Ok(mut resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        if status.as_u16() == 429 || status.is_server_error() {
                            last = PackwizError::Http(format!("download -> {status}"));
                        } else {
                            return Err(PackwizError::Http(format!("download -> {status}")));
                        }
                        Self::backoff(attempt, ATTEMPTS);
                        continue;
                    }
                    let total = resp.content_length().unwrap_or(0);
                    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
                    let mut chunk = [0u8; 65536];
                    let mut failed = false;
                    loop {
                        if cancel() {
                            return Err(PackwizError::Cancelled);
                        }
                        match resp.read(&mut chunk) {
                            Ok(0) => break,
                            Ok(n) => {
                                buf.extend_from_slice(&chunk[..n]);
                                progress(buf.len() as u64, total);
                            }
                            Err(e) => {
                                last = PackwizError::http(e);
                                failed = true;
                                break;
                            }
                        }
                    }
                    if !failed {
                        if buf.is_empty() {
                            last = PackwizError::Http(
                                "download -> empty response body".to_string(),
                            );
                        } else if total > 0 && (buf.len() as u64) != total {
                            last = PackwizError::Http(format!(
                                "download -> truncated ({} of {total} bytes)",
                                buf.len()
                            ));
                        } else {
                            return Ok(buf);
                        }
                    }
                }
                Err(e) => last = PackwizError::http(e),
            }
            Self::backoff(attempt, ATTEMPTS);
        }
        Err(last)
    }

    pub fn download_until(
        &self,
        url: &str,
        stop: &std::sync::atomic::AtomicBool,
    ) -> Result<Vec<u8>> {
        use std::sync::atomic::Ordering;
        self.download_progress(url, &|| stop.load(Ordering::Relaxed), &mut |_, _| {})
    }

    fn backoff(attempt: usize, attempts: usize) {
        if attempt + 1 < attempts {
            std::thread::sleep(std::time::Duration::from_millis(500 * (attempt as u64 + 1)));
        }
    }

    pub fn clear_cache(cache_dir: &Path) {
        let _ = std::fs::remove_dir_all(cache_dir);
    }
}

#[cfg(test)]
mod facet_tests {
    use super::{build_search_facets, modrinth_index};
    use crate::SearchFilters;

    #[test]
    fn empty_filters_match_legacy_facets() {
        let f = SearchFilters::default();
        let facets = build_search_facets("mod", Some("neoforge"), "1.21.1", &f);
        assert_eq!(
            facets,
            "[[\"project_type:mod\"],[\"versions:1.21.1\"],[\"categories:neoforge\"]]"
        );
        assert_eq!(modrinth_index(None), "relevance");
    }

    #[test]
    fn version_and_loader_override_replace_defaults() {
        let f = SearchFilters {
            game_versions: vec!["1.20.1".into()],
            loaders: vec!["fabric".into(), "quilt".into()],
            ..Default::default()
        };
        let facets = build_search_facets("mod", Some("neoforge"), "1.21.1", &f);
        assert!(facets.contains("[\"versions:1.20.1\"]"));
        assert!(facets.contains("[\"categories:fabric\",\"categories:quilt\"]"));
        assert!(!facets.contains("1.21.1"));
        assert!(!facets.contains("neoforge"));
    }

    #[test]
    fn allow_any_drops_version_and_loader_groups() {
        let f = SearchFilters { allow_any_version: true, allow_any_loader: true, ..Default::default() };
        let facets = build_search_facets("mod", Some("neoforge"), "1.21.1", &f);
        assert_eq!(facets, "[[\"project_type:mod\"]]");
    }

    #[test]
    fn categories_environment_and_advanced_facets() {
        let f = SearchFilters {
            categories: vec!["technology".into(), "utility".into()],
            environment: Some("client".into()),
            open_source: true,
            license: Some("MIT".into()),
            allow_any_version: true,
            allow_any_loader: true,
            ..Default::default()
        };
        let facets = build_search_facets("mod", Some("neoforge"), "1.21.1", &f);
        assert!(facets.contains("[\"categories:technology\"]"));
        assert!(facets.contains("[\"categories:utility\"]"));
        assert!(facets.contains("[\"client_side:required\"]"));
        assert!(facets.contains("[\"open_source:true\"]"));
        assert!(facets.contains("[\"license:MIT\"]"));
    }

    #[test]
    fn versions_sort_newest_first() {
        let mut v = vec![
            "1.20.1".to_string(),
            "1.21".to_string(),
            "1.21.1".to_string(),
            "1.9".to_string(),
            "23w31a".to_string(),
        ];
        crate::sort_mc_versions_desc(&mut v);
        assert_eq!(v, vec!["1.21.1", "1.21", "1.20.1", "1.9", "23w31a"]);
    }

    #[test]
    fn sort_maps_to_index() {
        assert_eq!(modrinth_index(Some("downloads")), "downloads");
        assert_eq!(modrinth_index(Some("newest")), "newest");
        assert_eq!(modrinth_index(Some("updated")), "updated");
        assert_eq!(modrinth_index(Some("follows")), "follows");
        assert_eq!(modrinth_index(Some("bogus")), "relevance");
    }
}

#[cfg(test)]
mod verify_tests {
    use super::ResolvedVersion;
    use crate::{sha1_hex, sha512_hex};

    fn rv(sha512: Option<String>, sha1: Option<String>) -> ResolvedVersion {
        ResolvedVersion {
            version_id: "1".into(),
            version_number: "1".into(),
            filename: "mod.jar".into(),
            url: "https://example/mod.jar".into(),
            sha512,
            sha1,
            game_versions: vec![],
            loaders: vec![],
            dependencies: vec![],
            manual_only: false,
        }
    }

    #[test]
    fn accepts_matching_sha512() {
        let data = b"hello world";
        assert!(rv(Some(sha512_hex(data)), None).verify_data(data).is_ok());
    }

    #[test]
    fn falls_back_to_sha1_when_no_sha512() {
        let data = b"curseforge mod bytes";
        assert!(rv(None, Some(sha1_hex(data))).verify_data(data).is_ok());
    }

    #[test]
    fn rejects_mismatch() {
        let data = b"real bytes";
        assert!(rv(Some(sha512_hex(b"other")), None).verify_data(data).is_err());
        assert!(rv(None, Some(sha1_hex(b"other"))).verify_data(data).is_err());
    }

    #[test]
    fn accepts_when_no_hashes_or_empty() {
        let data = b"anything";
        assert!(rv(None, None).verify_data(data).is_ok());
        assert!(rv(Some(String::new()), Some(String::new())).verify_data(data).is_ok());
    }
}
