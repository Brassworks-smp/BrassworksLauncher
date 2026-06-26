mod github;
mod gitlab;

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Github,
    Gitlab,
}

impl Default for Provider {
    fn default() -> Self {
        Provider::Github
    }
}

impl Provider {
    pub const ALL: [Provider; 2] = [Provider::Github, Provider::Gitlab];

    pub fn id(self) -> &'static str {
        match self {
            Provider::Github => "github",
            Provider::Gitlab => "gitlab",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::Github => "GitHub",
            Provider::Gitlab => "GitLab",
        }
    }

    pub fn parse(s: &str) -> Option<Provider> {
        match s.trim().to_ascii_lowercase().as_str() {
            "github" => Some(Provider::Github),
            "gitlab" => Some(Provider::Gitlab),
            _ => None,
        }
    }
}

pub fn get(provider: Provider) -> &'static dyn Forge {
    match provider {
        Provider::Github => &github::GITHUB,
        Provider::Gitlab => &gitlab::GITLAB,
    }
}

pub fn detect(url: &str) -> Option<Provider> {
    Provider::ALL.into_iter().find(|p| get(*p).owns_url(url))
}

#[derive(Debug, Clone, Serialize)]
pub struct PushProgress {
    pub stage: String,
    pub file: String,
    pub done_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct ForgeRepo {
    pub owner: String,
    pub name: String,
    pub web_url: String,
    pub default_branch: String,
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

pub trait Forge: Sync {
    fn provider(&self) -> Provider;

    fn verify_token(&self, token: &str) -> Result<String>;

    fn repo_exists(&self, token: &str, owner: &str, name: &str) -> Result<bool>;

    fn create_repo(&self, token: &str, name: &str, description: &str) -> Result<ForgeRepo>;

    fn repo_stats(&self, token: &str, owner: &str, repo: &str) -> Result<RepoStats>;

    fn repo_default_branch(&self, token: &str, owner: &str, repo: &str) -> Result<String>;

    fn raw_url(&self, owner: &str, repo: &str, branch: &str, path: &str) -> String;

    fn web_url(&self, owner: &str, repo: &str) -> String;

    fn clone_url(&self, owner: &str, repo: &str) -> String;

    fn git_username(&self) -> &'static str;

    fn parse_repo_url(&self, input: &str) -> Option<(String, String)>;

    fn owns_url(&self, url: &str) -> bool;
}

pub fn unique_repo_name(
    forge: &dyn Forge,
    token: &str,
    owner: &str,
    base: &str,
) -> Result<String> {
    let base = slug_repo(base);
    if !forge.repo_exists(token, owner, &base)? {
        return Ok(base);
    }
    for _ in 0..20 {
        let candidate = format!("{base}-{}", short_suffix());
        if !forge.repo_exists(token, owner, &candidate)? {
            return Ok(candidate);
        }
    }
    Err(CoreError::Modpack(
        "could not find an available repository name".to_string(),
    ))
}

fn git_callbacks(forge: &dyn Forge, token: String) -> git2::RemoteCallbacks<'static> {
    let mut cb = git2::RemoteCallbacks::new();
    let user = forge.git_username().to_string();
    cb.credentials(move |_url, _user, _allowed| {
        git2::Cred::userpass_plaintext(&user, &token)
    });
    cb
}

fn git_err(e: git2::Error) -> CoreError {
    CoreError::Remote(format!("git: {}", e.message()))
}

pub fn open_synced(
    forge: &dyn Forge,
    token: &str,
    owner: &str,
    repo: &str,
    branch: &str,
    work_dir: &std::path::Path,
) -> Result<git2::Repository> {
    use git2::{Repository, ResetType};
    let url = forge.clone_url(owner, repo);

    let clone_fresh = || -> Result<Repository> {
        let _ = std::fs::remove_dir_all(work_dir);
        if let Some(parent) = work_dir.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
        }
        let mut fo = git2::FetchOptions::new();
        fo.remote_callbacks(git_callbacks(forge, token.to_string()));
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
            fo.remote_callbacks(git_callbacks(forge, token.to_string()));
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

#[allow(clippy::too_many_arguments)]
pub fn push_files(
    forge: &dyn Forge,
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
    let url = forge.clone_url(owner, repo);
    let stage = |progress: &mut dyn FnMut(PushProgress), s: &str| {
        progress(PushProgress {
            stage: s.to_string(),
            file: String::new(),
            done_bytes: total,
            total_bytes: total,
        });
    };
    stage(progress, "start");

    let repository = open_synced(forge, token, owner, repo, branch, work_dir)?;

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
    po.remote_callbacks(git_callbacks(forge, token.to_string()));
    remote
        .push(
            &[format!("+refs/heads/{branch}:refs/heads/{branch}")],
            Some(&mut po),
        )
        .map_err(git_err)?;

    Ok(commit_oid.to_string())
}

pub fn fetch_text(url: &str) -> Result<String> {
    let resp = http_client()
        .get(url)
        .header("User-Agent", "BrassworksLauncher")
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CoreError::Remote(format!("{} fetching {url}", resp.status())));
    }
    resp.text().map_err(|e| CoreError::Remote(e.to_string()))
}

pub(crate) fn http_client() -> reqwest::blocking::Client {
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
    fn short_suffix_len() {
        assert_eq!(short_suffix().len(), 6);
    }

    #[test]
    fn provider_roundtrips() {
        for p in Provider::ALL {
            assert_eq!(Provider::parse(p.id()), Some(p));
            let json = serde_json::to_string(&p).unwrap();
            assert_eq!(serde_json::from_str::<Provider>(&json).unwrap(), p);
        }
    }

    #[test]
    fn detect_picks_provider_by_host() {
        assert_eq!(
            detect("https://github.com/swzo/my-pack"),
            Some(Provider::Github)
        );
        assert_eq!(
            detect("https://gitlab.com/swzo/my-pack"),
            Some(Provider::Gitlab)
        );
        assert_eq!(
            detect("https://raw.githubusercontent.com/swzo/my-pack/main/pack.toml"),
            Some(Provider::Github)
        );
        assert_eq!(detect("https://example.com/x"), None);
    }
}
