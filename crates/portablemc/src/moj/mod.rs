
pub(crate) mod serde;

use std::io::{Write as _, BufReader};
use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::env;
use std::fs;

use chrono::{DateTime, FixedOffset};
use regex::Regex;
use uuid::Uuid;

use crate::base::{self, check_file_advanced, Game, HandlerInto as _, LibraryDownload, LoadedLibrary, VersionChannel, LIBRARIES_URL};
use crate::maven::Gav;
use crate::download;
use crate::msa;


pub(crate) const VERSION_MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Clone)]
pub struct Installer {
    base: base::Installer,
    inner: InstallerInner,
}

#[derive(Debug, Clone)]
struct InstallerInner {
    version: Version,
    fetch_excludes: Vec<FetchExclude>,
    demo: bool,
    quick_play: Option<QuickPlay>,
    resolution: Option<(u16, u16)>,
    disable_multiplayer: bool,
    disable_chat: bool,
    auth_type: String,  
    auth_uuid: Uuid,
    auth_username: String,
    auth_token: String,
    auth_xuid: String,  
    client_id: String,  
    fix_legacy_quick_play: bool,
    fix_legacy_proxy: bool,
    fix_legacy_merge_sort: bool,
    fix_legacy_resolution: bool,
    fix_broken_authlib: bool,
    fix_lwjgl: Option<String>,
}

impl Installer {

    pub fn new(version: impl Into<Version>) -> Self {
        Self {
            base: base::Installer::new(String::new()),
            inner: InstallerInner {
                version: version.into(),
                fetch_excludes: Vec::new(),  
                demo: false,
                quick_play: None,
                resolution: None,
                disable_multiplayer: false,
                disable_chat: false,
                auth_type: String::new(),
                auth_uuid: Uuid::nil(),
                auth_username: String::new(),
                auth_token: String::new(),
                auth_xuid: String::new(),
                client_id: String::new(),
                fix_legacy_quick_play: true,
                fix_legacy_proxy: true,
                fix_legacy_merge_sort: true,
                fix_legacy_resolution: true,
                fix_broken_authlib: true,
                fix_lwjgl: None,
            }
        }
    }

    pub fn new_with_release() -> Self {
        Self::new(Version::Release)
    }

    #[inline]
    pub fn base(&self) -> &base::Installer {
        &self.base
    }

    #[inline]
    pub fn base_mut(&mut self) -> &mut base::Installer {
        &mut self.base
    }

    #[inline]
    pub fn version(&self) -> &Version {
        &self.inner.version
    }

    #[inline]
    pub fn set_version(&mut self, version: impl Into<Version>) -> &mut Self {
        self.inner.version = version.into();
        self
    }

    #[inline]
    pub fn fetch_excludes(&self) -> &[FetchExclude] {
        &self.inner.fetch_excludes
    }

    pub fn clear_fetch_exclude(&mut self) -> &mut Self {
        self.inner.fetch_excludes.clear();
        self
    }

    pub fn add_fetch_exclude(&mut self, exclude: FetchExclude) -> &mut Self {
        self.inner.fetch_excludes.push(exclude);
        self
    }

    #[inline]
    pub fn demo(&self) -> bool {
        self.inner.demo
    }

    #[inline]
    pub fn set_demo(&mut self, demo: bool) -> &mut Self {
        self.inner.demo = demo;
        self
    }

    #[inline]
    pub fn quick_play(&self) -> Option<&QuickPlay> {
        self.inner.quick_play.as_ref()
    }

    #[inline]
    pub fn set_quick_play(&mut self, quick_play: QuickPlay) -> &mut Self {
        self.inner.quick_play = Some(quick_play);
        self
    }

    #[inline]
    pub fn remove_quick_play(&mut self) -> &mut Self {
        self.inner.quick_play = None;
        self
    }

    #[inline]
    pub fn resolution(&self) -> Option<(u16, u16)> {
        self.inner.resolution
    }

    #[inline]
    pub fn set_resolution(&mut self, width: u16, height: u16) -> &mut Self {
        self.inner.resolution = Some((width, height));
        self
    }

    #[inline]
    pub fn remove_resolution(&mut self) -> &mut Self {
        self.inner.resolution = None;
        self
    }

    #[inline]
    pub fn disable_multiplayer(&self) -> bool {
        self.inner.disable_multiplayer
    }

    #[inline]
    pub fn set_disable_multiplayer(&mut self, disable_multiplayer: bool) -> &mut Self {
        self.inner.disable_multiplayer = disable_multiplayer;
        self
    }

    #[inline]
    pub fn disable_chat(&self) -> bool {
        self.inner.disable_chat
    }

    #[inline]
    pub fn set_disable_chat(&mut self, disable_chat: bool) -> &mut Self {
        self.inner.disable_chat = disable_chat;
        self
    }

    #[inline]
    pub fn auth_uuid(&self) -> Uuid {
        self.inner.auth_uuid
    }

    #[inline]
    pub fn auth_username(&self) -> &str {
        &self.inner.auth_username
    }

    fn reset_auth_online(&mut self) -> &mut Self {
        self.inner.auth_type = String::new();
        self.inner.auth_token = String::new();
        self.inner.auth_xuid = String::new();
        self
    }

    pub fn set_auth_offline(&mut self, uuid: Uuid, username: impl Into<String>) -> &mut Self {
        self.inner.auth_uuid = uuid;
        self.inner.auth_username = username.into();
        self.inner.auth_username.truncate(16);
        self.reset_auth_online()
    }

    pub fn set_auth_offline_uuid(&mut self, uuid: Uuid) -> &mut Self {
        self.inner.auth_uuid = uuid;
        self.inner.auth_username = uuid.to_string();
        self.inner.auth_username.truncate(8);
        self.reset_auth_online()
    }

    pub fn set_auth_offline_username(&mut self, username: impl Into<String>) -> &mut Self {
        
        self.inner.auth_username = username.into();
        self.inner.auth_username.truncate(16);

        let mut context = md5::Context::new();
        context.write_fmt(format_args!("OfflinePlayer:{}", self.inner.auth_username)).unwrap();
        
        self.inner.auth_uuid = uuid::Builder::from_bytes(context.compute().0)
            .with_variant(uuid::Variant::RFC4122)
            .with_version(uuid::Version::Md5)
            .into_uuid();

        self.reset_auth_online()

    }

    pub fn set_auth_offline_username_legacy(&mut self, username: impl Into<String>) -> &mut Self {
        self.inner.auth_username = username.into();
        self.inner.auth_username.truncate(16);
        self.inner.auth_uuid = Uuid::new_v5(&base::UUID_NAMESPACE, self.inner.auth_username.as_bytes());
        self.reset_auth_online()
    }

    pub fn set_auth_offline_hostname(&mut self) -> &mut Self {
        self.set_auth_offline_uuid(Uuid::new_v5(&base::UUID_NAMESPACE, gethostname::gethostname().as_encoded_bytes()))
    }

    pub fn set_auth_msa(&mut self, account: &msa::Account) -> &mut Self {
        self.inner.auth_uuid = account.uuid();
        self.inner.auth_username = account.username().to_string();
        self.inner.auth_token = account.access_token().to_string();
        self.inner.auth_type = "msa".to_string();
        self.inner.auth_xuid = account.xuid().to_string();
        self
    }

    #[inline]
    pub fn client_id(&self) -> &str {
        &self.inner.client_id
    }

    #[inline]
    pub fn set_client_id(&mut self, client_id: impl Into<String>) -> &mut Self {
        self.inner.client_id = client_id.into();
        self
    }

    #[inline]
    pub fn fix_legacy_quick_play(&self) -> bool {
        self.inner.fix_legacy_quick_play
    }

    #[inline]
    pub fn set_fix_legacy_quick_play(&mut self, fix: bool) -> &mut Self {
        self.inner.fix_legacy_quick_play = fix;
        self
    }

    #[inline]
    pub fn fix_legacy_proxy(&self) -> bool {
        self.inner.fix_legacy_proxy
    }

    #[inline]
    pub fn set_fix_legacy_proxy(&mut self, fix: bool) -> &mut Self {
        self.inner.fix_legacy_proxy = fix;
        self
    }

    #[inline]
    pub fn fix_legacy_merge_sort(&self) -> bool {
        self.inner.fix_legacy_merge_sort
    }

    #[inline]
    pub fn set_fix_legacy_merge_sort(&mut self, fix: bool) -> &mut Self {
        self.inner.fix_legacy_merge_sort = fix;
        self
    }

    #[inline]
    pub fn fix_legacy_resolution(&self) -> bool {
        self.inner.fix_legacy_resolution
    }

    #[inline]
    pub fn set_fix_legacy_resolution(&mut self, fix: bool) -> &mut Self {
        self.inner.fix_legacy_resolution = fix;
        self
    }

    #[inline]
    pub fn fix_broken_authlib(&self) -> bool {
        self.inner.fix_broken_authlib
    }

    #[inline]
    pub fn set_fix_broken_authlib(&mut self, fix: bool) -> &mut Self {
        self.inner.fix_broken_authlib = fix;
        self
    }

    #[inline]
    pub fn fix_lwjgl(&self) -> Option<&str> {
        self.inner.fix_lwjgl.as_deref()
    }

    #[inline]
    pub fn set_fix_lwjgl(&mut self, lwjgl_version: impl Into<String>) -> &mut Self {
        self.inner.fix_lwjgl = Some(lwjgl_version.into());
        self
    }
    
    #[inline]
    pub fn remove_fix_lwjgl(&mut self) -> &mut Self {
        self.inner.fix_lwjgl = None;
        self
    }

    #[inline]
    pub fn install(&mut self, mut handler: impl Handler) -> Result<Game> {
        self.install_dyn(&mut handler)
    }

    #[inline(never)]
    fn install_dyn(&mut self, handler: &mut dyn Handler) -> Result<Game> {
        
        if self.inner.auth_uuid.is_nil() || self.inner.auth_username.is_empty() {
            self.set_auth_offline_hostname();
        }

        let &mut Self {
            ref mut base,
            ref inner,
        } = self;

        let manifest = match self.inner.version {
            Version::Release | 
            Version::Snapshot => Some(Manifest::request((&mut *handler).into_download())?),
            _ => None
        };

        let version = match &self.inner.version {
            Version::Release => manifest.as_ref().unwrap().latest_release_name(),
            Version::Snapshot => manifest.as_ref().unwrap().latest_snapshot_name(),
            Version::Name(name) => name.as_str(),
        };

        base.set_version(version);
        
        let mut leaf_version = String::new();

        let mut game = {

            let mut handler = InternalHandler {
                inner: &mut *handler,
                installer: &inner,
                error: Ok(()),
                manifest,
                leaf_version: &mut leaf_version,
            };
    
            let res = base.install(&mut handler);
            handler.error?;
            res?

        };

        game.replace_args(|arg| {
            Some(match arg {
                "auth_player_name" => inner.auth_username.clone(),
                "auth_uuid" => inner.auth_uuid.as_simple().to_string(),
                "auth_access_token" => inner.auth_token.clone(),
                "auth_xuid" => inner.auth_xuid.clone(),
                "auth_session" if !inner.auth_token.is_empty() => 
                    format!("token:{}:{}", inner.auth_token, inner.auth_uuid.as_simple()),
                "auth_session" => String::new(),
                "user_type" => inner.auth_type.clone(),
                "user_properties" => format!("{{}}"),
                "clientid" => inner.client_id.clone(),
                _ => return None
            })
        });

        if let Some(quick_play) = &inner.quick_play {

            let quick_play_arg = match quick_play {
                QuickPlay::Path { .. } => "quickPlayPath",
                QuickPlay::Singleplayer { .. } => "quickPlaySingleplayer",
                QuickPlay::Multiplayer { .. } => "quickPlayMultiplayer",
                QuickPlay::Realms { .. } => "quickPlayRealms",
            };

            let mut quick_play_supported = false;
            game.replace_args(|arg| {
                if arg == quick_play_arg {
                    quick_play_supported = true;
                    Some(match quick_play {
                        QuickPlay::Path { path } => path.display().to_string(),
                        QuickPlay::Singleplayer { name } => name.clone(),
                        QuickPlay::Multiplayer { host, port } => format!("{host}:{port}"),
                        QuickPlay::Realms { id } => id.clone(),
                    })
                } else {
                    None
                }
            });

            if !quick_play_supported && inner.fix_legacy_quick_play {
                if let QuickPlay::Multiplayer { host, port } = quick_play {

                    game.game_args.extend([
                        "--server".to_string(), host.clone(),
                        "--port".to_string(), port.to_string(),
                    ]);

                    quick_play_supported = true;
                    handler.on_event(Event::FixedLegacyQuickPlay);

                }
            }

            if !quick_play_supported {
                handler.on_event(Event::WarnUnsupportedQuickPlay {  });
            }

        }

        if inner.fix_legacy_proxy {

            let proxy_port = match leaf_version.as_bytes() {
                [b'1', b'.', b'0' | b'1' | b'3' | b'4' | b'5'] |
                [b'1', b'.', b'2' | b'3' | b'4' | b'5', b'.', ..] |
                b"13w16a" | b"13w16b" => Some(11707),
                id if id.starts_with(b"a1.0.") => Some(80),
                id if id.starts_with(b"a1.1.") => Some(11702),
                id if id.starts_with(b"a1.") => Some(11705),
                id if id.starts_with(b"b1.") => Some(11705),
                _ => None,
            };

            if let Some(proxy_port) = proxy_port {
                game.jvm_args.push(format!("-Dhttp.proxyHost=betacraft.uk"));
                game.jvm_args.push(format!("-Dhttp.proxyPort={proxy_port}"));
                handler.on_event(Event::FixedLegacyProxy { host: "betacraft.uk", port: proxy_port });
            }

        }

        if inner.fix_legacy_merge_sort && (leaf_version.starts_with("a1.") || leaf_version.starts_with("b1.")) {
            game.jvm_args.push("-Djava.util.Arrays.useLegacyMergeSort=true".to_string());
            handler.on_event(Event::FixedLegacyMergeSort);
        }

        if let Some((width, height)) = inner.resolution {

            let mut resolution_supported = false;
            game.replace_args(|arg| {
                let repl = match arg {
                    "resolution_width" => width.to_string(),
                    "resolution_height" => height.to_string(),
                    _ => return None
                };
                resolution_supported = true;
                Some(repl)
            });

            if !resolution_supported && inner.fix_legacy_resolution {

                game.game_args.extend([
                    "--width".to_string(), width.to_string(),
                    "--height".to_string(), height.to_string(),
                ]);

                resolution_supported = true;
                handler.on_event(Event::FixedLegacyResolution);

            }

            if !resolution_supported {
                handler.on_event(Event::WarnUnsupportedResolution);
            }

        }

        if inner.disable_multiplayer {
            game.game_args.push("--disableMultiplayer".to_string());
        }

        if inner.disable_chat {
            game.game_args.push("--disableChat".to_string());
        }

        Ok(game)

    }

}

#[derive(Debug)]
#[non_exhaustive]
pub enum Event<'a> {
    Base(base::Event<'a>),
    InvalidatedVersion { version: &'a str },
    FetchVersion { version: &'a str },
    FetchedVersion { version: &'a str },
    FixedLegacyQuickPlay,
    FixedLegacyProxy { host: &'a str, port: u16 },
    FixedLegacyMergeSort,
    FixedLegacyResolution,
    FixedBrokenAuthlib,
    WarnUnsupportedQuickPlay,
    WarnUnsupportedResolution,
}

pub trait Handler {
    fn on_event(&mut self, event: Event);

    /// Return `true` to request that an in-progress install be aborted.
    fn cancelled(&self) -> bool {
        false
    }
}

impl<H: Handler + ?Sized> Handler for &mut H {
    #[inline]
    fn on_event(&mut self, event: Event) {
        (**self).on_event(event)
    }

    #[inline]
    fn cancelled(&self) -> bool {
        (**self).cancelled()
    }
}

impl Handler for () {
    fn on_event(&mut self, event: Event) {
        let _ = event;
    }
}

pub(crate) trait HandlerInto: Handler + Sized {

    #[inline]
    fn into_base(self) -> impl base::Handler {
        pub(crate) struct Adapter<H: Handler>(pub H);
        impl<H: Handler> base::Handler for Adapter<H> {
            fn on_event(&mut self, event: base::Event) {
                self.0.on_event(Event::Base(event));
            }
            fn cancelled(&self) -> bool {
                self.0.cancelled()
            }
        }
        Adapter(self)
    }

    #[inline]
    fn into_download(self) -> impl download::Handler {
        self.into_base().into_download()
    }

}

impl<H: Handler> HandlerInto for H {}

#[derive(thiserror::Error, Debug)]
#[non_exhaustive]
pub enum Error {
    #[error("base: {0}")]
    Base(#[source] base::Error),
    #[error("lwjgl fix not found: {version}")]
    LwjglFixNotFound {
        version: String,
    },
}

impl<T: Into<base::Error>> From<T> for Error {
    fn from(value: T) -> Self {
        Error::Base(value.into())
    }
}

impl Error {
    /// `true` if this error was produced because the install was cancelled.
    #[inline]
    pub fn is_cancelled(&self) -> bool {
        matches!(self, Self::Base(e) if e.is_cancelled())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone)]
pub enum Version {
    Release,
    Snapshot,
    Name(String),
}

impl<T: Into<String>> From<T> for Version {
    fn from(value: T) -> Self {
        Self::Name(value.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuickPlay {
    Path {
        path: PathBuf,
    },
    Singleplayer {
        name: String,
    },
    Multiplayer {
        host: String,
        port: u16,
    },
    Realms {
        id: String,
    },
}

#[derive(Debug, Clone)]
pub enum FetchExclude {
    All,
    Exact(String),
    Regex(Regex),
}

#[derive(Debug)]
pub struct Manifest {
    inner: Box<serde::MojangManifest>,
}

impl Manifest {

    pub fn request(mut handler: impl download::Handler) -> Result<Self> {
        return Self::request_dyn(&mut handler)
    }

    fn request_dyn(handler: &mut dyn download::Handler) -> Result<Self> {

        let mut entry = download::single_cached(VERSION_MANIFEST_URL)
            .set_keep_open()
            .download(handler)?;

        let reader = BufReader::new(entry.take_handle().unwrap());
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        let manifest = serde_path_to_error::deserialize::<_, Box<serde::MojangManifest>>(&mut deserializer)
            .map_err(|e| base::Error::new_json_file(e, entry.file()))?;

        Ok(Self { inner: manifest })

    }

    pub fn iter(&self) -> impl Iterator<Item = ManifestVersion<'_>> + use<'_> {
        self.inner.versions.iter()
            .map(ManifestVersion)
    }

    #[inline]
    pub fn latest_release_name(&self) -> &str {
        &self.inner.latest.release
    }

    #[inline]
    pub fn latest_snapshot_name(&self) -> &str {
        &self.inner.latest.snapshot
    }

    pub fn find_index_of_name(&self, name: &str) -> Option<usize> {
        self.inner.versions.iter().position(|v| v.id == name)
    }

    pub fn find_by_index(&self, index: usize) -> Option<ManifestVersion<'_>> {
        self.inner.versions.get(index).map(ManifestVersion)
    }

    pub fn find_by_name(&self, name: &str) -> Option<ManifestVersion<'_>> {
        self.inner.versions.iter()
            .find(|v| v.id == name)
            .map(ManifestVersion)
    }

}

#[derive(Debug)]
pub struct ManifestVersion<'a>(&'a serde::MojangManifestVersion);

impl<'a> ManifestVersion<'a> {

    pub fn name(&self) -> &'a str {
        &self.0.id
    }

    pub fn channel(&self) -> VersionChannel {
        VersionChannel::from(self.0.r#type)
    }

    pub fn time(&self) -> &'a DateTime<FixedOffset> {
        &self.0.time
    }

    pub fn release_time(&self) -> &'a DateTime<FixedOffset> {
        &self.0.release_time
    }

    pub fn url(&self) -> &'a str {
        &self.0.download.url
    }

    pub fn size(&self) -> Option<u32> {
        self.0.download.size
    }

    pub fn sha1(&self) -> Option<&'a [u8; 20]> {
        self.0.download.sha1.as_deref()
    }

}


struct InternalHandler<'a> {
    inner: &'a mut dyn Handler,
    installer: &'a InstallerInner,
    error: Result<()>,
    manifest: Option<Manifest>,
    leaf_version: &'a mut String,
}

impl<'a> base::Handler for InternalHandler<'a> {
    
    fn on_event(&mut self, mut event: base::Event) {
        
        let ret = match event {
            base::Event::FilterFeatures { 
                ref mut features,
            } => self.filter_features(*features),
            base::Event::LoadedHierarchy {
                hierarchy,
            } => self.loaded_hierarchy(hierarchy),
            base::Event::LoadVersion { 
                version, 
                file,
            } => self.load_version(version, file),
            base::Event::NeedVersion { 
                version, 
                file, 
                ref mut retry,
            } => match self.need_version(version, file) {
                Ok(true) => {
                    **retry = true;
                    Ok(())
                }
                Ok(false) => Ok(()),
                Err(e) => Err(e),
            }
            base::Event::FilterLibraries { 
                ref mut libraries,
            } => self.filter_libraries(*libraries),
            _ => Ok(())
        };
        
        if let Err(e) = ret {
            self.error = Err(e);
            return;
        }

        self.inner.on_event(Event::Base(event));

    }

    fn cancelled(&self) -> bool {
        self.inner.cancelled()
    }

}

impl InternalHandler<'_> {

    fn filter_features(&mut self, features: &mut HashSet<String>) -> Result<()> {
        
        if self.installer.demo {
            features.insert("is_demo_user".to_string());
        }

        if self.installer.resolution.is_some() {
            features.insert("has_custom_resolution".to_string());
        }

        if let Some(quick_play) = &self.installer.quick_play {
            features.insert(match quick_play {
                QuickPlay::Path { .. } => "has_quick_plays_support",
                QuickPlay::Singleplayer { .. } => "is_quick_play_singleplayer",
                QuickPlay::Multiplayer { .. } => "is_quick_play_multiplayer",
                QuickPlay::Realms { .. } => "is_quick_play_realms",
            }.to_string());
        }

        Ok(())

    }

    fn loaded_hierarchy(&mut self, hierarchy: &[base::LoadedVersion]) -> Result<()> {
        *self.leaf_version = hierarchy.last().unwrap().name().to_string();
        Ok(())
    }

    fn load_version(&mut self, version: &str, file: &Path) -> Result<()> {

        for pattern in &self.installer.fetch_excludes {
            match pattern {
                FetchExclude::All => 
                    return Ok(()),
                FetchExclude::Exact(name) if name == version => 
                    return Ok(()),
                FetchExclude::Regex(regex) if regex.is_match(version) => 
                    return Ok(()),
                _ => (),
            }
        }

        let manifest = match self.manifest {
            Some(ref manifest) => manifest,
            None => self.manifest.insert(Manifest::request((&mut *self.inner).into_download())?)
        };

        let Some(version) = manifest.find_by_name(version) else {
            return Ok(());
        };

        if !check_file_advanced(file, version.size(), version.sha1(), true)? {
            
            fs::remove_file(file)
                .map_err(|e| base::Error::new_io_file(e, file))?;
            
            self.inner.on_event(Event::InvalidatedVersion { version: version.name() });
        
        }

        Ok(())

    }

    fn need_version(&mut self, version: &str, file: &Path) -> Result<bool> {

        let Some(manifest) = self.manifest.as_ref() else {
            return Ok(false);
        };
        
        let Some(version) = manifest.find_by_name(version) else {
            return Ok(false);
        };
        
        self.inner.on_event(Event::FetchVersion { version: version.name() });
        
        download::single(version.url(), file)
            .set_expected_size(version.size())
            .set_expected_sha1(version.sha1().copied())
            .download((&mut *self.inner).into_download())?;

        self.inner.on_event(Event::FetchedVersion { version: version.name() });

        Ok(true)

    }

    fn filter_libraries(&mut self, libraries: &mut Vec<LoadedLibrary>) -> Result<()> {
        
        if self.installer.fix_broken_authlib {
            self.apply_fix_broken_authlib(&mut *libraries)?;
        }

        if let Some(lwjgl_version) = self.installer.fix_lwjgl.as_deref() {
            self.apply_fix_lwjgl(&mut *libraries, lwjgl_version)?;
        }

        Ok(())

    }

    fn apply_fix_broken_authlib(&mut self, libraries: &mut Vec<LoadedLibrary>) -> Result<()> {

        let target_gav = Gav::new("com.mojang", "authlib", "2.1.28", None, None).unwrap();
        let pos = libraries.iter().position(|lib| lib.name == target_gav);
    
        if let Some(pos) = pos {

            libraries[pos].path = None;  
            libraries[pos].name = libraries[pos].name.with_version("2.2.30").unwrap();
            libraries[pos].download = Some(LibraryDownload {
                url: format!("{LIBRARIES_URL}{}", libraries[pos].name.url()),
                size: Some(87497),
                sha1: Some([0xd6, 0xe6, 0x77, 0x19, 0x9a, 0xa6, 0xb1, 0x9c, 0x4a, 0x9a, 0x2e, 0x72, 0x50, 0x34, 0x14, 0x9e, 0xb3, 0xe7, 0x46, 0xf8]),
            });

            self.inner.on_event(Event::FixedBrokenAuthlib);

        }

        Ok(())
    
    }
    
    fn apply_fix_lwjgl(&mut self, libraries: &mut Vec<LoadedLibrary>, version: &str) -> Result<()> {
    
        let Some(("", minor_patch)) = version.split_once("3.") else {
            return Err(Error::LwjglFixNotFound {
                version: version.to_string(),
            });
        };

        if minor_patch != "2.3" {

            let (minor, _) = minor_patch.split_once('.').unwrap_or((minor_patch, ""));
            let Ok(minor) = minor.parse::<u32>() else {
                return Err(Error::LwjglFixNotFound {
                    version: version.to_string(),
                });
            };

            if minor < 3 {
                return Err(Error::LwjglFixNotFound {
                    version: version.to_string(),
                });
            }

        }
        let classifier = match (env::consts::OS, env::consts::ARCH) {
            ("windows", "x86") => "natives-windows-x86",
            ("windows", "x86_64") => "natives-windows",
            ("windows", "aarch64") if version != "3.2.3" => "natives-windows-arm64",
            ("linux", "x86" | "x86_64") => "natives-linux",
            ("linux", "arm") => "natives-linux-arm32",
            ("linux", "aarch64") => "natives-linux-arm64",
            ("macos", "x86_64") => "natives-macos",
            ("macos", "aarch64") if version != "3.2.3" => "natives-macos-arm64",
            _ => return Err(Error::LwjglFixNotFound { 
                version: version.to_string(),
            })
        };
    
        let mut lwjgl_libs = Vec::new();
    
        libraries.retain_mut(|lib| {
            if let ("org.lwjgl", "jar") = (lib.name.group(), lib.name.extension()) {
                if lib.name.classifier().is_none() {
                    if let Some(new_name) = lib.name.with_version(version) 
                    && let Some(new_classifier_name) = new_name.with_classifier(Some(classifier)) {
                        lib.path = None;
                        lib.download = None;  
                        lib.name = new_name;
                        lwjgl_libs.push(new_classifier_name);
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                true
            }
        });
    
        libraries.extend(lwjgl_libs.into_iter().map(|gav| {
            LoadedLibrary {
                name: gav,
                path: None,
                download: None, 
                natives: false,
            }
        }));
    
        for lib in libraries {
            if let ("org.lwjgl", "jar") = (lib.name.group(), lib.name.extension()) {
                let url = format!("https://repo1.maven.org/maven2/{}", lib.name.url());
                lib.download = Some(LibraryDownload { url, size: None, sha1: None });
            }
        }

        Ok(())
    
    }

}
