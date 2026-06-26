use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, Serialize)]
pub struct PushProgress {
    pub stage: String,
    pub file: String,
    pub done_bytes: u64,
    pub total_bytes: u64,
}

const API: &str = "https://api.github.com";
const UA: &str = "BrassworksLauncher";
const API_VERSION: &str = "2022-11-28";

#[derive(Debug, Clone, Deserialize)]
pub struct GhUser {
    pub login: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GhRepo {
    pub name: String,
    pub full_name: String,
    pub html_url: String,
    #[serde(default = "default_branch")]
    pub default_branch: String,
    pub owner: GhOwner,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GhOwner {
    pub login: String,
}

fn default_branch() -> String {
    "main".to_string()
}

fn client() -> reqwest::blocking::Client {
    use std::sync::OnceLock;
    use std::time::Duration;
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::blocking::Client::builder()
                .pool_max_idle_per_host(16)
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(60))
                .build()
                .unwrap_or_default()
        })
        .clone()
}

fn get(token: &str, url: &str) -> reqwest::blocking::RequestBuilder {
    decorate(client().get(url), token)
}

fn post(token: &str, url: &str) -> reqwest::blocking::RequestBuilder {
    decorate(client().post(url), token)
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
            .and_then(|v| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| text.clone());
        return Err(CoreError::Remote(format!("GitHub {status}: {msg}")));
    }
    serde_json::from_str(&text).map_err(|e| CoreError::serde("github response", e))
}

pub fn verify_token(token: &str) -> Result<GhUser> {
    send_json(get(token, &format!("{API}/user")))
}

pub fn repo_exists(token: &str, owner: &str, name: &str) -> Result<bool> {
    let resp = get(token, &format!("{API}/repos/{owner}/{name}"))
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    match resp.status().as_u16() {
        200 => Ok(true),
        404 => Ok(false),
        other => Err(CoreError::Remote(format!("GitHub {other} checking repo"))),
    }
}

pub fn create_repo(token: &str, name: &str, description: &str) -> Result<GhRepo> {
    let body = json!({
        "name": name,
        "description": description,
        "private": false,
        "auto_init": true,
        "has_issues": false,
        "has_wiki": false,
        "has_projects": false,
    });
    send_json(post(token, &format!("{API}/user/repos")).json(&body))
}

pub fn unique_repo_name(token: &str, owner: &str, base: &str) -> Result<String> {
    let base = slug_repo(base);
    if !repo_exists(token, owner, &base)? {
        return Ok(base);
    }
    for _ in 0..20 {
        let candidate = format!("{base}-{}", short_suffix());
        if !repo_exists(token, owner, &candidate)? {
            return Ok(candidate);
        }
    }
    Err(CoreError::Modpack(
        "could not find an available repository name".to_string(),
    ))
}

fn git_callbacks(token: &str) -> git2::RemoteCallbacks<'_> {
    let mut cb = git2::RemoteCallbacks::new();
    cb.credentials(move |_url, _user, _allowed| {
        git2::Cred::userpass_plaintext("x-access-token", token)
    });
    cb
}

fn git_err(e: git2::Error) -> CoreError {
    CoreError::Remote(format!("git: {}", e.message()))
}

pub fn open_synced(
    token: &str,
    owner: &str,
    repo: &str,
    branch: &str,
    work_dir: &std::path::Path,
) -> Result<git2::Repository> {
    use git2::{Repository, ResetType};
    let url = format!("https://github.com/{owner}/{repo}.git");

    let clone_fresh = || -> Result<Repository> {
        let _ = std::fs::remove_dir_all(work_dir);
        if let Some(parent) = work_dir.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
        }
        let mut fo = git2::FetchOptions::new();
        fo.remote_callbacks(git_callbacks(token));
        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fo).branch(branch);
        builder.clone(&url, work_dir).map_err(git_err)
    };

    let cached = Repository::open(work_dir).ok().filter(|r| {
        r.find_remote("origin")
            .ok()
            .and_then(|rem| rem.url().map(|u| u == url))
            .unwrap_or(false)
    });
    match cached {
        Some(r) => {
            let refspec = format!("+refs/heads/{branch}:refs/remotes/origin/{branch}");
            let mut fo = git2::FetchOptions::new();
            fo.remote_callbacks(git_callbacks(token));
            let fetched = {
                let mut remote = r.find_remote("origin").map_err(git_err)?;
                remote.fetch(&[refspec.as_str()], Some(&mut fo), None)
            };
            match fetched {
                Ok(()) => {
                    if let Ok(oid) = r.refname_to_id(&format!("refs/remotes/origin/{branch}")) {
                        if let Ok(obj) = r.find_object(oid, None) {
                            let _ = r.reset(&obj, ResetType::Hard, None);
                        }
                    }
                    Ok(r)
                }
                Err(_) => clone_fresh(),
            }
        }
        None => clone_fresh(),
    }
}

pub fn head_file_hashes(
    repo: &git2::Repository,
) -> Result<std::collections::HashMap<String, String>> {
    let mut out = std::collections::HashMap::new();
    let tree = match repo.head().ok().and_then(|h| h.peel_to_tree().ok()) {
        Some(t) => t,
        None => return Ok(out),
    };
    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob) {
            if let Ok(obj) = entry.to_object(repo) {
                if let Some(blob) = obj.as_blob() {
                    let name = entry.name().unwrap_or("");
                    let path = format!("{dir}{name}");
                    out.insert(path, packwiz::sha256_hex(blob.content()));
                }
            }
        }
        git2::TreeWalkResult::Ok
    })
    .map_err(git_err)?;
    Ok(out)
}

pub fn local_head_file_count(work_dir: &std::path::Path) -> usize {
    git2::Repository::open(work_dir)
        .ok()
        .and_then(|r| head_file_hashes(&r).ok())
        .map(|m| m.len())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoStats {
    pub size_kb: u64,
    pub pushed_at: Option<String>,
    pub html_url: String,
    pub default_branch: String,
    pub private: bool,
    pub stargazers: u64,
    pub forks: u64,
}

pub fn repo_stats(token: &str, owner: &str, repo: &str) -> Result<RepoStats> {
    let v: serde_json::Value = send_json(get(token, &format!("{API}/repos/{owner}/{repo}")))?;
    Ok(RepoStats {
        size_kb: v["size"].as_u64().unwrap_or(0),
        pushed_at: v["pushed_at"].as_str().map(|s| s.to_string()),
        html_url: v["html_url"].as_str().unwrap_or("").to_string(),
        default_branch: v["default_branch"].as_str().unwrap_or("main").to_string(),
        private: v["private"].as_bool().unwrap_or(false),
        stargazers: v["stargazers_count"].as_u64().unwrap_or(0),
        forks: v["forks_count"].as_u64().unwrap_or(0),
    })
}

pub fn push_files(
    token: &str,
    owner: &str,
    repo: &str,
    branch: &str,
    files: &[(String, Vec<u8>)],
    message: &str,
    work_dir: &std::path::Path,
    progress: &mut dyn FnMut(PushProgress),
    cancel: &(dyn Fn() -> bool + Sync),
) -> Result<String> {
    use git2::{IndexAddOption, Signature};

    let total: u64 = files.iter().map(|(_, b)| b.len() as u64).sum();
    let url = format!("https://github.com/{owner}/{repo}.git");
    let stage = |progress: &mut dyn FnMut(PushProgress), s: &str| {
        progress(PushProgress {
            stage: s.to_string(),
            file: String::new(),
            done_bytes: total,
            total_bytes: total,
        });
    };
    stage(progress, "start");

    let repository = open_synced(token, owner, repo, branch, work_dir)?;

    if cancel() {
        return Err(CoreError::Cancelled);
    }

    stage(progress, "writing");
    for entry in std::fs::read_dir(work_dir).map_err(|e| CoreError::io(work_dir, e))? {
        let path = entry.map_err(|e| CoreError::io(work_dir, e))?.path();
        if path.file_name().map(|n| n == ".git").unwrap_or(false) {
            continue;
        }
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
    for (rel, bytes) in files {
        let dest = work_dir.join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
        }
        std::fs::write(&dest, bytes).map_err(|e| CoreError::io(&dest, e))?;
    }

    if cancel() {
        return Err(CoreError::Cancelled);
    }

    let mut index = repository.index().map_err(git_err)?;
    index.clear().map_err(git_err)?;
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(git_err)?;
    index.write().map_err(git_err)?;
    let tree_oid = index.write_tree().map_err(git_err)?;
    let tree = repository.find_tree(tree_oid).map_err(git_err)?;

    stage(progress, "commit");
    let sig = Signature::now("Brassworks Launcher", "launcher@brassworks.opnsoc.org")
        .map_err(git_err)?;
    let parent = repository
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let commit_oid = repository
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(git_err)?;

    if cancel() {
        return Err(CoreError::Cancelled);
    }

    stage(progress, "ref");
    let mut remote = repository
        .find_remote("origin")
        .or_else(|_| repository.remote("origin", &url))
        .map_err(git_err)?;
    let mut po = git2::PushOptions::new();
    po.remote_callbacks(git_callbacks(token));
    remote
        .push(
            &[format!("+refs/heads/{branch}:refs/heads/{branch}")],
            Some(&mut po),
        )
        .map_err(git_err)?;

    Ok(commit_oid.to_string())
}

pub fn raw_url(owner: &str, repo: &str, branch: &str, path: &str) -> String {
    format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}")
}

pub fn parse_repo_url(input: &str) -> Option<(String, String)> {
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

pub fn fetch_text(url: &str) -> Result<String> {
    let resp = client()
        .get(url)
        .header("User-Agent", UA)
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CoreError::Remote(format!(
            "GitHub {} fetching {url}",
            resp.status()
        )));
    }
    resp.text().map_err(|e| CoreError::Remote(e.to_string()))
}

pub fn repo_default_branch(token: &str, owner: &str, repo: &str) -> Result<String> {
    let r: GhRepo = send_json(get(token, &format!("{API}/repos/{owner}/{repo}")))?;
    Ok(r.default_branch)
}

pub fn slug_repo(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "modpack".to_string()
    } else {
        out
    }
}

fn short_suffix() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..6].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_repo_is_safe() {
        assert_eq!(slug_repo("My Cool SMP!"), "my-cool-smp");
        assert_eq!(slug_repo("  ***  "), "modpack");
        assert_eq!(slug_repo("already-ok_1"), "already-ok_1");
    }

    #[test]
    fn raw_url_format() {
        assert_eq!(
            raw_url("swzo", "my-pack", "main", "pack.toml"),
            "https://raw.githubusercontent.com/swzo/my-pack/main/pack.toml"
        );
    }

    #[test]
    fn short_suffix_len() {
        assert_eq!(short_suffix().len(), 6);
    }

    #[test]
    fn parse_repo_url_forms() {
        assert_eq!(
            parse_repo_url("https://github.com/swzo/my-pack"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(
            parse_repo_url("https://github.com/swzo/my-pack.git/"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(
            parse_repo_url(
                "https://raw.githubusercontent.com/swzo/my-pack/main/pack.toml"
            ),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(
            parse_repo_url("swzo/my-pack"),
            Some(("swzo".to_string(), "my-pack".to_string()))
        );
        assert_eq!(parse_repo_url("not a url"), None);
        assert_eq!(parse_repo_url("https://github.com/swzo"), None);
    }
}
