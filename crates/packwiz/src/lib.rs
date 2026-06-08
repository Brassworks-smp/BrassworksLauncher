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
//! Right now only Modrinth and direct download links are supported. CurseForge
//! stuff is ignored because the Brassworks pack only uses Modrinth anyway, so
//! there wasn't much point implementing it.
//!
//! Basically it just makes sure the game directory matches whatever the modpack
//! says it should look like.
//!
//! [packwiz]: https://github.com/packwiz/packwiz-installer
//!
//! ```no_run
//! use packwiz::{Installer, Side, SyncOptions};
//! # use std::path::PathBuf;
//!
//! let installer = Installer::new();
//!
//! let opts = SyncOptions {
//!     pack_url: "https://example.com/pack.toml".into(),
//!     game_dir: PathBuf::from("/games/brassworks/minecraft"),
//!     manifest_path: PathBuf::from("/games/brassworks/packwiz.json"),
//!     side: Side::Client,
//! };
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

use std::path::PathBuf;

pub use curseforge::{Curseforge, CurseforgeProject};
pub use error::{PackwizError, Result};
pub use installer::{sha512_hex, Installer};
pub use manifest::{FileRecord, ManagedMod, Manifest};
pub use model::{Index, IndexFile, MetaFile, Pack, Versions};
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
}
