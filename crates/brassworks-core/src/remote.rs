
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};

const GITHUB_REPO: &str = "Brassworks-smp/BrassworksLauncher";

const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsItem {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlayerGroup {
    #[serde(default)]
    pub online: bool,
    #[serde(default)]
    pub players_online: u32,
    #[serde(default)]
    pub players_max: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlayerCount {
    #[serde(default)]
    pub main: PlayerGroup,
    #[serde(default)]
    pub queue: PlayerGroup,
    #[serde(default)]
    pub timestamp: Option<String>,
}

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| CoreError::Remote(e.to_string()))
}

fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T> {
    let resp = client()?
        .get(url)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CoreError::Remote(format!("{url} -> {}", resp.status())));
    }
    resp.json::<T>()
        .map_err(|e| CoreError::Remote(format!("decode {url}: {e}")))
}

pub fn news(url: &str) -> Result<NewsItem> {
    get_json(url)
}

pub fn player_count(url: &str) -> Result<PlayerCount> {
    get_json(url)
}

#[derive(Deserialize)]
struct GithubRelease {
    #[serde(default)]
    body: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    tag_name: String,
}

pub fn release_changelog(version: Option<&str>) -> Result<String> {
    let url = match version {
        Some(v) => {
            let tag = if v.starts_with('v') { v.to_string() } else { format!("v{v}") };
            format!("https://api.github.com/repos/{GITHUB_REPO}/releases/tags/{tag}")
        }
        None => format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest"),
    };
    let resp = client()?
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CoreError::Remote(format!("{url} -> {}", resp.status())));
    }
    let release: GithubRelease = resp
        .json()
        .map_err(|e| CoreError::Remote(format!("decode release: {e}")))?;
    let title = if !release.name.is_empty() {
        release.name
    } else {
        release.tag_name
    };
    let body = release.body.trim();
    if body.is_empty() {
        return Err(CoreError::Remote("release has no changelog".to_string()));
    }
    if title.is_empty() {
        Ok(body.to_string())
    } else {
        Ok(format!("# {title}\n\n{body}"))
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LogUpload {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub raw: String,
}

#[derive(Deserialize)]
struct MclogsResponse {
    success: bool,
    #[serde(default)]
    id: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    raw: String,
    #[serde(default)]
    error: Option<String>,
}

pub fn upload_log(content: &str) -> Result<LogUpload> {
    let resp = client()?
        .post("https://api.mclo.gs/1/log")
        .form(&[("content", content)])
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    let body: MclogsResponse = resp
        .json()
        .map_err(|e| CoreError::Remote(format!("decode mclo.gs: {e}")))?;
    if !body.success {
        return Err(CoreError::Remote(
            body.error.unwrap_or_else(|| "mclo.gs upload failed".to_string()),
        ));
    }
    Ok(LogUpload {
        id: body.id,
        url: body.url,
        raw: body.raw,
    })
}
