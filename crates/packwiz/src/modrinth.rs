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
}

fn default_source() -> String {
    "modrinth".to_string()
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
        limit: u32,
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        let mut facets: Vec<String> = vec![
            format!("[\"project_type:{project_type}\"]"),
            format!("[\"versions:{game_version}\"]"),
        ];
        if let Some(loader) = loader {
            facets.push(format!("[\"categories:{loader}\"]"));
        }
        let facets = format!("[{}]", facets.join(","));

        let resp = self
            .client
            .get("https://api.modrinth.com/v2/search")
            .query(&[
                ("query", query),
                ("limit", &limit.to_string()),
                ("offset", &offset.to_string()),
                ("index", "relevance"),
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
        limit: u32,
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        let facets = "[[\"project_type:modpack\"]]";
        let resp = self
            .client
            .get("https://api.modrinth.com/v2/search")
            .query(&[
                ("query", query),
                ("limit", &limit.to_string()),
                ("offset", &offset.to_string()),
                ("index", "relevance"),
                ("facets", facets),
            ])
            .send()
            .map_err(PackwizError::http)?;
        if !resp.status().is_success() {
            return Err(PackwizError::Http(format!("search -> {}", resp.status())));
        }
        let body: SearchResponse = resp.json().map_err(PackwizError::http)?;
        Ok(body.hits)
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
        let resp = self
            .client
            .get(format!("https://api.modrinth.com/v2/version/{version_id}"))
            .send()
            .map_err(PackwizError::http)?;
        if !resp.status().is_success() {
            return Err(PackwizError::Http(format!("version -> {}", resp.status())));
        }
        let v: ApiVersion = resp.json().map_err(PackwizError::http)?;
        Ok(v.resolve())
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
        progress: &mut dyn FnMut(u64, u64),
    ) -> Result<Vec<u8>> {
        use std::io::Read;
        const ATTEMPTS: usize = 4;
        let mut last = PackwizError::Other("download failed".into());
        for attempt in 0..ATTEMPTS {
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
                        return Ok(buf);
                    }
                }
                Err(e) => last = PackwizError::http(e),
            }
            Self::backoff(attempt, ATTEMPTS);
        }
        Err(last)
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
