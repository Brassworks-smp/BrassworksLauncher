
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256, Sha512};

use crate::curseforge::{self, Curseforge};
use crate::error::{PackwizError, Result};
use crate::manifest::{FileRecord, ManagedMod, Manifest};
use crate::model::{Index, MetaFile, Pack};
use crate::modrinth::Modrinth;
use crate::{SyncOptions, SyncProgress, SyncStage};

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
        Self { client }
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

        if !force
            && old.complete
            && !old.pack_version.is_empty()
            && old.pack_version == pack.version
            && old.index_hash == index_hash
        {
            emit(progress, SyncStage::Done, 0, 0, "Modpack up to date");
            return Ok(old);
        }

        let index: Index =
            toml::from_str(&index_text).map_err(|e| PackwizError::toml("index.toml", e))?;

        let metafile_total = index.files.iter().filter(|f| f.metafile).count() as u64;
        let mut resolved_meta = 0u64;
        let mut plan: Vec<Planned> = Vec::with_capacity(index.files.len());

        for entry in &index.files {
            if cancel() {
                return Err(PackwizError::Cancelled);
            }
            if entry.metafile {
                resolved_meta += 1;
                emit(
                    progress,
                    SyncStage::Resolving,
                    resolved_meta,
                    metafile_total,
                    format!("Reading {}", file_stem(&entry.file)),
                );
                let meta_url = join_url(&base, &entry.file);
                let meta_text = self.get_text(&meta_url)?;
                let meta: MetaFile = toml::from_str(&meta_text)
                    .map_err(|e| PackwizError::toml(entry.file.clone(), e))?;

                if !opts.side.wants(&meta.side) {
                    continue;
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

        let need: Vec<bool> = plan
            .iter()
            .map(|p| self.needs_download(opts, &old, p, force))
            .collect();
        let total = need.iter().filter(|n| **n).count() as u64;
        let mut done = 0u64;
        let mut failed: Vec<String> = Vec::new();

        for (p, &needs) in plan.iter().zip(&need) {
            if !needs {
                continue;
            }
            if cancel() {
                self.write_manifest(opts, &pack, &index_hash, &plan, &failed)?;
                return Err(PackwizError::Cancelled);
            }
            done += 1;
            emit(
                progress,
                SyncStage::Downloading,
                done,
                total,
                format!("Downloading {}", file_stem(&p.dest)),
            );
            if let Err(e) = self.download_one(&opts.game_dir, p) {
                failed.push(p.dest.clone());
                emit(
                    progress,
                    SyncStage::Downloading,
                    done,
                    total,
                    format!("Skipped {} ({})", file_stem(&p.dest), short_error(&e)),
                );
            }
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

        let manifest = self.write_manifest(opts, &pack, &index_hash, &plan, &failed)?;

        let msg = if failed.is_empty() {
            "Modpack up to date".to_string()
        } else {
            format!("Modpack ready — {} file(s) could not be downloaded", failed.len())
        };
        emit(progress, SyncStage::Done, total, total, msg);
        Ok(manifest)
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
    ) -> Result<Manifest> {
        let mut manifest = Manifest {
            pack_version: pack.version.clone(),
            index_hash: index_hash.to_string(),
            minecraft_version: pack.versions.minecraft.clone(),
            neoforge_version: pack.versions.neoforge.clone(),
            failed: failed.to_vec(),
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
        PackwizError::Http(_) => "download failed".to_string(),
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
