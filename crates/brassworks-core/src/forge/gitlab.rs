use serde::de::DeserializeOwned;
use serde_json::json;

use super::{http_client, ForgeRepo, Provider, RepoStats};
use crate::error::{CoreError, Result};
use crate::forge::Forge;

pub(super) static GITLAB: GitlabForge = GitlabForge;

const API: &str = "https://gitlab.com/api/v4";
const HOST: &str = "https://gitlab.com";
const UA: &str = "BrassworksLauncher";

pub(super) struct GitlabForge;

fn project_path(owner: &str, repo: &str) -> String {
    format!("{owner}/{repo}").replace('/', "%2F")
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
    rb.header("PRIVATE-TOKEN", token)
        .header("User-Agent", UA)
        .header("Accept", "application/json")
}

fn send_json<T: DeserializeOwned>(rb: reqwest::blocking::RequestBuilder) -> Result<T> {
    let resp = rb.send().map_err(|e| CoreError::Remote(e.to_string()))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| CoreError::Remote(e.to_string()))?;
    if !status.is_success() {
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("message")
                    .or_else(|| v.get("error"))
                    .map(|m| m.to_string())
            })
            .unwrap_or_else(|| text.clone());
        return Err(CoreError::Remote(format!("GitLab {status}: {msg}")));
    }
    serde_json::from_str(&text).map_err(|e| CoreError::serde("gitlab response", e))
}

fn split_namespace(path_with_namespace: &str) -> (String, String) {
    match path_with_namespace.rsplit_once('/') {
        Some((owner, repo)) => (owner.to_string(), repo.to_string()),
        None => (String::new(), path_with_namespace.to_string()),
    }
}

impl Forge for GitlabForge {
    fn provider(&self) -> Provider {
        Provider::Gitlab
    }

    fn verify_token(&self, token: &str) -> Result<String> {
        let v: serde_json::Value = send_json(get(token, &format!("{API}/user")))?;
        v["username"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| CoreError::Remote("GitLab: token has no username".to_string()))
    }

    fn repo_exists(&self, token: &str, owner: &str, name: &str) -> Result<bool> {
        let resp = get(token, &format!("{API}/projects/{}", project_path(owner, name)))
            .send()
            .map_err(|e| CoreError::Remote(e.to_string()))?;
        match resp.status().as_u16() {
            200 => Ok(true),
            404 => Ok(false),
            other => Err(CoreError::Remote(format!("GitLab {other} checking repo"))),
        }
    }

    fn create_repo(&self, token: &str, name: &str, description: &str) -> Result<ForgeRepo> {
        let body = json!({
            "name": name,
            "path": name,
            "description": description,
            "visibility": "public",
            "initialize_with_readme": true,
        });
        let v: serde_json::Value = send_json(post(token, &format!("{API}/projects")).json(&body))?;
        let path_with_namespace = v["path_with_namespace"].as_str().unwrap_or("").to_string();
        let (owner, repo) = split_namespace(&path_with_namespace);
        Ok(ForgeRepo {
            owner,
            name: if repo.is_empty() {
                name.to_string()
            } else {
                repo
            },
            web_url: v["web_url"].as_str().unwrap_or("").to_string(),
            default_branch: v["default_branch"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("main")
                .to_string(),
        })
    }

    fn repo_stats(&self, token: &str, owner: &str, repo: &str) -> Result<RepoStats> {
        let v: serde_json::Value = send_json(get(
            token,
            &format!(
                "{API}/projects/{}?statistics=true",
                project_path(owner, repo)
            ),
        ))?;
        let size_bytes = v["statistics"]["repository_size"].as_u64().unwrap_or(0);
        Ok(RepoStats {
            size_kb: size_bytes / 1024,
            pushed_at: v["last_activity_at"].as_str().map(String::from),
            html_url: v["web_url"].as_str().unwrap_or("").to_string(),
            default_branch: v["default_branch"].as_str().unwrap_or("main").to_string(),
            private: v["visibility"].as_str().map(|s| s != "public").unwrap_or(false),
            stargazers: v["star_count"].as_u64().unwrap_or(0),
            forks: v["forks_count"].as_u64().unwrap_or(0),
        })
    }

    fn repo_default_branch(&self, token: &str, owner: &str, repo: &str) -> Result<String> {
        let v: serde_json::Value =
            send_json(get(token, &format!("{API}/projects/{}", project_path(owner, repo))))?;
        Ok(v["default_branch"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("main")
            .to_string())
    }

    fn raw_url(&self, owner: &str, repo: &str, branch: &str, path: &str) -> String {
        format!("{HOST}/{owner}/{repo}/-/raw/{branch}/{path}")
    }

    fn web_url(&self, owner: &str, repo: &str) -> String {
        format!("{HOST}/{owner}/{repo}")
    }

    fn clone_url(&self, owner: &str, repo: &str) -> String {
        format!("{HOST}/{owner}/{repo}.git")
    }

    fn git_username(&self) -> &'static str {
        "oauth2"
    }

    fn parse_repo_url(&self, input: &str) -> Option<(String, String)> {
        let s = input.trim().trim_end_matches('/');
        let tail = s.split_once("gitlab.com/").map(|(_, t)| t).unwrap_or(s);
        let path = tail.split("/-/").next().unwrap_or(tail);
        let path = path.strip_suffix(".git").unwrap_or(path);
        let segs: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        if segs.len() < 2 {
            return None;
        }
        let repo = segs.last()?.to_string();
        let owner = segs[..segs.len() - 1].join("/");
        if owner.is_empty() || repo.is_empty() {
            return None;
        }
        Some((owner, repo))
    }

    fn owns_url(&self, url: &str) -> bool {
        url.contains("gitlab.com")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_url_format() {
        assert_eq!(
            GITLAB.raw_url("swzo", "my-pack", "main", "pack.toml"),
            "https://gitlab.com/swzo/my-pack/-/raw/main/pack.toml"
        );
    }

    #[test]
    fn project_path_encodes_slash() {
        assert_eq!(project_path("group/sub", "repo"), "group%2Fsub%2Frepo");
    }

    #[test]
    fn parse_repo_url_forms() {
        assert_eq!(
            GITLAB.parse_repo_url("https://gitlab.com/swzo/my-pack"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(
            GITLAB.parse_repo_url("https://gitlab.com/swzo/my-pack.git/"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(
            GITLAB.parse_repo_url("https://gitlab.com/swzo/my-pack/-/raw/main/pack.toml"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(
            GITLAB.parse_repo_url("https://gitlab.com/group/sub/my-pack"),
            Some(("group/sub".to_string(), "my-pack".to_string()))
        );
        assert_eq!(GITLAB.parse_repo_url("not a url"), None);
        assert_eq!(GITLAB.parse_repo_url("https://gitlab.com/swzo"), None);
    }
}
