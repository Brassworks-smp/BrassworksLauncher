use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use sha2::{Digest, Sha256, Sha512};

use crate::curseforge::{self, Curseforge};
use crate::error::{PackwizError, Result};
use crate::manifest::{FileFailure, FileRecord, ManagedMod, Manifest};
use crate::model::{Index, MetaFile, Pack};
use crate::modrinth::Modrinth;
use crate::{Side, SyncOptions, SyncProgress, SyncStage};

struct Planned {
    dest: String,
    url: String,
    hash: String,
    hash_format: String,
    preserve: bool,
    meta: Option<ManagedMod>,
}

pub struct Installer {
    client: reqwest::blocking::Client,
        concurrency: usize,
}

impl Default for Installer {
    fn default() -> Self {
        Self::new()
    }
}

impl Installer {
    pub fn new() -> Self {
        let client = reqwest::blocking::Client::builder()
            .user_agent("BrassworksLauncher/0.1 (+https://github.com/brassworks)")
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("build reqwest client");
        Self {
            client,
            concurrency: crate::DEFAULT_CONCURRENCY,
        }
    }

        pub fn with_concurrency(mut self, concurrency: usize) -> Self {
        self.concurrency = concurrency.max(1);
        self
    }

    pub fn modrinth(&self, cache_dir: impl Into<PathBuf>) -> Modrinth {
        Modrinth::new(self.client.clone(), cache_dir)
    }

    pub fn curseforge(
        &self,
        cache_dir: impl Into<PathBuf>,
        api_key: impl Into<String>,
    ) -> Curseforge {
        Curseforge::new(self.client.clone(), cache_dir, api_key)
    }


    fn get_text(&self, url: &str) -> Result<String> {
        let resp = self.client.get(url).send().map_err(PackwizError::http)?;
        if !resp.status().is_success() {
            return Err(PackwizError::Http(format!("GET {url} -> {}", resp.status())));
        }
        resp.text().map_err(PackwizError::http)
    }

                    fn fetch_metafiles(&self, base: &str, paths: &[String]) -> Result<Vec<MetaFile>> {
        crate::parallel_run(
            paths,
            self.concurrency,
            |path| {
                let url = join_url(base, path);
                self.get_text(&url).and_then(|t| {
                    toml::from_str::<MetaFile>(&t)
                        .map_err(|e| PackwizError::toml(path.clone(), e))
                })
            },
            |_, _, _| {},
        )
        .into_iter()
        .collect()
    }

    fn get_bytes(&self, url: &str) -> Result<Vec<u8>> {
        let resp = self.client.get(url).send().map_err(PackwizError::http)?;
        if !resp.status().is_success() {
            return Err(PackwizError::Http(format!("GET {url} -> {}", resp.status())));
        }
        let bytes = resp.bytes().map_err(PackwizError::http)?;
        Ok(bytes.to_vec())
    }

    pub fn fetch_pack(&self, pack_url: &str) -> Result<Pack> {
        let text = self.get_text(pack_url)?;
        toml::from_str(&text).map_err(|e| PackwizError::toml("pack.toml", e))
    }

    pub fn pack_icon_url(pack_url: &str) -> String {
        format!("{}icon.png", base_url(pack_url))
    }

    pub fn find_pack_icon(&self, pack_url: &str) -> Option<String> {
        let url = Self::pack_icon_url(pack_url);
        let resp = self.client.get(&url).send().ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let looks_image = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|ct| ct.starts_with("image/"))
            .unwrap_or(true);
        if !looks_image {
            return None;
        }
        Some(url)
    }

    pub fn github_pack_branches(&self, repo_url: &str) -> Result<Vec<PackwizBranch>> {
        let GithubRepo { owner, repo, spec } = parse_github_repo(repo_url)
            .ok_or_else(|| PackwizError::Http(format!("not a GitHub repo URL: {repo_url}")))?;

        let api = format!("https://api.github.com/repos/{owner}/{repo}/branches?per_page=100");
        let resp = self
            .client
            .get(&api)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .map_err(PackwizError::http)?;
        if !resp.status().is_success() {
            return Err(PackwizError::Http(format!(
                "GitHub branches {api} -> {}",
                resp.status()
            )));
        }
        let branches: serde_json::Value = resp.json().map_err(PackwizError::http)?;
        let names: Vec<String> = branches
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|b| b.get("name").and_then(|n| n.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let path = resolve_path(spec.as_deref(), &names);
        let prefix = if path.is_empty() {
            String::new()
        } else {
            format!("{path}/")
        };
        let mut out = Vec::new();
        for name in names {
            let pack_url = format!(
                "https://raw.githubusercontent.com/{owner}/{repo}/{name}/{prefix}pack.toml"
            );
            if let Ok(resp) = self.client.get(&pack_url).send() {
                if resp.status().is_success() {
                    out.push(PackwizBranch { name, pack_url });
                }
            }
        }
        Ok(out)
    }

    pub fn update_available(pack: &Pack, index_hash: &str, manifest: &Manifest) -> bool {
        manifest.pack_version != pack.version || manifest.index_hash != index_hash
    }


    pub fn sync(
        &self,
        opts: &SyncOptions,
        force: bool,
        cancel: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(SyncProgress),
    ) -> Result<Manifest> {
        let old = Manifest::load(&opts.manifest_path)?;

        emit(progress, SyncStage::Fetching, 0, 0, "Fetching pack.toml");
        let pack = self.fetch_pack(&opts.pack_url)?;

        let base = base_url(&opts.pack_url);
        let index_url = join_url(&base, &pack.index.file);
        emit(progress, SyncStage::Fetching, 0, 0, "Fetching index.toml");
        let index_text = self.get_text(&index_url)?;
        let index_hash = hex_digest("sha256", index_text.as_bytes());

                                                let selection_matches =
            flavors_match(&opts.flavors, &old.flavors) && optional_matches(&opts.optional, &old.optional);
        if !force
            && old.complete
            && !old.pack_version.is_empty()
            && old.pack_version == pack.version
            && old.index_hash == index_hash
            && selection_matches
        {
            emit(progress, SyncStage::Done, 0, 0, "Modpack up to date");
            return Ok(old);
        }

        let index: Index =
            toml::from_str(&index_text).map_err(|e| PackwizError::toml("index.toml", e))?;

                                let unsup_toml = if opts.unsup {
            if let Some(spec) = opts.public_key.as_deref().filter(|s| !s.trim().is_empty()) {
                emit(progress, SyncStage::Fetching, 0, 0, "Verifying signature");
                let key = crate::unsup::PublicKey::parse(spec)?;
                let pack_bytes = self.get_bytes(&opts.pack_url)?;
                let sig = self.get_bytes(&join_url(&base, "unsup.sig"))?;
                if !key.verify(&pack_bytes, &sig) {
                    return Err(PackwizError::Other(
                        "unsup.sig does not match the configured public key — refusing to install"
                            .to_string(),
                    ));
                }
            }
            match self.get_text(&join_url(&base, "unsup.toml")) {
                Ok(text) => {
                    toml::from_str(&text).map_err(|e| PackwizError::toml("unsup.toml", e))?
                }
                Err(_) => crate::unsup::UnsupToml::default(),
            }
        } else {
            crate::unsup::UnsupToml::default()
        };

                let metafile_paths: Vec<String> = index
            .files
            .iter()
            .filter(|f| f.metafile)
            .map(|f| f.file.clone())
            .collect();
        emit(
            progress,
            SyncStage::Resolving,
            0,
            metafile_paths.len() as u64,
            format!("Reading {} mods", metafile_paths.len()),
        );
        if cancel() {
            return Err(PackwizError::Cancelled);
        }
        let mut metas: std::collections::HashMap<String, MetaFile> = metafile_paths
            .iter()
            .cloned()
            .zip(self.fetch_metafiles(&base, &metafile_paths)?)
            .collect();

                                let unsup_resolution = if opts.unsup {
            let refs: Vec<crate::unsup::MetafileRef> = metafile_paths
                .iter()
                .filter_map(|p| metas.get(p).map(|m| crate::unsup::MetafileRef::new(p.clone(), m)))
                .collect();
            Some(crate::unsup::resolve(&unsup_toml, &refs))
        } else {
            None
        };

        let mut plan: Vec<Planned> = Vec::with_capacity(index.files.len());
                        let mut selected_optional: Vec<String> = Vec::new();

        for entry in &index.files {
            if cancel() {
                return Err(PackwizError::Cancelled);
            }
            if entry.metafile {
                let Some(meta) = metas.remove(&entry.file) else {
                    continue;
                };

                if !opts.side.wants(&meta.side) {
                    continue;
                }

                if opts.unsup {
                    let flavors = unsup_resolution
                        .as_ref()
                        .and_then(|r| r.metafile_flavors.get(&entry.file))
                        .cloned()
                        .unwrap_or_default();
                    if !crate::unsup::keep_metafile(&flavors, &opts.flavors) {
                        continue;
                    }
                } else if let Some(opt) = meta.option.as_ref().filter(|o| o.optional) {
                                        if !opts.optional.wants(&entry.file, opt.default) {
                        continue;
                    }
                    selected_optional.push(entry.file.clone());
                }

                let dest = sibling_path(&entry.file, &meta.filename);
                let category = top_dir(&dest);
                let modrinth = meta.update.as_ref().and_then(|u| u.modrinth.as_ref());
                let modrinth_id = modrinth.map(|m| m.mod_id.clone());
                let modrinth_version = modrinth
                    .map(|m| m.version.clone())
                    .filter(|v| !v.is_empty());
                let cf = meta.update.as_ref().and_then(|u| u.curseforge.as_ref());

                let url = match meta.download.url.clone() {
                    Some(url) => url,
                    None => match cf.filter(|c| c.file_id != 0) {
                        Some(c) => curseforge::cdn_url(c.file_id, &meta.filename),
                        None => continue,
                    },
                };

                let (source, curseforge_id, curseforge_file) = if cf.is_some() {
                    let c = cf.unwrap();
                    ("curseforge".to_string(), Some(c.project_id), Some(c.file_id))
                } else if modrinth_id.is_some() {
                    ("modrinth".to_string(), None, None)
                } else {
                    (String::new(), None, None)
                };

                plan.push(Planned {
                    dest: dest.clone(),
                    url,
                    hash: meta.download.hash.clone(),
                    hash_format: meta.download.hash_format.clone(),
                    preserve: false,
                    meta: Some(ManagedMod {
                        name: meta.name,
                        filename: meta.filename,
                        path: dest,
                        side: meta.side,
                        category,
                        modrinth_id,
                        modrinth_version,
                        source,
                        curseforge_id,
                        curseforge_file,
                    }),
                });
            } else {
                let hash_format = entry
                    .hash_format
                    .clone()
                    .unwrap_or_else(|| index.hash_format.clone());
                let meta = content_override_meta(&entry.file);
                plan.push(Planned {
                    dest: entry.file.clone(),
                    url: join_url(&base, &entry.file),
                    hash: entry.hash.clone(),
                    hash_format,
                    preserve: entry.preserve,
                    meta,
                });
            }
        }

                        let need: Vec<bool> = crate::parallel_run(
            &plan,
            self.concurrency,
            |p| self.needs_download(opts, &old, p, force),
            |_, _, _| {},
        );

                let todo: Vec<usize> = (0..plan.len()).filter(|&i| need[i]).collect();
        let total = todo.len() as u64;
        let cancelled = AtomicBool::new(false);
        let outcomes = crate::parallel_run(
            &todo,
            self.concurrency,
            |&i| {
                if cancelled.load(Ordering::Relaxed) {
                    return Err(None);                 }
                self.download_one(&opts.game_dir, &plan[i])
                    .map_err(|e| Some(short_error(&e)))
            },
            |done, total, j| {
                if cancel() {
                    cancelled.store(true, Ordering::Relaxed);
                }
                emit(
                    progress,
                    SyncStage::Downloading,
                    done,
                    total,
                    format!("Downloading {}", file_stem(&plan[todo[j]].dest)),
                );
            },
        );

        let mut failed: Vec<String> = Vec::new();
        let mut failures: Vec<FileFailure> = Vec::new();
        for (j, outcome) in outcomes.iter().enumerate() {
            if let Err(Some(reason)) = outcome {
                let path = plan[todo[j]].dest.clone();
                failed.push(path.clone());
                failures.push(FileFailure {
                    path,
                    reason: reason.clone(),
                });
            }
        }
        if cancelled.load(Ordering::Relaxed) {
            self.write_manifest(
                opts,
                &pack,
                &index_hash,
                &plan,
                &failed,
                &failures,
                &selected_optional,
            )?;
            return Err(PackwizError::Cancelled);
        }

        let kept: BTreeSet<&str> = plan.iter().map(|p| p.dest.as_str()).collect();
        let stale: Vec<String> = old
            .files
            .keys()
            .filter(|k| !kept.contains(k.as_str()))
            .cloned()
            .collect();
        if !stale.is_empty() {
            emit(
                progress,
                SyncStage::Cleaning,
                0,
                stale.len() as u64,
                "Removing old files",
            );
            for path in &stale {
                let full = opts.game_dir.join(path);
                let _ = std::fs::remove_file(&full);
            }
        }

        let manifest = self.write_manifest(
            opts,
            &pack,
            &index_hash,
            &plan,
            &failed,
            &failures,
            &selected_optional,
        )?;

        let msg = if failed.is_empty() {
            "Modpack up to date".to_string()
        } else {
            format!("Modpack ready — {} file(s) could not be downloaded", failed.len())
        };
        emit(progress, SyncStage::Done, total, total, msg);
        Ok(manifest)
    }

                pub fn inspect_optional(
        &self,
        pack_url: &str,
        cancel: &dyn Fn() -> bool,
    ) -> Result<Vec<OptionalMod>> {
        let pack = self.fetch_pack(pack_url)?;
        let base = base_url(pack_url);
        let index_url = join_url(&base, &pack.index.file);
        let index_text = self.get_text(&index_url)?;
        let index: Index =
            toml::from_str(&index_text).map_err(|e| PackwizError::toml("index.toml", e))?;

        let paths: Vec<String> = index
            .files
            .iter()
            .filter(|f| f.metafile)
            .map(|f| f.file.clone())
            .collect();
        if cancel() {
            return Err(PackwizError::Cancelled);
        }
        let metas = self.fetch_metafiles(&base, &paths)?;

        let mut out = Vec::new();
        for (path, meta) in paths.iter().zip(metas) {
            if !Side::Client.wants(&meta.side) {
                continue;
            }
            if let Some(opt) = meta.option.as_ref().filter(|o| o.optional) {
                out.push(OptionalMod {
                    path: path.clone(),
                    name: meta.name.clone(),
                    description: opt.description.clone().filter(|d| !d.trim().is_empty()),
                    default: opt.default,
                    side: meta.side.clone(),
                    category: top_dir(&sibling_path(path, &meta.filename)),
                });
            }
        }
        Ok(out)
    }

                pub fn inspect_unsup(
        &self,
        pack_url: &str,
        cancel: &dyn Fn() -> bool,
    ) -> Result<Vec<crate::unsup::FlavorGroup>> {
        let pack = self.fetch_pack(pack_url)?;
        let base = base_url(pack_url);
        let index_url = join_url(&base, &pack.index.file);
        let index_text = self.get_text(&index_url)?;
        let index: Index =
            toml::from_str(&index_text).map_err(|e| PackwizError::toml("index.toml", e))?;

        let unsup_toml = if crate::unsup::detect(&pack).is_some() {
            match self.get_text(&join_url(&base, "unsup.toml")) {
                Ok(text) => {
                    toml::from_str(&text).map_err(|e| PackwizError::toml("unsup.toml", e))?
                }
                Err(_) => crate::unsup::UnsupToml::default(),
            }
        } else {
            crate::unsup::UnsupToml::default()
        };

        let paths: Vec<String> = index
            .files
            .iter()
            .filter(|f| f.metafile)
            .map(|f| f.file.clone())
            .collect();
        if cancel() {
            return Err(PackwizError::Cancelled);
        }
        let metafiles: Vec<crate::unsup::MetafileRef> = paths
            .iter()
            .zip(self.fetch_metafiles(&base, &paths)?)
            .map(|(path, meta)| crate::unsup::MetafileRef::new(path.clone(), &meta))
            .collect();

        Ok(crate::unsup::resolve(&unsup_toml, &metafiles).groups)
    }

    fn download_one(&self, game_dir: &Path, p: &Planned) -> Result<()> {
        const ATTEMPTS: usize = 3;
        let mut last = PackwizError::Other("download failed".into());
        for attempt in 0..ATTEMPTS {
            match self.get_bytes(&p.url) {
                Ok(bytes) => match verify_hash(&p.dest, &p.hash_format, &p.hash, &bytes) {
                    Ok(()) => return write_file(game_dir, &p.dest, &bytes),
                    Err(e) => return Err(e),
                },
                Err(e) => {
                    last = e;
                    if attempt + 1 < ATTEMPTS {
                        std::thread::sleep(std::time::Duration::from_millis(
                            400 * (attempt as u64 + 1),
                        ));
                    }
                }
            }
        }
        Err(last)
    }

    fn write_manifest(
        &self,
        opts: &SyncOptions,
        pack: &Pack,
        index_hash: &str,
        plan: &[Planned],
        failed: &[String],
        failures: &[FileFailure],
        optional: &[String],
    ) -> Result<Manifest> {
        let mut manifest = Manifest {
            pack_version: pack.version.clone(),
            index_hash: index_hash.to_string(),
            minecraft_version: pack.versions.minecraft.clone(),
            neoforge_version: pack.versions.neoforge.clone(),
            failed: failed.to_vec(),
            failures: failures.to_vec(),
            optional: optional.to_vec(),
            flavors: {
                let mut f: Vec<String> = opts.flavors.iter().cloned().collect();
                f.sort();
                f
            },
            ..Default::default()
        };
        let mut present = 0usize;
        for p in plan {
            if opts.game_dir.join(&p.dest).exists() {
                manifest.files.insert(
                    p.dest.clone(),
                    FileRecord {
                        hash: p.hash.clone(),
                        hash_format: p.hash_format.clone(),
                    },
                );
                present += 1;
            }
            if let Some(m) = &p.meta {
                manifest.mods.push(m.clone());
            }
        }
        manifest.complete = failed.is_empty() && present == plan.len();
        manifest
            .mods
            .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        manifest.save(&opts.manifest_path)?;
        Ok(manifest)
    }

    fn needs_download(&self, opts: &SyncOptions, old: &Manifest, p: &Planned, force: bool) -> bool {
        let full = opts.game_dir.join(&p.dest);
        let exists = full.exists();
        if p.preserve && exists {
            return false;
        }
        if force {
            return true;
        }
        match old.files.get(&p.dest) {
            Some(rec) if rec.hash == p.hash && !p.hash.is_empty() && exists => false,
            _ => true,
        }
    }
}


fn flavors_match(requested: &std::collections::HashSet<String>, recorded: &[String]) -> bool {
    requested.len() == recorded.len() && recorded.iter().all(|f| requested.contains(f))
}

fn optional_matches(requested: &crate::OptionalChoice, recorded: &[String]) -> bool {
    match requested {
        crate::OptionalChoice::Default => true,
        crate::OptionalChoice::Explicit(set) => {
            set.len() == recorded.len() && recorded.iter().all(|p| set.contains(p))
        }
    }
}

fn emit(
    progress: &mut dyn FnMut(SyncProgress),
    stage: SyncStage,
    current: u64,
    total: u64,
    message: impl Into<String>,
) {
    progress(SyncProgress {
        stage,
        current,
        total,
        message: message.into(),
    });
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PackwizBranch {
    pub name: String,
    pub pack_url: String,
}

#[derive(Debug, Clone)]
pub struct OptionalMod {
        pub path: String,
    pub name: String,
    pub description: Option<String>,
    pub default: bool,
    pub side: String,
    pub category: String,
}

struct GithubRepo {
    owner: String,
    repo: String,
    spec: Option<String>,
}

fn parse_github_repo(input: &str) -> Option<GithubRepo> {
    let s = input.trim();
    let rest = s
        .strip_prefix("https://github.com/")
        .or_else(|| s.strip_prefix("http://github.com/"))
        .or_else(|| s.strip_prefix("github.com/"))
        .or_else(|| s.strip_prefix("https://raw.githubusercontent.com/"))
        .or_else(|| s.strip_prefix("http://raw.githubusercontent.com/"))?;
    let mut segs = rest.split('/').filter(|s| !s.is_empty());
    let owner = segs.next()?.to_string();
    let repo = segs.next()?.trim_end_matches(".git").to_string();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    let tail: Vec<&str> = segs.collect();
    let spec = match tail.first() {
        Some(&"tree") | Some(&"blob") if tail.len() > 1 => Some(tail[1..].join("/")),
        Some(_) => Some(tail.join("/")),
        None => None,
    };
    Some(GithubRepo { owner, repo, spec })
}

fn resolve_path(spec: Option<&str>, branches: &[String]) -> String {
    let spec = match spec {
        Some(s) if !s.is_empty() => s.trim_matches('/'),
        _ => return String::new(),
    };
    let spec = spec.strip_suffix("/pack.toml").unwrap_or(spec);

    let mut best: Option<&str> = None;
    for b in branches {
        let matches = spec == b || spec.starts_with(&format!("{b}/"));
        if matches && best.map(|cur| b.len() > cur.len()).unwrap_or(true) {
            best = Some(b);
        }
    }
    let path = match best {
        Some(b) => spec.strip_prefix(b).unwrap_or("").trim_start_matches('/'),
        None => spec.split_once('/').map(|(_, rest)| rest).unwrap_or(""),
    };
    path.trim_matches('/').to_string()
}

fn base_url(url: &str) -> String {
    match url.rfind('/') {
        Some(i) => url[..=i].to_string(),
        None => String::new(),
    }
}

fn join_url(base: &str, rel: &str) -> String {
    let encoded: Vec<String> = rel.split('/').map(encode_segment).collect();
    format!("{base}{}", encoded.join("/"))
}

fn encode_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for b in seg.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn sibling_path(meta_path: &str, filename: &str) -> String {
    match meta_path.rfind('/') {
        Some(i) => format!("{}/{}", &meta_path[..i], filename),
        None => filename.to_string(),
    }
}

fn content_override_meta(path: &str) -> Option<ManagedMod> {
    let category = top_dir(path);
    let is_content = matches!(category.as_str(), "mods" | "resourcepacks" | "shaderpacks");
    let is_archive = path.ends_with(".jar") || path.ends_with(".zip");
    if !is_content || !is_archive {
        return None;
    }
    let filename = file_stem(path).to_string();
    Some(ManagedMod {
        name: filename.clone(),
        filename,
        path: path.to_string(),
        side: "both".to_string(),
        category,
        modrinth_id: None,
        modrinth_version: None,
        source: String::new(),
        curseforge_id: None,
        curseforge_file: None,
    })
}

fn top_dir(path: &str) -> String {
    match path.find('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

fn file_stem(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn short_error(e: &PackwizError) -> String {
    match e {
        PackwizError::HashMismatch { .. } => "hash mismatch".to_string(),
        PackwizError::Http(msg) => msg.clone(),
        other => other.to_string(),
    }
}

fn write_file(game_dir: &Path, rel: &str, bytes: &[u8]) -> Result<()> {
    let full = game_dir.join(rel);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| PackwizError::io(parent.display().to_string(), e))?;
    }
    std::fs::write(&full, bytes).map_err(|e| PackwizError::io(full.display().to_string(), e))
}

pub fn sha512_hex(data: &[u8]) -> String {
    hex_digest("sha512", data)
}

fn hex_digest(format: &str, data: &[u8]) -> String {
    match format {
        "sha512" => {
            let mut h = Sha512::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        "sha1" => {
            use sha1::Sha1;
            let mut h = Sha1::new();
            h.update(data);
            hex::encode(h.finalize())
        }
        _ => {
            let mut h = Sha256::new();
            h.update(data);
            hex::encode(h.finalize())
        }
    }
}

fn verify_hash(file: &str, format: &str, expected: &str, data: &[u8]) -> Result<()> {
    if expected.is_empty() {
        return Ok(());
    }
    if !matches!(format, "sha256" | "sha512" | "sha1") {
        return Ok(());
    }
    let actual = hex_digest(format, data);
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(PackwizError::HashMismatch {
            file: file.to_string(),
            expected: expected.to_string(),
            actual,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

            #[test]
    #[ignore = "network: inspects the real BlanketCon 25 unsup pack"]
    fn inspect_unsup_against_real_pack() {
        let url = "https://raw.githubusercontent.com/ModFest/blanketcon-25/HEAD/pack/pack.toml";
        let groups = Installer::new().inspect_unsup(url, &|| false).unwrap();
                assert!(groups.iter().any(|g| g.id == "axiom"));
        assert!(groups.iter().any(|g| g.id == "worldedit"));
        let axiom = groups.iter().find(|g| g.id == "axiom").unwrap();
        assert!(axiom.choices.iter().any(|c| c.id == "axiom_accept"));
        assert!(!axiom.is_boolean(), "named multi-choice group, not a toggle");
    }
}
