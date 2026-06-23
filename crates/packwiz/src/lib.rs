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
pub use installer::{sha1_hex, sha512_hex, Installer, OptionalMod, PackwizBranch};
pub use manifest::{FileFailure, FileRecord, ManagedMod, Manifest};
pub use model::{Index, IndexFile, MetaFile, ModOption, Pack, Versions};
pub use modrinth::{Modrinth, ModrinthProject, ResolvedVersion, SearchHit, VersionDep};

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
    pub public_key: Option<String>,
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
            public_key: None,
        }
    }
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
