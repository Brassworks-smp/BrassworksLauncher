
mod serde;

use std::path::Path;

use reqwest::StatusCode;

use crate::moj::{self, HandlerInto as _};
use crate::base::{self, Game};
use crate::download;


#[derive(Debug, Clone)]
pub struct Installer {
    mojang: moj::Installer,
    loader: Loader,
    game_version: GameVersion,
    loader_version: LoaderVersion,
}

impl Installer {

    pub fn new(loader: Loader, game_version: impl Into<GameVersion>, loader_version: impl Into<LoaderVersion>) -> Self {
        Self {
            mojang: moj::Installer::new(String::new()),
            loader,
            game_version: game_version.into(),
            loader_version: loader_version.into(),
        }
    }

    pub fn new_with_stable(loader: Loader) -> Self {
        Self::new(loader, GameVersion::Stable, LoaderVersion::Stable)
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
    pub fn game_version(&self) -> &GameVersion {
        &self.game_version
    }

    #[inline]
    pub fn set_game_version(&mut self, version: impl Into<GameVersion>) {
        self.game_version = version.into();
    }

    #[inline]
    pub fn loader_version(&self) -> &LoaderVersion {
        &self.loader_version
    }

    #[inline]
    pub fn set_loader_version(&mut self, version: impl Into<LoaderVersion>) {
        self.loader_version = version.into();
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
            ref game_version,
            ref loader_version,
        } = *self;

        let api = Api::new(loader);

        let game_version = match game_version {
            GameVersion::Stable |
            GameVersion::Unstable => {

                let stable = matches!(game_version, GameVersion::Stable);
                let versions = api.request_game_versions()?;

                match versions.find_latest(stable) {
                    Some(v) => v.name().to_string(),
                    None => return Err(Error::LatestVersionNotFound { 
                        game_version: None, 
                        stable,
                    }),
                }

            }
            GameVersion::Name(name) => name.clone(),
        };

        let loader_version = match loader_version {
            LoaderVersion::Stable |
            LoaderVersion::Unstable => {
                
                let stable = matches!(loader_version, LoaderVersion::Stable);
                let versions = api.request_loader_versions(Some(&game_version))?;
                
                match versions.find_latest(stable) {
                    Some(v) => v.name().to_string(),
                    None => return Err(Error::LatestVersionNotFound { 
                        game_version: Some(game_version), 
                        stable,
                    }),
                }

            }
            LoaderVersion::Name(name) => name.clone(),
        };

        let prefix = loader.default_prefix();
        let root_version = format!("{prefix}-{game_version}-{loader_version}");
        mojang.set_version(root_version.clone());
        

        let game = {

            let mut handler = InternalHandler {
                inner: &mut *handler,
                error: Ok(()),
                api,
                root_version: &root_version,
                game_version: &game_version,
                loader_version: &loader_version,
            };
    
            let res = mojang.install(&mut handler);
            handler.error?;
            res?

        };
        
        Ok(game)

    }

}

#[derive(Debug)]
#[non_exhaustive]
pub enum Event<'a> {
    Mojang(moj::Event<'a>),
    FetchVersion { game_version: &'a str, loader_version: &'a str },
    FetchedVersion { game_version: &'a str, loader_version: &'a str },
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

#[allow(unused)]
pub(crate) trait HandlerInto: Handler + Sized {

    #[inline]
    fn into_mojang(self) -> impl moj::Handler {
        pub(crate) struct Adapter<H: Handler>(pub H);
        impl<H: Handler> moj::Handler for Adapter<H> {
            fn on_event(&mut self, event: moj::Event) {
                self.0.on_event(Event::Mojang(event));
            }
            fn cancelled(&self) -> bool {
                self.0.cancelled()
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
    #[error("latest version not found (stable: {stable})")]
    LatestVersionNotFound {
        game_version: Option<String>,
        stable: bool,
    },
    #[error("game version not found: {game_version}")]
    GameVersionNotFound {
        game_version: String,
    },
    #[error("loader version not found: {game_version}/{loader_version}")]
    LoaderVersionNotFound {
        game_version: String,
        loader_version: String,
    },
}

impl<T: Into<moj::Error>> From<T> for Error {
    fn from(value: T) -> Self {
        Self::Mojang(value.into())
    }
}

impl Error {
    /// `true` if this error was produced because the install was cancelled.
    #[inline]
    pub fn is_cancelled(&self) -> bool {
        matches!(self, Self::Mojang(e) if e.is_cancelled())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Loader {
    Fabric,
    Quilt,
    LegacyFabric,
    Babric,
}

impl Loader {

    fn default_prefix(self) -> &'static str {
        match self {
            Loader::Fabric => "fabric",
            Loader::Quilt => "quilt",
            Loader::LegacyFabric => "legacyfabric",
            Loader::Babric => "babric",
        }
    }

}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameVersion {
    Stable,
    Unstable,
    Name(String),
}

impl<T: Into<String>> From<T> for GameVersion {
    fn from(value: T) -> Self {
        Self::Name(value.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoaderVersion {
    Stable,
    Unstable,
    Name(String),
}

impl<T: Into<String>> From<T> for LoaderVersion {
    fn from(value: T) -> Self {
        Self::Name(value.into())
    }
}

#[derive(Debug)]
pub struct Api {
    base_url: &'static str,
}

impl Api {

    pub fn new(loader: Loader) -> Self {
        Self {
            base_url: match loader {
                Loader::Fabric => "https://meta.fabricmc.net/v2",
                Loader::Quilt => "https://meta.quiltmc.org/v3",
                Loader::LegacyFabric => "https://meta.legacyfabric.net/v2",
                Loader::Babric => "https://meta.babric.glass-launcher.net/v2",
            }
        }
    }

    pub fn request_game_versions(&self) -> Result<ApiGameVersions<'_>> {
        self.raw_request_game_versions().map(|versions| ApiGameVersions {
            _api: self,
            versions,
        })
    }

    fn raw_request_game_versions(&self) -> Result<Vec<serde::Game>> {
        crate::tokio::sync(async move {
            crate::http::client()?
                .get(format!("{}/versions/game", self.base_url))
                .header(reqwest::header::ACCEPT, "application/json")
                .send().await?
                .error_for_status()?
                .json::<Vec<serde::Game>>().await
        }).map_err(|e| {
            Error::from(base::Error::new_reqwest(e, "request all game versions"))
        })
    }

    pub fn request_loader_versions(&self, game_version: Option<&str>) -> Result<ApiLoaderVersions<'_>> {
        if let Some(game_version) = game_version {
            self.raw_request_game_loader_versions(game_version).map(|versions| ApiLoaderVersions {
                _api: self,
                versions: versions.into_iter().map(|v| v.loader).collect(),
            })
        } else {
            self.raw_request_loader_versions().map(|versions| ApiLoaderVersions {
                _api: self,
                versions,
            })
        }
    }

    fn raw_request_loader_versions(&self) -> Result<Vec<serde::Loader>> {
        crate::tokio::sync(async move {
            crate::http::client()?
                .get(format!("{}/versions/loader", self.base_url))
                .header(reqwest::header::ACCEPT, "application/json")
                .send().await?
                .error_for_status()?
                .json::<Vec<serde::Loader>>().await
        }).map_err(|e| {
            Error::from(base::Error::new_reqwest(e, "request all loader versions"))
        })
    }

    fn raw_request_game_loader_versions(&self, game_version: &str) -> Result<Vec<serde::GameLoader>> {
        
        let ret = crate::tokio::sync(async move {
            crate::http::client()?
                .get(format!("{}/versions/loader/{game_version}", self.base_url))
                .header(reqwest::header::ACCEPT, "application/json")
                .send().await?
                .error_for_status()?
                .json::<Vec<serde::GameLoader>>().await
        });

        if let Err(e) = &ret && let Some(StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST) = e.status() {
            return Ok(Vec::new());
        }
        
        ret.map_err(|e| {
            Error::from(base::Error::new_reqwest(e, format!("request loader versions for game {}", game_version)))
        })

    }

    fn raw_request_has_game_loader_versions(&self, game_version: &str) -> Result<bool> {
        
        let ret = crate::tokio::sync(async move {
            crate::http::client()?
                .get(format!("{}/versions/loader/{game_version}", self.base_url))
                .header(reqwest::header::ACCEPT, "application/json")
                .send().await?
                .error_for_status()?
                .bytes().await
                .map(|bytes| &*bytes != b"[]") 
        });

        if let Err(e) = &ret && let Some(StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST) = e.status() {
            return Ok(false);
        }

        ret.map_err(|e| {
            Error::from(base::Error::new_reqwest(e, format!("request if there are loader versions for game {game_version}")))
        })

    }

    fn raw_request_game_loader_version_metadata(&self, game_version: &str, loader_version: &str) -> Result<Option<base::serde::VersionMetadata>> {
        
        let ret = crate::tokio::sync(async move {
            crate::http::client()?
                .get(format!("{}/versions/loader/{game_version}/{loader_version}/profile/json", self.base_url))
                .header(reqwest::header::ACCEPT, "application/json")
                .send().await?
                .error_for_status()?
                .json::<base::serde::VersionMetadata>().await
        });

        if let Err(e) = &ret && let Some(StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST) = e.status() {
            return Ok(None);
        }

        ret.map(Some).map_err(|e| {
            Error::from(base::Error::new_reqwest(e, format!("request version metadata for game {game_version} and loader {loader_version}")))
        })

    }

}

#[derive(Debug)]
pub struct ApiGameVersions<'a> {
    _api: &'a Api,
    versions: Vec<serde::Game>,
}

impl ApiGameVersions<'_> {

    pub fn iter(&self) -> impl Iterator<Item = ApiGameVersion<'_>> + use<'_> {
        self.versions.iter().map(|inner| ApiGameVersion { inner })
    }

    pub fn find_latest(&self, stable: bool) -> Option<ApiGameVersion<'_>> {
        self.iter().find(|v| !stable || v.is_stable())
    }

}

#[derive(Debug)]
pub struct ApiGameVersion<'d> {
    inner: &'d serde::Game,
}

impl<'d> ApiGameVersion<'d> {

    #[inline]
    pub fn name(&self) -> &'d str {
        &self.inner.version
    }

    #[inline]
    pub fn is_stable(&self) -> bool {
        self.inner.stable
    }

}

#[derive(Debug)]
pub struct ApiLoaderVersions<'a> {
    _api: &'a Api,
    versions: Vec<serde::Loader>,
}

impl ApiLoaderVersions<'_> {

    pub fn iter(&self) -> impl Iterator<Item = ApiLoaderVersion<'_>> + use<'_> {
        self.versions.iter().map(|inner| ApiLoaderVersion { inner })
    }

    pub fn find_latest(&self, stable: bool) -> Option<ApiLoaderVersion<'_>> {
        self.iter().find(|v| !stable || v.is_stable())
    }

}

#[derive(Debug)]
pub struct ApiLoaderVersion<'d> {
    inner: &'d serde::Loader,
}

impl<'d> ApiLoaderVersion<'d> {

    #[inline]
    pub fn name(&self) -> &'d str {
        &self.inner.version
    }

    #[inline]
    pub fn is_stable(&self) -> bool {
        self.inner.stable.unwrap_or_else(|| {
            !self.inner.version.contains("-beta") && !self.inner.version.contains("-pre")
        })
    }

}


struct InternalHandler<'a> {
    inner: &'a mut dyn Handler,
    error: Result<()>,
    api: Api,
    root_version: &'a str,
    game_version: &'a str,
    loader_version: &'a str,
}

impl moj::Handler for InternalHandler<'_> {

    fn on_event(&mut self, mut event: moj::Event) {

        let ret = match event {
            moj::Event::Base(base::Event::NeedVersion { 
                version, 
                file, 
                ref mut retry, 
            }) => {
                match self.inner_need_version(version, file) {
                    Ok(true) => {
                        **retry = true;
                        Ok(())
                    }
                    Ok(false) => Ok(()),
                    Err(e) => Err(e),
                }
            }
            _ => Ok(())
        };

        if let Err(e) = ret {
            self.error = Err(e);
            return;
        }

        self.inner.on_event(Event::Mojang(event));

    }

    fn cancelled(&self) -> bool {
        self.inner.cancelled()
    }

}

impl InternalHandler<'_> {

    fn inner_need_version(&mut self, version: &str, file: &Path) -> Result<bool> {

        if version != self.root_version {
            return Ok(false);
        }

        self.inner.on_event(Event::FetchVersion { 
            game_version: self.game_version, 
            loader_version: self.loader_version,
        });

        let mut metadata = match self.api.raw_request_game_loader_version_metadata(self.game_version, self.loader_version)? {
            Some(metadata) => metadata,
            None => {
                if self.api.raw_request_has_game_loader_versions(self.game_version)? {
                    return Err(Error::LoaderVersionNotFound { 
                        game_version: self.game_version.to_string(),
                        loader_version: self.loader_version.to_string(),
                    });
                } else {
                    return Err(Error::GameVersionNotFound { 
                        game_version: self.game_version.to_string(),
                    });
                }
            }
        };

        metadata.id = version.to_string();
        base::write_version_metadata(file, &metadata)?;

        self.inner.on_event(Event::FetchedVersion { 
            game_version: self.game_version, 
            loader_version: self.loader_version,
        });

        Ok(true)

    }
    
}
