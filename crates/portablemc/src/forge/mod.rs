
mod serde;

use std::io::{self, BufRead, BufReader, BufWriter, Read, Seek};
use std::process::{Command, Output};
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::iter::FusedIterator;
use std::fmt::Write;
use std::{env, fs};
use std::fs::File;

use crate::moj::{self, FetchExclude, HandlerInto as _};
use crate::download::{self, Batch, EntryErrorKind};
use crate::base::{self, Game, LIBRARIES_URL};
use crate::maven::{Gav, MetadataParser};
use crate::path::{PathBufExt, PathExt};

use zip::ZipArchive;

use elsa::sync::FrozenMap;


#[derive(Debug, Clone)]
pub struct Installer {
    mojang: moj::Installer,
    loader: Loader,
    version: Version,
}

impl Installer {

    pub fn new(loader: Loader, version: impl Into<Version>) -> Self {
        Self {
            mojang: moj::Installer::new(String::new()),
            loader,
            version: version.into(),
        }
    }

    #[inline]
    pub fn mojang(&self) -> &moj::Installer {
        &self.mojang
    }

    #[inline]
    pub fn mojang_mut(&mut self) -> &mut moj::Installer {
        &mut self.mojang
    }

    #[inline]
    pub fn loader(&self) -> Loader {
        self.loader
    }

    #[inline]
    pub fn set_loader(&mut self, loader: Loader) -> &mut Self {
        self.loader = loader;
        self
    }

    #[inline]
    pub fn version(&self) -> &Version {
        &self.version
    }

    #[inline]
    pub fn set_version(&mut self, version: impl Into<Version>) -> &mut Self {
        self.version = version.into();
        self
    }

    #[inline]
    pub fn install(&mut self, mut handler: impl Handler) -> Result<Game> {
        self.install_dyn(&mut handler)
    }

    #[inline(never)]
    fn install_dyn(&mut self, handler: &mut dyn Handler) -> Result<Game> {

        let Self {
            ref mut mojang,
            loader,
            ref version,
        } = *self;

        let version = match version {
            Version::Name(name) => name.clone(),
            Version::Stable(game_version) |
            Version::Unstable(game_version) => {
                let stable = matches!(version, Version::Stable(_));
                match Repo::request(loader)?.find_latest(&game_version, stable) {
                    Some(v) => v.name().to_string(),
                    None => return Err(Error::LatestVersionNotFound { 
                        game_version: game_version.clone(), 
                        stable,
                    }),
                }
            }
        };

        let config = match loader {
            Loader::Forge => InstallConfig::new_forge(&version),
            Loader::NeoForge => InstallConfig::new_neoforge(&version),
        };
        
        let Some(config) = config else {
            return Err(Error::InstallerNotFound { version });
        };

        let prefix = config.default_prefix;
        let root_version = format!("{prefix}-{version}");

        mojang.add_fetch_exclude(FetchExclude::Exact(root_version.clone()));

        mojang.set_version(root_version.clone());
        let reason = match mojang.install((&mut *handler).into_mojang()) {
            Ok(game) => {

                let Some(check_libraries) = config.check_libraries else {
                    return Ok(game);
                };

                loop {

                    fn check_exists(file: &Path) -> bool {
                        fs::exists(file).unwrap_or_default()
                    }

                    let libs_dir = mojang.base().libraries_dir();
                    
                    if check_libraries.has_loader_client() 
                    && let Some(client_gav) = config.name.with_classifier(Some("client")) 
                    && !check_exists(&libs_dir.join(client_gav.file())) {
                        break InstallReason::MissingPatchedClient;
                    }

                    if check_libraries.has_loader_universal() 
                    && let Some(universal_gav) = config.name.with_classifier(Some("universal")) 
                    && !check_exists(&libs_dir.join(universal_gav.file())) {
                        break InstallReason::MissingUniversalClient;
                    }
                    
                    if check_libraries == InstallConfigCheckLibraries::ForgeV1
                    || check_libraries == InstallConfigCheckLibraries::ForgeV2 {

                        let mut mcp_version = None;
                        let mut args_iter = game.game_args.iter();
                        while let Some(arg) = args_iter.next() {
                            match arg.as_str() {
                                "--fml.neoFormVersion" |
                                "--fml.mcpVersion" => {
                                    let Some(version) = args_iter.next() else { continue };
                                    mcp_version = Some(version.as_str());
                                }
                                _ => {}
                            }
                        }

                        if let Some(mcp_version) = mcp_version {
                            
                            let mcp_artifact = libs_dir
                                .join("net")
                                .joined("minecraft")
                                .joined("client")
                                .joined(&config.game_version)
                                    .appended("-")
                                    .appended(mcp_version)
                                .joined("client")
                                    .appended("-")
                                    .appended(&config.game_version)
                                    .appended("-")
                                    .appended(mcp_version)
                                    .appended("-");

                            if !check_exists(&mcp_artifact.append("srg.jar")) {
                                break InstallReason::MissingClientSrg;
                            }

                            if check_libraries == InstallConfigCheckLibraries::ForgeV2 {
                                if !check_exists(&mcp_artifact.append("extra.jar")) {
                                    break InstallReason::MissingClientExtra;
                                }
                            } else {

                                let mc_artifact = libs_dir
                                    .join("net")
                                    .joined("minecraft")
                                    .joined("client")
                                    .joined(&config.game_version)
                                    .joined("client")
                                    .appended("-")
                                    .appended(&config.game_version)
                                    .appended("-");

                                if !check_exists(&mc_artifact.append("extra.jar"))
                                && !check_exists(&mc_artifact.append("extra-stable.jar")) {
                                    break InstallReason::MissingClientExtra;
                                }

                            }

                        }
                        
                    } else if check_libraries == InstallConfigCheckLibraries::NeoForgeV1 {

                        let patched_client_artifact = libs_dir
                            .join("net")
                            .joined("neoforged")
                            .joined("minecraft-client-patched")
                            .joined(config.name.version())
                            .joined("minecraft-client-patched")
                            .appended("-")
                            .appended(config.name.version())
                            .appended(".jar");

                        if !check_exists(&patched_client_artifact) {
                            break InstallReason::MissingPatchedClient;
                        }

                    }

                    return Ok(game);

                }

            }
            Err(moj::Error::Base(base::Error::VersionNotFound { version })) 
            if version == root_version => {
                InstallReason::MissingVersionMetadata
            }
            Err(moj::Error::Base(base::Error::LibraryNotFound { name: gav })) 
            if gav.group() == "net.minecraftforge" && gav.artifact() == "forge" => {
                InstallReason::MissingCoreLibrary
            }
            Err(e) => return Err(Error::Mojang(e))
        };

        try_install(&mut *handler, &mut *mojang, &config, &root_version, serde::InstallSide::Client, reason)?;

        mojang.set_version(root_version);
        let game = mojang.install((&mut *handler).into_mojang())?;
        Ok(game)

    }

}

#[derive(Debug)]
#[non_exhaustive]
pub enum Event<'a> {
    Mojang(moj::Event<'a>),
    Installing { tmp_dir: &'a Path, reason: InstallReason },
    FetchInstaller { version: &'a str },
    FetchedInstaller { version: &'a str},
    InstallingGame,
    FetchInstallerLibraries,
    FetchedInstallerLibraries,
    RunInstallerProcessor { name: &'a Gav, task: Option<&'a str> },
    Installed,
}

pub trait Handler {
    fn on_event(&mut self, event: Event);
}

impl<H: Handler + ?Sized> Handler for &mut H {
    #[inline]
    fn on_event(&mut self, event: Event) {
        (**self).on_event(event)
    }
}

impl Handler for () {
    fn on_event(&mut self, event: Event) {
        let _ = event;
    }
}

#[allow(unused)]
pub(crate) trait HandlerInto: Handler + Sized {
    
    #[inline]
    fn into_mojang(self) -> impl moj::Handler {
        pub(crate) struct Adapter<H: Handler>(pub H);
        impl<H: Handler> moj::Handler for Adapter<H> {
            fn on_event(&mut self, event: moj::Event) {
                self.0.on_event(Event::Mojang(event));
            }
        }
        Adapter(self)
    }
    
    #[inline]
    fn into_base(self) -> impl base::Handler {
        self.into_mojang().into_base()
    }

    #[inline]
    fn into_download(self) -> impl download::Handler {
        self.into_mojang().into_download()
    }

}

impl<H: Handler> HandlerInto for H {}

#[derive(thiserror::Error, Debug)]
#[non_exhaustive]
pub enum Error {
    #[error("mojang: {0}")]
    Mojang(#[source] moj::Error),
    #[error("latest version not found for {game_version} (stable: {stable})")]
    LatestVersionNotFound {
        game_version: String,
        stable: bool,
    },
    #[error("installer not found: {version}")]
    InstallerNotFound {
        version: String,
    },
    #[error("maven metadata is malformed")]
    MavenMetadataMalformed {  },
    #[error("installer profile not found")]
    InstallerProfileNotFound {  },
    #[error("installer profile incoherent")]
    InstallerProfileIncoherent {  },
    #[error("installer version metadata not found")]
    InstallerVersionMetadataNotFound {  },
    #[error("installer file to extract not found")]
    InstallerFileNotFound {
        entry: String,
    },
    #[error("installer processor not found")]
    InstallerProcessorNotFound {
        name: Gav,
    },
    #[error("installer processor has a main class that could not be found")]
    InstallerProcessorMainClassNotFound {
        name: Gav,
    },
    #[error("installer processor has a dependency that could not be found")]
    InstallerProcessDependencyNotFound {
        name: Gav,
        dependency: Gav,
    },
    #[error("installer processor execution failed")]
    InstallerProcessorFailed {
        name: Gav,
        output: Box<Output>,
    },
    #[error("installer processor output corrupted")]
    InstallerProcessorCorrupted {
        name: Gav,
        file: Box<Path>,
        expected_sha1: Box<[u8; 20]>,
    }
}

impl<T: Into<moj::Error>> From<T> for Error {
    fn from(value: T) -> Self {
        Self::Mojang(value.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallReason {
    MissingVersionMetadata,
    MissingCoreLibrary,
    MissingClientExtra,
    MissingClientSrg,
    MissingPatchedClient,
    MissingUniversalClient,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Loader {
    Forge,
    NeoForge,
}

#[derive(Debug, Clone)]
pub enum Version {
    Stable(String),
    Unstable(String),
    Name(String),
}

impl<T: Into<String>> From<T> for Version {
    fn from(value: T) -> Self {
        Self::Name(value.into())
    }
}

#[derive(Debug)]
pub struct Repo {
    main_xml: String,
    legacy_xml: Option<String>,
    neoforge: bool,
    major_versions: FrozenMap<[u16; 2], String>,
}

impl Repo {

    pub fn request(loader: Loader) -> Result<Self> {
        match loader {
            Loader::Forge => Self::request_forge(),
            Loader::NeoForge => Self::request_neoforge(),
        }
    }

    fn request_forge() -> Result<Self> {

        let mut main_entry = download::single_cached("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml")
            .set_keep_open()
            .download(())?;

        let main_xml = main_entry.read_handle_to_string().unwrap()
            .map_err(|e| base::Error::new_io_file(e, main_entry.file()))?;

        Ok(Self {
            main_xml,
            legacy_xml: None,
            neoforge: false,
            major_versions: FrozenMap::new(),
        })

    }

    fn request_neoforge() -> Result<Self> {

        let mut batch = download::Batch::new();
        batch.push_cached("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml").set_keep_open();
        batch.push_cached("https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml").set_keep_open();
        
        let mut result = batch.download(())
            .map_err(|e| base::Error::new_reqwest(e, "request neoforge repo"))?
            .into_result()?;
        
        let main_entry = result.entry_mut(0).unwrap();
        let main_xml = main_entry.read_handle_to_string().unwrap()
            .map_err(|e| base::Error::new_io_file(e, main_entry.file()))?;

        let legacy_entry = result.entry_mut(1).unwrap();
        let legacy_xml = legacy_entry.read_handle_to_string().unwrap()
            .map_err(|e| base::Error::new_io_file(e, legacy_entry.file()))?;
    
        Ok(Self {
            main_xml,
            legacy_xml: Some(legacy_xml),
            neoforge: true,
            major_versions: FrozenMap::new(),
        })

    }

    pub fn iter(&self) -> RepoIter<'_> {
        RepoIter {
            main: MetadataParser::new(&self.main_xml),
            legacy: self.legacy_xml.as_deref().map(MetadataParser::new),
            repo: self,
        }
    }

    pub fn find_by_name(&self, name: &str) -> Option<RepoVersion<'_>> {
        self.iter().find(|v| v.name() == name)
    }

    pub fn find_latest(&self, game_version: &str, stable: bool) -> Option<RepoVersion<'_>> {

        let prefix = 
            if !self.neoforge {
                if game_version == "1.7.10-pre4" {
                    format!("1.7.10_pre4-")
                } else {
                    format!("{game_version}-")
                }
            } else {
                let [major, minor, patch] = parse_game_version(game_version)?;
                if major >= 26 {
                    format!("{major}.{minor}.{patch}.")
                } else if major == 20 && minor == 1 {
                    format!("1.20.1-")
                } else {
                    format!("{major}.{minor}.")
                }
            };

        let mut max_loader = [0; 4];
        let mut max_version = None;
        for version in self.iter() {
            let Some(loader) = version.name().strip_prefix(&prefix) else { continue };
            if stable && !version.is_stable() { continue }
            let Some(loader) = parse_generic_version::<4, 1>(loader, true) else { continue };
            if loader > max_loader {
                max_loader = loader;
                max_version = Some(version);
            }
        }

        max_version

    }

}

#[derive(Debug)]
pub struct RepoIter<'a> {
    main: MetadataParser<'a>,
    legacy: Option<MetadataParser<'a>>,
    repo: &'a Repo,
}

impl<'a> Iterator for RepoIter<'a> {

    type Item = RepoVersion<'a>;
    
    fn next(&mut self) -> Option<Self::Item> {
        
        let version = match self.main.next() {
            Some(v) => v,
            None => self.legacy.as_mut()?.next()?,
        };

        Some(RepoVersion {
            repo: self.repo,
            version,
        })

    }

}

impl FusedIterator for RepoIter<'_> {  }

#[derive(Debug)]
pub struct RepoVersion<'a> {
    version: &'a str,
    repo: &'a Repo,
}

impl<'a> RepoVersion<'a> {

    pub fn name(&self) -> &'a str {
        self.version
    }

    pub fn game_version(&self) -> &'a str {
        if self.repo.neoforge {
            if self.version == "47.1.82" || self.version.starts_with("1.20.1-") {
                "1.20.1"
            } else if self.version.starts_with("0.25w14craftmine.") {
                "25w14craftmine"
            } else if let Some([major, minor, patch]) = parse_generic_version::<3, 2>(self.version, true) {
                if major >= 26 {
                    if minor == 0 {
                        ""  
                    } else {
                        let major_len = 1 + major.ilog10();
                        let minor_len = 1 + minor.ilog10();
                        if patch == 0 {
                            &self.version[..(major_len + 1 + minor_len) as usize]
                        } else {
                            let patch_len = 1 + patch.ilog10();
                            &self.version[..(major_len + 1 + minor_len + 1 + patch_len) as usize]
                        }
                    }
                } else {
                    self.repo.major_versions.insert_with([major, minor], || {
                        if minor == 0 {
                            format!("1.{major}")
                        } else {
                            format!("1.{major}.{minor}")
                        }
                    })
                }
            } else {
                ""  
            }
        } else {
            match self.version.split_once('-') {
                Some(("1.7.10_pre4", _)) => "1.7.10-pre4",
                Some((game_version, _)) => game_version,
                None => ""  
            }
        }
    }

    pub fn is_stable(&self) -> bool {
        if self.repo.neoforge {
            !self.version.ends_with("-beta") && !self.version.contains("-alpha")
        } else {
            true  
        }
    }

}


#[derive(Debug, Clone)]
struct InstallConfig {
    default_prefix: &'static str,
    name: Gav,
    repo_url: &'static str,
    game_version: String,
    check_libraries: Option<InstallConfigCheckLibraries>,
    legacy_install_profile: bool,
    check_processor_outputs: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InstallConfigCheckLibraries {
    ForgeV1,
    ForgeV2,
    NeoForgeV1,
}

impl InstallConfig {

    fn new_forge(name: &str) -> Option<Self> {

        let (game_version, loader_version) = name.split_once('-')?;
        let (loader_version, _) = loader_version.split_once('-').unwrap_or((loader_version, ""));
        let loader_version = parse_generic_version::<4, 2>(loader_version, false);

        Some(Self {
            default_prefix: "forge",
            name: Gav::new("net.minecraftforge", "forge", name, None, None)?,
            repo_url: "https://maven.minecraftforge.net",
            game_version: if game_version == "1.7.10_pre4" {
                "1.7.10-pre4".to_string()  
            } else {
                game_version.to_string()
            },
            check_libraries: match loader_version {
                Some(v) if v >= [32, 0, 20, 0] => Some(InstallConfigCheckLibraries::ForgeV2),
                Some(v) if v >= [25, 0, 9, 0] => Some(InstallConfigCheckLibraries::ForgeV1),
                _ => None
            },
            legacy_install_profile: loader_version.map(|v| v <= [14, 23, 5, 2847]).unwrap_or(false),
            check_processor_outputs: loader_version.map(|v| v >= [28, 1, 16, 0]).unwrap_or(false),
        })

    }

    fn new_neoforge(name: &str) -> Option<Self> {

        let gav;
        let game_version;
        let check_libraries;

        if name == "47.1.82" || name.starts_with("1.20.1-") {
            gav = Gav::new("net.neoforged", "forge", name, None, None)?;
            game_version = "1.20.1".to_string();
            check_libraries = InstallConfigCheckLibraries::ForgeV2;
        } else {
            let loader_version = parse_generic_version::<3, 2>(name, true)?;
            gav = Gav::new("net.neoforged", "neoforge", name, None, None)?;
            game_version = match loader_version {
                [major, minor, 0] if major >= 26 => format!("{major}.{minor}"),
                [major, minor, patch] if major >= 26 => format!("{major}.{minor}.{patch}"),
                [major, 0, _] => format!("1.{major}"),
                [major, minor, _] => format!("1.{major}.{minor}"),
            };
            check_libraries = if loader_version >= [21, 10, 37] {
                InstallConfigCheckLibraries::NeoForgeV1
            } else {
                InstallConfigCheckLibraries::ForgeV2
            };
        };

        Some(Self {
            default_prefix: "neoforge",
            name: gav,
            repo_url: "https://maven.neoforged.net/releases",
            game_version,
            check_libraries: Some(check_libraries),
            legacy_install_profile: false,
            check_processor_outputs: true,
        })

    }

}

impl InstallConfigCheckLibraries {

    #[inline]
    fn has_loader_universal(&self) -> bool {
        true  
    }

    #[inline]
    fn has_loader_client(&self) -> bool {
        matches!(self, Self::ForgeV1 | Self::ForgeV2)
    }

}

fn try_install(
    handler: &mut dyn Handler,
    mojang: &mut moj::Installer,
    config: &InstallConfig,
    root_version: &str,
    side: serde::InstallSide,
    reason: InstallReason,
) -> Result<()> {

    let tmp_dir = env::temp_dir().joined(root_version);
    handler.on_event(Event::Installing { tmp_dir: &tmp_dir, reason });

    handler.on_event(Event::FetchInstaller { version: config.name.version() });

    let Some(installer_gav) = config.name.with_classifier(Some("installer")) else {
        return Err(Error::InstallerNotFound { 
            version: config.name.version().to_string(),
        });
    };

    let installer_url = format!("{}/{}", config.repo_url, installer_gav.url());
    
    let entry = download::single(installer_url, tmp_dir.join("installer.jar"))
        .set_keep_open()
        .download((&mut *handler).into_download());

    let mut entry = match entry {
        Ok(entry) => entry,
        Err(e) => {
            if let EntryErrorKind::InvalidStatus(404) = e.kind() {
                return Err(Error::InstallerNotFound { 
                    version: config.name.version().to_string(),
                });
            } else {
                return Err(e.into());
            }
        }
    };

    let installer_reader = BufReader::new(entry.take_handle().unwrap());
    let installer_file = entry.file();
    let mut installer_zip = ZipArchive::new(installer_reader)
        .map_err(|e| base::Error::new_zip_file(e, installer_file))?;

    handler.on_event(Event::FetchedInstaller { version: config.name.version() });
    
    handler.on_event(Event::InstallingGame);
    mojang.set_version(config.game_version.clone());
    let jvm_file = match mojang.install((&mut *handler).into_mojang()) {
        Err(e) => return Err(Error::Mojang(e)),
        Ok(game) => game.jvm_file,
    };

    const PROFILE_ENTRY: &str = "install_profile.json";
    let profile = match installer_zip.by_name(PROFILE_ENTRY) {
        Ok(reader) => {
            
            let mut deserializer = serde_json::Deserializer::from_reader(reader);
            let res = if config.legacy_install_profile {
                serde_path_to_error::deserialize::<_, serde::LegacyInstallProfile>(&mut deserializer)
                    .map(InstallProfileKind::Legacy)
            } else {
                serde_path_to_error::deserialize::<_, serde::ModernInstallProfile>(&mut deserializer)
                    .map(InstallProfileKind::Modern)
            };

            res.map_err(|e| base::Error::new_json(e, format!("entry: {}, from: {}", 
                PROFILE_ENTRY, 
                installer_file.display())))?

        }
        Err(_) => return Err(Error::InstallerProfileNotFound {  })
    };

    let libraries_dir = base::canonicalize_file(mojang.base().libraries_dir())?;
    let game_version_dir = mojang.base().versions_dir().join(&config.game_version);
    let game_client_file = game_version_dir.join_with_extension(&config.game_version, "jar");
    let root_version_dir = mojang.base().versions_dir().join(&root_version);
    let metadata_file = root_version_dir.join_with_extension(&root_version, "json");
    let mut metadata;

    match profile {
        InstallProfileKind::Modern(profile) => {
            
            if profile.minecraft != config.game_version {
                return Err(Error::InstallerProfileIncoherent {  });
            }

            let metadata_entry = profile.json.strip_prefix('/').unwrap_or(&profile.json);
            metadata = match installer_zip.by_name(metadata_entry) {
                Ok(reader) => {
                    let mut deserializer = serde_json::Deserializer::from_reader(reader);
                    serde_path_to_error::deserialize::<_, Box<base::serde::VersionMetadata>>(&mut deserializer)
                        .map_err(|e| base::Error::new_json(e, format!("entry: {}, from: {}",
                            metadata_entry,
                            installer_file.display())))?
                }
                Err(_) => return Err(Error::InstallerVersionMetadataNotFound {  })
            };

            handler.on_event(Event::FetchInstallerLibraries);
            
            if let Some(name) = &profile.path {
                let lib_file = libraries_dir.join(name.file());
                extract_installer_maven_artifact(installer_file, &mut installer_zip, name, &lib_file)?;
            }

            let mut libraries = HashMap::new();
            let mut batch = Batch::new();

            for lib in &profile.libraries {

                if libraries.contains_key(&lib.name) {
                    continue
                }

                let lib_dl = &lib.downloads.artifact;

                let lib_file = if let Some(lib_path) = &lib_dl.path {
                    libraries_dir.join(base::check_path_relative_and_safe(lib_path)?)
                } else {
                    libraries_dir.join(lib.name.file())
                };

                libraries.insert(&lib.name, lib_file.clone());
                
                if !lib_dl.download.url.is_empty() {
                    let check_lib_sha1 = lib_dl.download.sha1.as_deref().filter(|_| mojang.base().strict_libraries_check());
                    if !base::check_file(&lib_file, lib_dl.download.size, check_lib_sha1)? {
                        batch.push(lib_dl.download.url.to_string(), lib_file)
                            .set_expected_size(lib_dl.download.size)
                            .set_expected_sha1(lib_dl.download.sha1.as_deref().copied());
                    }
                } else {
                    extract_installer_maven_artifact(installer_file, &mut installer_zip, &lib.name, &lib_file)?;
                }

            }

            if !batch.is_empty() {
                batch.download((&mut *handler).into_download())
                    .map_err(|e| base::Error::new_reqwest(e, "download forge libraries"))?
                    .into_result()?;
            }

            handler.on_event(Event::FetchedInstallerLibraries);

            let mut data = HashMap::with_capacity(profile.data.len());
            for (name, entry) in &profile.data {
                let entry = entry.get(side);
                let kind = match entry.as_bytes() {
                    [b'[', .., b']'] => {
                        if let Ok(gav) = entry[1..entry.len() - 1].parse::<Gav>() {
                            InstallDataTypedEntry::Library(gav)
                        } else {
                            continue;
                        }
                    }
                    [b'\'', .., b'\''] => {
                        InstallDataTypedEntry::Literal(entry[1..entry.len() - 1].to_string())
                    }
                    _ => {
                        let entry = entry.strip_prefix('/').unwrap_or(entry);
                        let tmp_file = tmp_dir.join(base::check_path_relative_and_safe(entry)?);
                        extract_installer_file(installer_file, &mut installer_zip, entry, &tmp_file)?;
                        InstallDataTypedEntry::File(tmp_file)
                    }
                };
                data.insert(name.clone(), kind);
            }

            data.insert("SIDE".to_string(), InstallDataTypedEntry::Literal(side.as_str().to_string()));
            data.insert("MINECRAFT_JAR".to_string(), InstallDataTypedEntry::File(game_client_file));
            data.insert("MINECRAFT_VERSION".to_string(), InstallDataTypedEntry::Literal(config.game_version.to_string()));
            data.insert("INSTALLER".to_string(), InstallDataTypedEntry::File(installer_file.to_path_buf()));
            data.insert("LIBRARY_DIR".to_string(), InstallDataTypedEntry::File(libraries_dir.to_path_buf()));

            for processor in &profile.processors {

                if let Some(processor_sides) = &processor.sides {
                    if !processor_sides.iter().copied().any(|processor_side| processor_side == side) {
                        continue
                    }
                }

                let Some(jar_file) = libraries.get(&processor.jar) else {
                    return Err(Error::InstallerProcessorNotFound {
                        name: processor.jar.clone(),
                    });
                };

                let Some(main_class) = find_jar_main_class(&jar_file)? else {
                    return Err(Error::InstallerProcessorMainClassNotFound {
                        name: processor.jar.clone(),
                    });
                };

                let mut classes = vec![jar_file.as_path()];
                for dep_name in &processor.classpath {
                    if let Some(dep_path) = libraries.get(dep_name) {
                        classes.push(dep_path.as_path());
                    } else {
                        return Err(Error::InstallerProcessDependencyNotFound {
                            name: processor.jar.clone(),
                            dependency: dep_name.clone(),
                        });
                    }
                }

                let class_path = env::join_paths(classes).unwrap();

                let task = if processor.args.len() >= 2 && processor.args[0] == "--task" {
                    Some(processor.args[1].as_str())
                } else {
                    None
                };

                handler.on_event(Event::RunInstallerProcessor { name: &processor.jar, task });

                let mut command = Command::new(&jvm_file);
                command
                    .arg("-cp")
                    .arg(class_path)
                    .arg(&main_class);

                for arg in &processor.args {
                    if let Some(arg) = format_processor_arg(&arg, &libraries_dir, &data) {
                        command.arg(arg);
                    } else {
                        command.arg(arg);
                    }
                }

                let output = command.output()
                    .map_err(|e| base::Error::new_io(e, format!("spawn: {}", jvm_file.display())))?;

                if !output.status.success() {
                    return Err(Error::InstallerProcessorFailed {
                        name: processor.jar.clone(),
                        output: Box::new(output),
                    });
                }

                if config.check_processor_outputs {
                    for (file, sha1) in &processor.outputs {
                        let Some(file) = format_processor_arg(&file, &libraries_dir, &data) else { continue };
                        let Some(sha1) = format_processor_arg(&sha1, &libraries_dir, &data) else { continue };
                        let Some(sha1) = crate::serde::parse_hex_bytes::<20>(&sha1) else { continue };
                        let file = Path::new(&file);
                        if !base::check_file(file, None, Some(&sha1))? {
                            return Err(Error::InstallerProcessorCorrupted {
                                name: processor.jar.clone(),
                                file: file.to_path_buf().into_boxed_path(),
                                expected_sha1: Box::new(sha1),
                            });
                        }
                    }
                }
                
            }

        }
        InstallProfileKind::Legacy(profile) => {
            
            metadata = profile.version_info;

            for lib in &mut metadata.libraries {
                if lib.url.is_none() {
                    lib.url = Some(LIBRARIES_URL.to_string());
                }
            }

            if metadata.inherits_from.is_none() {
                metadata.inherits_from = Some(config.game_version.clone());
            }

            let jar_file = libraries_dir.join(profile.install.path.file());
            let jar_entry = &profile.install.file_path[..];
            extract_installer_file(installer_file, &mut installer_zip, &jar_entry, &jar_file)?;

        }
    }

    metadata.id = root_version.to_string();
    base::write_version_metadata(&metadata_file, &metadata)?;

    handler.on_event(Event::Installed);

    Ok(())

}

#[derive(Debug)]
enum InstallProfileKind {
    Modern(serde::ModernInstallProfile),
    Legacy(serde::LegacyInstallProfile),
}

#[derive(Debug)]
enum InstallDataTypedEntry {
    Library(Gav),
    Literal(String),
    File(PathBuf),
}

fn format_processor_arg(
    input: &str, 
    libraries_dir: &Path, 
    data: &HashMap<String, InstallDataTypedEntry>
) -> Option<String> {

    if matches!(input.as_bytes(), [b'[', .., b']']) {
        let gav = input[1..input.len() - 1].parse::<Gav>().ok()?;
        return Some(format!("{}", libraries_dir.join(&gav.file()).display()));
    }

    #[derive(Debug)]
    enum TokenKind {
        Data,
        Literal,
    }

    let mut global_buf = String::new();
    let mut token_buf = String::new();
    let mut token = None;
    let mut escape = false;

    for (index, ch) in input.char_indices() {
        match ch {
            '\\' if !escape => {
                if index == input.len() - 1 {
                    return None;
                }
                escape = true;
            }
            '{' if !escape && token.is_none() => {
                token = Some(TokenKind::Data);
            }
            '}' if !escape && matches!(token, Some(TokenKind::Data)) => {
                match data.get(&token_buf)? {
                    InstallDataTypedEntry::Library(gav) => {
                        write!(global_buf, "{}", libraries_dir.join(&gav.file()).display()).unwrap();
                    }
                    InstallDataTypedEntry::Literal(lit) => {
                        global_buf.push_str(lit);
                    }
                    InstallDataTypedEntry::File(path_buf) => {
                        write!(global_buf, "{}", path_buf.display()).unwrap();
                    }
                }
                token_buf.clear();
                token = None;
            }
            '\'' if !escape && token.is_none() => {
                token = Some(TokenKind::Literal);
            }
            '\'' if !escape && matches!(token, Some(TokenKind::Literal)) => {
                global_buf.push_str(&token_buf);
                token_buf.clear();
                token = None;
            }
            _ => {
                if token.is_none() {
                    global_buf.push(ch);
                } else {
                    token_buf.push(ch);
                }
                escape = false;
            }
        }
    }

    Some(global_buf)

}


fn extract_installer_maven_artifact<R: Read + Seek>(
    installer_file: &Path,
    installer_zip: &mut ZipArchive<R>,
    src_name: &Gav,
    dst_file: &Path,
) -> Result<()> {
    let src_entry = format!("maven/{}", src_name.url());
    extract_installer_file(installer_file, installer_zip, &src_entry, dst_file)
}

fn extract_installer_file<R: Read + Seek>(
    installer_file: &Path,
    installer_zip: &mut ZipArchive<R>,
    src_entry: &str,
    dst_file: &Path,
) -> Result<()> {

    let mut reader = installer_zip.by_name(&src_entry)
        .map_err(|_| Error::InstallerFileNotFound { 
            entry: src_entry.to_string(),
        })?;

    let parent_dir = dst_file.parent().unwrap();
    fs::create_dir_all(parent_dir)
        .map_err(|e| base::Error::new_io_file(e, parent_dir))?;

    let mut writer = File::create(dst_file)
        .map_err(|e| base::Error::new_io_file(e, dst_file))
        .map(BufWriter::new)?;

    io::copy(&mut reader, &mut writer)
        .map_err(|e| base::Error::new_io(e, format!("extract: {}, from: {}", 
            src_entry, 
            installer_file.display())))?;

    Ok(())

}

fn find_jar_main_class(jar_file: &Path) -> Result<Option<String>> {

    let jar_reader = File::open(jar_file)
        .map_err(|e| base::Error::new_io_file(e, jar_file))
        .map(BufReader::new)?;

    let mut jar_zip = ZipArchive::new(jar_reader)
        .map_err(|e| base::Error::new_zip_file(e, jar_file))?;

    let Ok(mut manifest_reader) = jar_zip.by_name("META-INF/MANIFEST.MF")
        .map(BufReader::new) else {
            return Ok(None);
        };
    
    const MAIN_CLASS_KEY: &str = "Main-Class: ";

    let mut line = String::new();
    while manifest_reader.read_line(&mut line).unwrap_or(0) != 0 {
        if line.starts_with(MAIN_CLASS_KEY) {
            if let Some(last_non_whitespace) = line.rfind(|c: char| !c.is_whitespace()) {
                line.truncate(last_non_whitespace + 1);
                line.drain(0..MAIN_CLASS_KEY.len());
                return Ok(Some(line))
            } else {
                return Ok(None);
            }
        }
        line.clear();
    }

    Ok(None)
    
}

fn parse_generic_version<const MAX: usize, const MIN: usize>(mut version: &str, ignore_dash: bool) -> Option<[u16; MAX]> {
    if ignore_dash {
        version = version.split_once('-').map(|(version, _)| version).unwrap_or(version);
    }
    let mut it = version.split('.');
    let mut ret = [0; MAX];
    for i in 0..MAX {
        ret[i] = match it.next() {
            Some(raw) => raw.parse::<u16>().ok()?,
            None if i < MIN => return None,
            None => 0,
        };
    }
    Some(ret)
}

fn parse_game_version(version: &str) -> Option<[u16; 3]> {
    match version.strip_prefix("1.") {
        Some(version) => {
            if version.contains("-pre") || version.contains("-rc") || version.contains(" Pre-Release ") {
                None
            } else {
                parse_generic_version::<3, 1>(version, false)
            }
        }
        None => {
            if version.contains("-pre") || version.contains("-rc") || version.contains("-snapshot") {
                None
            } else {
                parse_generic_version::<3, 2>(version, false)
            }
        }
    }
}

#[cfg(test)]
mod test {

    use super::*;
    
    #[test]
    fn parse_version() {

        assert_eq!(parse_generic_version::<4, 2>("1", false), None);
        assert_eq!(parse_generic_version::<4, 2>("1.2", false), Some([1, 2, 0, 0]));
        assert_eq!(parse_generic_version::<4, 2>("1.2.3", false), Some([1, 2, 3, 0]));
        assert_eq!(parse_generic_version::<4, 2>("1.2.3.4", false), Some([1, 2, 3, 4]));
        assert_eq!(parse_generic_version::<4, 2>("1.2.3.4.5", false), Some([1, 2, 3, 4]));
        assert_eq!(parse_generic_version::<4, 2>("1.2.3.4.5-pre", false), Some([1, 2, 3, 4]));
        assert_eq!(parse_generic_version::<4, 2>("1.2.3.4-pre", false), None);
        assert_eq!(parse_generic_version::<4, 2>("1.2.3.4-pre", true), Some([1, 2, 3, 4]));
        assert_eq!(parse_generic_version::<4, 2>("1.2.3-pre", true), Some([1, 2, 3, 0]));
        assert_eq!(parse_generic_version::<4, 2>("1.2-pre", true), Some([1, 2, 0, 0]));
        assert_eq!(parse_generic_version::<4, 2>("1-pre", true), None);

        assert_eq!(parse_game_version("25w21a"), None);
        assert_eq!(parse_game_version("25w14craftmine"), None);
        assert_eq!(parse_game_version("1"), None);
        assert_eq!(parse_game_version("1.2"), Some([2, 0, 0]));
        assert_eq!(parse_game_version("1.2-pre3"), None);
        assert_eq!(parse_game_version("1.2.5"), Some([2, 5, 0]));
        assert_eq!(parse_game_version("1.2.5-pre3"), None);
        assert_eq!(parse_game_version("26.1-snapshot-1"), None);
        assert_eq!(parse_game_version("26.1-pre-3"), None);
        assert_eq!(parse_game_version("26.1-rc-3"), None);
        assert_eq!(parse_game_version("26.1"), Some([26, 1, 0]));
        assert_eq!(parse_game_version("26.1.1"), Some([26, 1, 1]));

    }

}
