use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::{PackwizError, Result};
use crate::modrinth::{ResolvedVersion, SearchHit, VersionDep};

const CURSEFORGE_API_BASE: &str = "https://api.curseforge.com/v1";
const PRISM_API_BASE: &str = "https://api.prismlauncher.org/v1/flame";
const MINECRAFT_GAME_ID: u32 = 432;

const MIN_REQUEST_GAP: Duration = Duration::from_millis(220);

fn throttle() {
    static LAST: OnceLock<Mutex<Instant>> = OnceLock::new();
    let cell = LAST.get_or_init(|| Mutex::new(Instant::now() - MIN_REQUEST_GAP));
    let mut last = cell.lock().unwrap_or_else(|e| e.into_inner());
    let elapsed = last.elapsed();
    if elapsed < MIN_REQUEST_GAP {
        std::thread::sleep(MIN_REQUEST_GAP - elapsed);
    }
    *last = Instant::now();
}

fn retry_after(resp: &reqwest::blocking::Response) -> Option<Duration> {
    let secs: u64 = resp
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()?;
    Some(Duration::from_secs(secs.min(10)))
}

fn class_id(project_type: &str) -> u32 {
    match project_type {
        "resourcepack" => 12,
        "shader" => 6552,
        "modpack" => 4471,
        "datapack" => 6945,
        _ => 6,
    }
}

fn loader_type(loader: &str) -> Option<u32> {
    match loader.to_ascii_lowercase().as_str() {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

const LOADER_NAMES: &[&str] = &["Forge", "NeoForge", "Fabric", "Quilt", "LiteLoader"];

pub fn cdn_url(file_id: i64, filename: &str) -> String {
    let p1 = file_id / 1000;
    let p2 = file_id % 1000;
    format!(
        "https://mediafilez.forgecdn.net/files/{p1}/{p2}/{}",
        encode_filename(filename)
    )
}

fn encode_filename(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for b in name.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseforgeProject {
    pub id: String,
    pub title: String,
    pub description: String,
    pub body: String,
    pub icon_url: Option<String>,
    pub slug: String,
    pub url: Option<String>,
    pub downloads: u64,
}

pub struct Curseforge {
    client: reqwest::blocking::Client,
    cache_dir: PathBuf,
    api_key: String,
}

impl Curseforge {
    fn api_base(&self) -> &str {
        if self.api_key.trim().is_empty() {
            PRISM_API_BASE
        } else {
            CURSEFORGE_API_BASE
        }
    }
    pub fn new(
        client: reqwest::blocking::Client,
        cache_dir: impl Into<PathBuf>,
        api_key: impl Into<String>,
    ) -> Self {
        Self {
            client,
            cache_dir: cache_dir.into(),
            api_key: api_key.into(),
        }
    }

    fn get<T: serde::de::DeserializeOwned>(&self, url: &str, query: &[(&str, String)]) -> Result<T> {
        const ATTEMPTS: usize = 5;
        for attempt in 0..ATTEMPTS {
            throttle();

            let mut req = self
                .client
                .get(url)
                .header("Accept", "application/json")
                .query(query);

            if !self.api_key.trim().is_empty() {
                req = req.header("x-api-key", &self.api_key);
            }

            let resp = req.send().map_err(PackwizError::http)?;

            let status = resp.status();
            if status.as_u16() == 429 {
                let wait = retry_after(&resp).unwrap_or(Duration::from_millis(
                    600 * (attempt as u64 + 1),
                ));
                std::thread::sleep(wait);
                continue;
            }
            if !status.is_success() {
                return Err(PackwizError::Http(format!("curseforge {url} -> {status}")));
            }
            return resp.json().map_err(PackwizError::http);
        }
        Err(PackwizError::Http(format!(
            "curseforge {url} -> 429 Too Many Requests (gave up after {ATTEMPTS} tries)"
        )))
    }

    fn post_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<T> {
        const ATTEMPTS: usize = 5;
        for attempt in 0..ATTEMPTS {
            throttle();
            let mut req = self
                .client
                .post(url)
                .header("Accept", "application/json")
                .json(body);
            if !self.api_key.trim().is_empty() {
                req = req.header("x-api-key", &self.api_key);
            }
            let resp = req.send().map_err(PackwizError::http)?;
            let status = resp.status();
            if status.as_u16() == 429 {
                let wait = retry_after(&resp)
                    .unwrap_or(Duration::from_millis(600 * (attempt as u64 + 1)));
                std::thread::sleep(wait);
                continue;
            }
            if !status.is_success() {
                return Err(PackwizError::Http(format!("curseforge {url} -> {status}")));
            }
            return resp.json().map_err(PackwizError::http);
        }
        Err(PackwizError::Http(format!(
            "curseforge {url} -> 429 Too Many Requests (gave up after {ATTEMPTS} tries)"
        )))
    }

    fn cache_path(&self, key: &str) -> PathBuf {
        self.cache_dir.join(format!("{key}.v1.json"))
    }

    fn read_cache<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        serde_json::from_slice(&std::fs::read(self.cache_path(key)).ok()?).ok()
    }

    fn write_cache<T: Serialize>(&self, key: &str, value: &T) {
        let _ = std::fs::create_dir_all(&self.cache_dir);
        if let Ok(json) = serde_json::to_vec(value) {
            let _ = std::fs::write(self.cache_path(key), json);
        }
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
        let mut q: Vec<(&str, String)> = vec![
            ("gameId", MINECRAFT_GAME_ID.to_string()),
            ("classId", class_id(project_type).to_string()),
            ("searchFilter", query.to_string()),
            ("gameVersion", game_version.to_string()),
            ("sortField", "2".to_string()), 
            ("sortOrder", "desc".to_string()),
            ("index", offset.to_string()),
            ("pageSize", limit.to_string()),
        ];
        if let Some(id) = loader.and_then(loader_type) {
            q.push(("modLoaderType", id.to_string()));
        }
        let body: SearchResponse = self.get(&format!("{}/mods/search", self.api_base()), &q)?;
        Ok(body
            .data
            .into_iter()
            .map(|m| m.into_hit(project_type))
            .collect())
    }

    pub fn search_modpacks(
        &self,
        query: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        let q: Vec<(&str, String)> = vec![
            ("gameId", MINECRAFT_GAME_ID.to_string()),
            ("classId", class_id("modpack").to_string()),
            ("searchFilter", query.to_string()),
            ("sortField", "2".to_string()),
            ("sortOrder", "desc".to_string()),
            ("index", offset.to_string()),
            ("pageSize", limit.to_string()),
        ];
        let body: SearchResponse = self.get(&format!("{}/mods/search", self.api_base()), &q)?;
        Ok(body
            .data
            .into_iter()
            .map(|m| m.into_hit("modpack"))
            .collect())
    }

    pub fn project_files(&self, project_id: &str) -> Result<Vec<ResolvedVersion>> {
        let body: ApiFiles = self.get(
            &format!("{}/mods/{project_id}/files", self.api_base()),
            &[("pageSize", "50".to_string())],
        )?;
        let mut out: Vec<ResolvedVersion> = body.data.into_iter().map(ApiFile::resolve).collect();
        out.sort_by(|a, b| b.version_id.cmp(&a.version_id));
        Ok(out)
    }

    pub fn project(&self, id: &str) -> Option<CurseforgeProject> {
        let cache_key = format!("p-{id}");
        if let Some(p) = self.read_cache::<CurseforgeProject>(&cache_key) {
            return Some(p);
        }
        let mod_resp: DataWrap<ApiMod> = self.get(&format!("{}/mods/{id}", self.api_base()), &[]).ok()?;
        let body = self
            .get::<DataWrap<String>>(&format!("{}/mods/{id}/description", self.api_base()), &[])
            .map(|d| d.data)
            .unwrap_or_default();
        let m = mod_resp.data;
        let project = CurseforgeProject {
            id: m.id.to_string(),
            title: m.name,
            description: m.summary,
            body,
            icon_url: m.logo.and_then(|l| l.url),
            url: m
                .links
                .and_then(|l| l.website_url)
                .filter(|u| !u.is_empty()),
            slug: m.slug,
            downloads: m.download_count as u64,
        };
        self.write_cache(&cache_key, &project);
        Some(project)
    }

    pub fn list_versions(
        &self,
        project_id: &str,
        game_version: &str,
        loader: Option<&str>,
    ) -> Result<Vec<ResolvedVersion>> {
        let mut q: Vec<(&str, String)> = vec![
            ("gameVersion", game_version.to_string()),
            ("pageSize", "50".to_string()),
        ];
        if let Some(id) = loader.and_then(loader_type) {
            q.push(("modLoaderType", id.to_string()));
        }
        let body: ApiFiles = self.get(&format!("{}/mods/{project_id}/files", self.api_base()), &q)?;
        let mut out: Vec<ResolvedVersion> = body.data.into_iter().map(ApiFile::resolve).collect();
        out.sort_by(|a, b| b.version_id.cmp(&a.version_id));
        Ok(out)
    }

    pub fn best_version(
        &self,
        project_id: &str,
        game_version: &str,
        loader: Option<&str>,
    ) -> Result<Option<ResolvedVersion>> {
        Ok(self
            .list_versions(project_id, game_version, loader)?
            .into_iter()
            .next())
    }

    pub fn resolve_version(
        &self,
        project_id: &str,
        file_id: &str,
    ) -> Result<Option<ResolvedVersion>> {
        let cache_key = format!("f-{project_id}-{file_id}");
        if let Some(rv) = self.read_cache::<ResolvedVersion>(&cache_key) {
            return Ok(Some(rv));
        }
        let body: DataWrap<ApiFile> =
            self.get(&format!("{}/mods/{project_id}/files/{file_id}", self.api_base()), &[])?;
        let rv = body.data.resolve();
        self.write_cache(&cache_key, &rv);
        Ok(Some(rv))
    }

    pub fn resolve_versions_bulk(&self, file_ids: &[i64]) -> Result<Vec<ResolvedVersion>> {
        if file_ids.is_empty() {
            return Ok(Vec::new());
        }
        let body: ApiFiles = self.post_json(
            &format!("{}/mods/files", self.api_base()),
            &serde_json::json!({ "fileIds": file_ids }),
        )?;
        let mut out = Vec::with_capacity(body.data.len());
        for f in body.data {
            let project_id = f.mod_id;
            let file_id = f.id;
            let rv = f.resolve();
            if project_id != 0 {
                self.write_cache(&format!("f-{project_id}-{file_id}"), &rv);
            }
            out.push(rv);
        }
        Ok(out)
    }

    pub fn file_changelog(&self, project_id: &str, file_id: &str) -> Option<String> {
        let body: DataWrap<String> = self
            .get(
                &format!("{}/mods/{project_id}/files/{file_id}/changelog", self.api_base()),
                &[],
            )
            .ok()?;
        Some(body.data).filter(|c| !c.trim().is_empty())
    }

    pub fn cache_dir(&self) -> &std::path::Path {
        &self.cache_dir
    }
}


#[derive(Deserialize)]
struct DataWrap<T> {
    data: T,
}

#[derive(Deserialize)]
struct SearchResponse {
    data: Vec<ApiMod>,
}

#[derive(Deserialize)]
struct ApiMod {
    id: i64,
    name: String,
    #[serde(default)]
    slug: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    logo: Option<ApiLogo>,
    #[serde(rename = "downloadCount", default)]
    download_count: f64,
    #[serde(default)]
    authors: Vec<ApiAuthor>,
    #[serde(default)]
    links: Option<ApiLinks>,
}

#[derive(Deserialize)]
struct ApiLinks {
    #[serde(rename = "websiteUrl", default)]
    website_url: Option<String>,
}

impl ApiMod {
    fn into_hit(self, project_type: &str) -> SearchHit {
        SearchHit {
            project_id: self.id.to_string(),
            slug: self.slug,
            title: self.name,
            description: self.summary,
            icon_url: self.logo.and_then(|l| l.url),
            downloads: self.download_count as u64,
            author: self.authors.into_iter().next().map(|a| a.name).unwrap_or_default(),
            project_type: project_type.to_string(),
            versions: Vec::new(),
            source: "curseforge".to_string(),
        }
    }
}

#[derive(Deserialize)]
struct ApiLogo {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Deserialize)]
struct ApiAuthor {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct ApiFiles {
    data: Vec<ApiFile>,
}

#[derive(Deserialize)]
struct ApiFile {
    id: i64,
    #[serde(rename = "modId", default)]
    mod_id: i64,
    #[serde(rename = "displayName", default)]
    display_name: String,
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "downloadUrl", default)]
    download_url: Option<String>,
    #[serde(rename = "gameVersions", default)]
    game_versions: Vec<String>,
    #[serde(default)]
    hashes: Vec<ApiHash>,
    #[serde(default)]
    dependencies: Vec<ApiDep>,
}

#[derive(Deserialize)]
struct ApiHash {
    #[serde(default)]
    value: String,
    #[serde(default)]
    algo: u32,
}

#[derive(Deserialize)]
struct ApiDep {
    #[serde(rename = "modId", default)]
    mod_id: i64,
    #[serde(rename = "relationType", default)]
    relation_type: u32,
}

impl ApiFile {
    fn resolve(self) -> ResolvedVersion {
        let sha1 = self
            .hashes
            .iter()
            .find(|h| h.algo == 1)
            .map(|h| h.value.clone());
        let (loaders, game_versions): (Vec<String>, Vec<String>) = self
            .game_versions
            .into_iter()
            .partition(|v| LOADER_NAMES.iter().any(|n| n.eq_ignore_ascii_case(v)));
        let real_url = self.download_url.filter(|u| !u.is_empty());
        let manual_only = real_url.is_none();
        let url = real_url.unwrap_or_else(|| cdn_url(self.id, &self.file_name));
        let dependencies = self
            .dependencies
            .into_iter()
            .filter(|d| d.mod_id != 0 && matches!(d.relation_type, 2 | 3))
            .map(|d| VersionDep {
                project_id: Some(d.mod_id.to_string()),
                version_id: None,
                required: d.relation_type == 3,
            })
            .collect();
        ResolvedVersion {
            version_id: self.id.to_string(),
            version_number: if self.display_name.is_empty() {
                self.file_name.clone()
            } else {
                self.display_name
            },
            filename: self.file_name,
            url,
            sha512: None,
            sha1,
            game_versions,
            loaders: loaders.into_iter().map(|l| l.to_lowercase()).collect(),
            dependencies,
            manual_only,
        }
    }
}

#[cfg(test)]
mod cf_tests {
    use super::{cdn_url, class_id, encode_filename, loader_type};

    #[test]
    fn class_ids_by_project_type() {
        assert_eq!(class_id("mod"), 6);
        assert_eq!(class_id("resourcepack"), 12);
        assert_eq!(class_id("shader"), 6552);
        assert_eq!(class_id("modpack"), 4471);
        assert_eq!(class_id("datapack"), 6945);
        assert_eq!(class_id("anything-else"), 6);
    }

    #[test]
    fn loader_types_known() {
        assert_eq!(loader_type("forge"), Some(1));
        assert_eq!(loader_type("fabric"), Some(4));
        assert_eq!(loader_type("quilt"), Some(5));
        assert_eq!(loader_type("neoforge"), Some(6));
    }

    #[test]
    fn loader_types_case_insensitive() {
        assert_eq!(loader_type("Forge"), Some(1));
        assert_eq!(loader_type("NeoForge"), Some(6));
        assert_eq!(loader_type("FABRIC"), Some(4));
    }

    #[test]
    fn loader_types_unknown() {
        assert_eq!(loader_type("vanilla"), None);
        assert_eq!(loader_type(""), None);
        assert_eq!(loader_type("liteloader"), None);
    }

    #[test]
    fn cdn_url_splits_file_id() {
        assert_eq!(
            cdn_url(4912345, "jei.jar"),
            "https://mediafilez.forgecdn.net/files/4912/345/jei.jar"
        );
        assert_eq!(
            cdn_url(7, "a.jar"),
            "https://mediafilez.forgecdn.net/files/0/7/a.jar"
        );
    }

    #[test]
    fn cdn_url_encodes_filename() {
        assert_eq!(
            cdn_url(1000, "a b.jar"),
            "https://mediafilez.forgecdn.net/files/1/0/a%20b.jar"
        );
    }

    #[test]
    fn encode_filename_keeps_unreserved() {
        assert_eq!(encode_filename("jei.jar"), "jei.jar");
        assert_eq!(encode_filename("a-b_c.1~x.jar"), "a-b_c.1~x.jar");
    }

    #[test]
    fn encode_filename_escapes_specials() {
        assert_eq!(encode_filename("a b.jar"), "a%20b.jar");
        assert_eq!(encode_filename("a+b.jar"), "a%2Bb.jar");
        assert_eq!(encode_filename("100%cool.jar"), "100%25cool.jar");
        assert_eq!(encode_filename("a(b).jar"), "a%28b%29.jar");
    }
}
