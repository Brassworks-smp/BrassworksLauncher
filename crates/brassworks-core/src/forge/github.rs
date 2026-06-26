use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

use super::{http_client, ForgeRepo, Provider, RepoStats};
use crate::error::{CoreError, Result};
use crate::forge::Forge;

pub(super) static GITHUB: GithubForge = GithubForge;

const API: &str = "https://api.github.com";
const UA: &str = "BrassworksLauncher";
const API_VERSION: &str = "2022-11-28";

pub(super) struct GithubForge;

#[derive(Debug, Clone, Deserialize)]
struct GhUser {
    login: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GhRepo {
    name: String,
    html_url: String,
    #[serde(default = "default_branch")]
    default_branch: String,
    owner: GhOwner,
}

#[derive(Debug, Clone, Deserialize)]
struct GhOwner {
    login: String,
}

fn default_branch() -> String {
    "main".to_string()
}

fn get(token: &str, url: &str) -> reqwest::blocking::RequestBuilder {
    decorate(http_client().get(url), token)
}

fn post(token: &str, url: &str) -> reqwest::blocking::RequestBuilder {
    decorate(http_client().post(url), token)
}

fn decorate(
    rb: reqwest::blocking::RequestBuilder,
    token: &str,
) -> reqwest::blocking::RequestBuilder {
    rb.bearer_auth(token)
        .header("User-Agent", UA)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
}

fn send_json<T: DeserializeOwned>(rb: reqwest::blocking::RequestBuilder) -> Result<T> {
    let resp = rb.send().map_err(|e| CoreError::Remote(e.to_string()))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| CoreError::Remote(e.to_string()))?;
    if !status.is_success() {
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or_else(|| text.clone());
        return Err(CoreError::Remote(format!("GitHub {status}: {msg}")));
    }
    serde_json::from_str(&text).map_err(|e| CoreError::serde("github response", e))
}

impl Forge for GithubForge {
    fn provider(&self) -> Provider {
        Provider::Github
    }

    fn verify_token(&self, token: &str) -> Result<String> {
        let user: GhUser = send_json(get(token, &format!("{API}/user")))?;
        Ok(user.login)
    }

    fn repo_exists(&self, token: &str, owner: &str, name: &str) -> Result<bool> {
        let resp = get(token, &format!("{API}/repos/{owner}/{name}"))
            .send()
            .map_err(|e| CoreError::Remote(e.to_string()))?;
        match resp.status().as_u16() {
            200 => Ok(true),
            404 => Ok(false),
            other => Err(CoreError::Remote(format!("GitHub {other} checking repo"))),
        }
    }

    fn create_repo(&self, token: &str, name: &str, description: &str) -> Result<ForgeRepo> {
        let body = json!({
            "name": name,
            "description": description,
            "private": false,
            "auto_init": true,
            "has_issues": false,
            "has_wiki": false,
            "has_projects": false,
        });
        let repo: GhRepo = send_json(post(token, &format!("{API}/user/repos")).json(&body))?;
        Ok(ForgeRepo {
            owner: repo.owner.login,
            name: repo.name,
            web_url: repo.html_url,
            default_branch: repo.default_branch,
        })
    }

    fn repo_stats(&self, token: &str, owner: &str, repo: &str) -> Result<RepoStats> {
        let v: serde_json::Value = send_json(get(token, &format!("{API}/repos/{owner}/{repo}")))?;
        Ok(RepoStats {
            size_kb: v["size"].as_u64().unwrap_or(0),
            pushed_at: v["pushed_at"].as_str().map(String::from),
            html_url: v["html_url"].as_str().unwrap_or("").to_string(),
            default_branch: v["default_branch"].as_str().unwrap_or("main").to_string(),
            private: v["private"].as_bool().unwrap_or(false),
            stargazers: v["stargazers_count"].as_u64().unwrap_or(0),
            forks: v["forks_count"].as_u64().unwrap_or(0),
        })
    }

    fn repo_default_branch(&self, token: &str, owner: &str, repo: &str) -> Result<String> {
        let r: GhRepo = send_json(get(token, &format!("{API}/repos/{owner}/{repo}")))?;
        Ok(r.default_branch)
    }

    fn raw_url(&self, owner: &str, repo: &str, branch: &str, path: &str) -> String {
        format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}")
    }

    fn web_url(&self, owner: &str, repo: &str) -> String {
        format!("https://github.com/{owner}/{repo}")
    }

    fn clone_url(&self, owner: &str, repo: &str) -> String {
        format!("https://github.com/{owner}/{repo}.git")
    }

    fn git_username(&self) -> &'static str {
        "x-access-token"
    }

    fn parse_repo_url(&self, input: &str) -> Option<(String, String)> {
        let s = input.trim().trim_end_matches('/');
        let s = s.strip_suffix(".git").unwrap_or(s);
        let tail = s
            .split_once("github.com/")
            .map(|(_, t)| t)
            .or_else(|| s.split_once("githubusercontent.com/").map(|(_, t)| t))
            .unwrap_or(s);
        let mut parts = tail.split('/').filter(|p| !p.is_empty());
        let owner = parts.next()?.to_string();
        let repo = parts.next()?.to_string();
        if owner.is_empty() || repo.is_empty() {
            return None;
        }
        Some((owner, repo))
    }

    fn owns_url(&self, url: &str) -> bool {
        url.contains("github.com") || url.contains("githubusercontent.com")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_url_format() {
        assert_eq!(
            GITHUB.raw_url("swzo", "my-pack", "main", "pack.toml"),
            "https://raw.githubusercontent.com/swzo/my-pack/main/pack.toml"
        );
    }

    #[test]
    fn parse_repo_url_forms() {
        assert_eq!(
            GITHUB.parse_repo_url("https://github.com/swzo/my-pack"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(
            GITHUB.parse_repo_url("https://github.com/swzo/my-pack.git/"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(
            GITHUB.parse_repo_url("https://raw.githubusercontent.com/swzo/my-pack/main/pack.toml"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(
            GITHUB.parse_repo_url("swzo/my-pack"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(GITHUB.parse_repo_url("not a url"), None);
        assert_eq!(GITHUB.parse_repo_url("https://github.com/swzo"), None);
    }
}
