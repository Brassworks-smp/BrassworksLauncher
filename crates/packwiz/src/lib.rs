//! # packwiz
//!
//! A Rust version of the original packwiz installer thing. I made this because
//! I wanted something native instead of running the Kotlin/Java version.
//!
//! It downloads a `pack.toml`, reads through the pack files, figures out what
//! needs to be downloaded, and then syncs everything into the Minecraft folder.
//! It also removes files that aren't in the pack anymore and respects whether
//! files are supposed to be client-side or server-side.
//!
//! [packwiz]: https://github.com/packwiz/packwiz-installer
//!
//! ```no_run
//! use packwiz::{Installer, SyncOptions};
//! # use std::path::PathBuf;
//!
//! let installer = Installer::new();
//!
//! let opts = SyncOptions::new(
//!     "https://example.com/pack.toml".into(),
//!     PathBuf::from("/games/brassworks/minecraft"),
//!     PathBuf::from("/games/brassworks/packwiz.json"),
//! );
//!
//! installer
//!     .sync(&opts, false, &|| false, &mut |p| {
//!         println!("{:?} {}/{}", p.stage, p.current, p.total);
//!     })
//!     .unwrap();
//! ```

mod curseforge;
mod error;
pub mod export;
mod installer;
mod manifest;
mod model;
mod modrinth;
mod parallel;
pub mod unsup;

pub use parallel::{parallel_run, DEFAULT_CONCURRENCY};
pub use unsup::{FlavorChoice, FlavorGroup, PublicKey};

use std::collections::HashSet;
use std::path::PathBuf;

pub use curseforge::{Curseforge, CurseforgeProject};
pub use error::{PackwizError, Result};
pub use installer::{
    local_pack_url, sha1_hex, sha256_hex, sha512_hex, Installer, OptionalMod, PackwizBranch,
};
pub use manifest::{FileFailure, FileRecord, ManagedMod, Manifest};
pub use model::{Index, IndexFile, MetaFile, ModOption, Pack, Versions};
pub use modrinth::{Modrinth, ModrinthProject, ResolvedVersion, SearchHit, VersionDep};

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SearchFilters {
    pub categories: Vec<String>,
    pub sort: Option<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub environment: Option<String>,
    pub open_source: bool,
    pub license: Option<String>,
    pub updated_after: Option<i64>,
    pub created_after: Option<i64>,
    pub allow_any_version: bool,
    pub allow_any_loader: bool,
}

impl SearchFilters {
    pub fn is_default(&self) -> bool {
        self.categories.is_empty()
            && self.sort.is_none()
            && self.game_versions.is_empty()
            && self.loaders.is_empty()
            && self.environment.is_none()
            && !self.open_source
            && self.license.is_none()
            && self.updated_after.is_none()
            && self.created_after.is_none()
            && !self.allow_any_version
            && !self.allow_any_loader
    }
}

pub(crate) fn sort_mc_versions_desc(versions: &mut Vec<String>) {
    fn parse(v: &str) -> Option<Vec<u32>> {
        v.split('.').map(|p| p.parse::<u32>().ok()).collect()
    }
    versions.sort_by(|a, b| match (parse(a), parse(b)) {
        (Some(pa), Some(pb)) => pb.cmp(&pa),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b.cmp(a),
    });
    versions.dedup();
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCategory {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterOptions {
    pub categories: Vec<FilterCategory>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub licenses: Vec<FilterCategory>,
    pub sorts: Vec<String>,
    pub supports_environment: bool,
    pub supports_advanced_facets: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Client,
    Server,
    Both,
}

impl Side {
    pub(crate) fn wants(self, file_side: &str) -> bool {
        match self {
            Side::Both => true,
            Side::Client => matches!(file_side, "both" | "client" | ""),
            Side::Server => matches!(file_side, "both" | "server" | ""),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncStage {
    Fetching,
    Resolving,
    Downloading,
    Cleaning,
    Done,
}

#[derive(Debug, Clone)]
pub struct SyncProgress {
    pub stage: SyncStage,
    pub current: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct SyncOptions {
    pub pack_url: String,
    pub game_dir: PathBuf,
    pub manifest_path: PathBuf,
    pub side: Side,
    pub optional: OptionalChoice,
    pub unsup: bool,
    pub flavors: HashSet<String>,
    /// Keep every flavored metafile regardless of `flavors`. Used by pack hosts
    /// so toggling a flavor locally never prunes mods out of the pack they
    /// publish (which would delete them from the published index).
    pub keep_all_flavors: bool,
    pub public_key: Option<String>,
    /// Mods/files to leave out of the install, matched case-insensitively
    /// against a file's metafile path, filename, display name, or any of their
    /// basenames/stems. Excluded files are never downloaded and are pruned if
    /// previously installed.
    pub exclude: Vec<String>,
}

impl SyncOptions {
    pub fn new(pack_url: String, game_dir: PathBuf, manifest_path: PathBuf) -> Self {
        Self {
            pack_url,
            game_dir,
            manifest_path,
            side: Side::Client,
            optional: OptionalChoice::Default,
            unsup: false,
            flavors: HashSet::new(),
            keep_all_flavors: false,
            public_key: None,
            exclude: Vec::new(),
        }
    }

    /// Whether any of the given identifiers (metafile path, filename, name)
    /// matches an exclusion token.
    pub(crate) fn is_excluded(&self, ids: &[&str]) -> bool {
        if self.exclude.is_empty() {
            return false;
        }
        self.exclude.iter().any(|token| {
            let token = token.trim();
            !token.is_empty() && ids.iter().any(|id| exclude_matches(id, token))
        })
    }
}

fn exclude_basename(s: &str) -> &str {
    s.rsplit(['/', '\\']).next().unwrap_or(s)
}

fn exclude_stem(s: &str) -> &str {
    let base = exclude_basename(s);
    if let Some(p) = base.strip_suffix(".pw.toml") {
        return p;
    }
    match base.rfind('.') {
        Some(i) if i > 0 => &base[..i],
        _ => base,
    }
}

fn exclude_matches(candidate: &str, token: &str) -> bool {
    candidate.eq_ignore_ascii_case(token)
        || exclude_basename(candidate).eq_ignore_ascii_case(exclude_basename(token))
        || exclude_stem(candidate).eq_ignore_ascii_case(exclude_stem(token))
}

#[derive(Debug, Clone, Default)]
pub enum OptionalChoice {
    #[default]
    Default,
    Explicit(HashSet<String>),
}

impl OptionalChoice {
    pub(crate) fn wants(&self, meta_path: &str, default: bool) -> bool {
        match self {
            OptionalChoice::Default => default,
            OptionalChoice::Explicit(set) => set.contains(meta_path),
        }
    }
}

#[cfg(test)]
mod optional_tests {
    use super::*;

    #[test]
    fn default_choice_honors_pack_default() {
        let c = OptionalChoice::Default;
        assert!(c.wants("mods/a.pw.toml", true));
        assert!(!c.wants("mods/a.pw.toml", false));
    }

    #[test]
    fn explicit_choice_ignores_pack_default() {
        let mut set = HashSet::new();
        set.insert("mods/a.pw.toml".to_string());
        let c = OptionalChoice::Explicit(set);
        assert!(c.wants("mods/a.pw.toml", false));
        assert!(!c.wants("mods/b.pw.toml", true));
    }
}

#[cfg(test)]
mod exclude_tests {
    use super::*;

    fn opts_with(exclude: &[&str]) -> SyncOptions {
        let mut o = SyncOptions::new(String::new(), PathBuf::new(), PathBuf::new());
        o.exclude = exclude.iter().map(|s| s.to_string()).collect();
        o
    }

    #[test]
    fn empty_exclude_matches_nothing() {
        let o = opts_with(&[]);
        assert!(!o.is_excluded(&["mods/sodium.pw.toml", "sodium.jar", "Sodium"]));
    }

    #[test]
    fn matches_by_stem_name_path_and_filename() {
        let ids = ["mods/sodium.pw.toml", "sodium.jar", "Sodium"];
        assert!(opts_with(&["sodium"]).is_excluded(&ids));
        assert!(opts_with(&["Sodium"]).is_excluded(&ids)); // case-insensitive
        assert!(opts_with(&["sodium.jar"]).is_excluded(&ids));
        assert!(opts_with(&["mods/sodium.pw.toml"]).is_excluded(&ids));
    }

    #[test]
    fn does_not_match_unrelated() {
        let ids = ["mods/sodium.pw.toml", "sodium.jar", "Sodium"];
        assert!(!opts_with(&["lithium"]).is_excluded(&ids));
    }

    #[test]
    fn blank_tokens_are_ignored() {
        let ids = ["mods/sodium.pw.toml", "sodium.jar", "Sodium"];
        assert!(!opts_with(&["", "  "]).is_excluded(&ids));
    }
}
