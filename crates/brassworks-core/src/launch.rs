
use std::path::PathBuf;
use std::process::Child;

use portablemc::base::{Event as BaseEvent, JvmPolicy};
use portablemc::fabric::{self, Event as FabricEvent};
use portablemc::forge::{self, Event as ForgeEvent, Loader, Version as ForgeVersion};
use portablemc::moj::{self, Event as MojEvent};
use portablemc::msa;
use packwiz::{SyncProgress, SyncStage};
use uuid::Uuid;

use crate::account::{Account, AccountKind};
use crate::error::{CoreError, Result};
use crate::instance::{Instance, LoaderKind, LoaderVersion, PackSource};
use crate::modpack::Modpack;
use crate::paths::Paths;
use crate::progress::{LaunchProgress, LaunchStage, ProgressSink};
use crate::settings::LauncherSettings;

pub struct LaunchRequest<'a> {
    pub paths: &'a Paths,
    pub instance: &'a Instance,
    pub account: &'a Account,
    pub settings: &'a LauncherSettings,
    pub quick_play: Option<QuickPlay>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QuickPlay {
    Server { ip: String },
    World { folder: String },
}

struct ProgressHandler<'a> {
    instance_id: String,
    sink: &'a mut ProgressSink,
}

impl ProgressHandler<'_> {
    fn emit(&mut self, progress: LaunchProgress) {
        (self.sink)(progress);
    }

    fn stage(&mut self, stage: LaunchStage, message: impl Into<String>) {
        let p = LaunchProgress::new(&self.instance_id, stage, message);
        self.emit(p);
    }

    fn handle_base(&mut self, event: &BaseEvent) {
        match event {
            BaseEvent::LoadHierarchy { root_version } => {
                self.stage(LaunchStage::LoadingVersion, format!("Loading {root_version}"));
            }
            BaseEvent::LoadLibraries => {
                self.stage(LaunchStage::Downloading, "Resolving libraries");
            }
            BaseEvent::LoadAssets { .. } => {
                self.stage(LaunchStage::Downloading, "Resolving assets");
            }
            BaseEvent::LoadJvm { major_version } => {
                self.stage(
                    LaunchStage::PreparingJvm,
                    format!("Preparing Java {major_version}"),
                );
            }
            BaseEvent::DownloadProgress {
                count,
                total_count,
                size,
                total_size,
            } => {
                let (cur, tot) = if *total_size > 0 {
                    (*size as u64, *total_size as u64)
                } else {
                    (*count as u64, *total_count as u64)
                };
                let p = LaunchProgress::new(
                    &self.instance_id,
                    LaunchStage::Downloading,
                    format!("Downloading {count}/{total_count} files"),
                )
                .with_progress(cur, tot);
                self.emit(p);
            }
            BaseEvent::ExtractedBinaries { .. } => {
                self.stage(LaunchStage::PreparingJvm, "Extracted native binaries");
            }
            _ => {}
        }
    }

    fn handle_moj(&mut self, event: &MojEvent) {
        match event {
            MojEvent::Base(base) => self.handle_base(base),
            MojEvent::FetchVersion { version } => {
                self.stage(LaunchStage::LoadingVersion, format!("Fetching {version}"));
            }
            _ => {}
        }
    }
}

impl forge::Handler for ProgressHandler<'_> {
    fn on_event(&mut self, event: ForgeEvent) {
        match event {
            ForgeEvent::Mojang(moj) => self.handle_moj(&moj),
            ForgeEvent::FetchInstaller { version } => {
                self.stage(
                    LaunchStage::InstallingLoader,
                    format!("Fetching NeoForge installer {version}"),
                );
            }
            ForgeEvent::Installing { .. } => {
                self.stage(LaunchStage::InstallingLoader, "Installing mod loader");
            }
            ForgeEvent::InstallingGame => {
                self.stage(LaunchStage::InstallingLoader, "Installing base game");
            }
            ForgeEvent::FetchInstallerLibraries => {
                self.stage(LaunchStage::InstallingLoader, "Fetching loader libraries");
            }
            ForgeEvent::RunInstallerProcessor { name, .. } => {
                self.stage(
                    LaunchStage::InstallingLoader,
                    format!("Running processor {name}"),
                );
            }
            ForgeEvent::Installed => {
                self.stage(LaunchStage::InstallingLoader, "Mod loader installed");
            }
            _ => {}
        }
    }
}

impl fabric::Handler for ProgressHandler<'_> {
    fn on_event(&mut self, event: FabricEvent) {
        match event {
            FabricEvent::Mojang(moj) => self.handle_moj(&moj),
            FabricEvent::FetchVersion {
                game_version,
                loader_version,
            } => {
                self.stage(
                    LaunchStage::InstallingLoader,
                    format!("Fetching loader {loader_version} for {game_version}"),
                );
            }
            _ => {}
        }
    }
}

fn forge_version(spec: &LoaderVersion, mc_version: &str) -> ForgeVersion {
    match spec {
        LoaderVersion::Stable => ForgeVersion::Stable(mc_version.to_string()),
        LoaderVersion::Unstable => ForgeVersion::Unstable(mc_version.to_string()),
        LoaderVersion::Exact(name) => ForgeVersion::Name(name.clone()),
    }
}

fn fabric_loader_version(spec: &LoaderVersion) -> fabric::LoaderVersion {
    match spec {
        LoaderVersion::Stable => fabric::LoaderVersion::Stable,
        LoaderVersion::Unstable => fabric::LoaderVersion::Unstable,
        LoaderVersion::Exact(name) => fabric::LoaderVersion::Name(name.clone()),
    }
}

fn configure_mojang(
    req: &LaunchRequest,
    mojang: &mut moj::Installer,
    java_override: Option<&PathBuf>,
) -> Result<()> {
    let base = mojang.base_mut();

    base.set_main_dir(req.paths.shared_dir());
    base.set_mc_dir(req.paths.instance_game_dir(&req.instance.id));
    base.set_jvm_dir(req.paths.jvm_dir());

    base.set_launcher_name("BrassworksLauncher");
    base.set_launcher_version(env!("CARGO_PKG_VERSION"));

    let policy = match req.instance.java_path.as_deref() {
        Some(path) if !path.trim().is_empty() => JvmPolicy::Static(PathBuf::from(path)),
        _ => {
            let effective = req
                .instance
                .java_policy
                .as_deref()
                .filter(|p| !p.trim().is_empty())
                .unwrap_or(req.settings.java_policy.as_str());
            match effective {
                "system" => JvmPolicy::System,
                "custom" => match req.settings.java_path.as_deref() {
                    Some(path) if !path.trim().is_empty() => {
                        JvmPolicy::Static(PathBuf::from(path))
                    }
                    _ => match java_override {
                        Some(p) => JvmPolicy::Static(p.clone()),
                        None => JvmPolicy::MojangThenSystem,
                    },
                },
                _ => match java_override {
                    Some(p) => JvmPolicy::Static(p.clone()),
                    None => JvmPolicy::MojangThenSystem,
                },
            }
        }
    };
    base.set_jvm_policy(policy);

    match req.account.kind {
        AccountKind::Offline => {
            mojang.set_auth_offline_username(req.account.username.clone());
        }
        AccountKind::Microsoft => {
            let db = msa::Database::new(req.paths.msa_db_file());
            let uuid = Uuid::parse_str(&req.account.uuid)
                .map_err(|e| CoreError::Auth(format!("invalid account uuid: {e}")))?;
            let mut account = db
                .load_from_uuid(uuid)
                .map_err(|e| CoreError::Auth(format!("{e:?}")))?
                .ok_or_else(|| {
                    CoreError::Auth(
                        "Microsoft session not found — please sign in again".to_string(),
                    )
                })?;
            account
                .request_refresh()
                .map_err(|e| CoreError::Auth(format!("session expired, sign in again ({e:?})")))?;
            let _ = db.store(account.clone());
            mojang.set_auth_msa(&account);
        }
    }

    if let Some((w, h)) = req.instance.resolution.or(req.settings.default_resolution) {
        mojang.set_resolution(w, h);
    }

    Ok(())
}

fn jvm_args(req: &LaunchRequest) -> Vec<String> {
    let max = req
        .instance
        .max_memory_mb
        .unwrap_or(req.settings.default_max_memory_mb);
    let min = req
        .instance
        .min_memory_mb
        .unwrap_or(req.settings.default_min_memory_mb);

    let mut args = vec![format!("-Xmx{max}M"), format!("-Xms{min}M")];
    args.push("-Dbrassupdater.skip=true".to_string());
    args.extend(req.instance.extra_jvm_args.iter().cloned());
    args
}

pub fn launch_instance(
    req: LaunchRequest<'_>,
    cancel: &dyn Fn() -> bool,
    on_progress: &mut ProgressSink,
) -> Result<Child> {
    req.paths.ensure_base()?;

    let instance_id = req.instance.id.clone();

    let neoforge_override = match &req.instance.pack {
        PackSource::Packwiz { url } => {
            sync_packwiz(&req, &instance_id, url, cancel, on_progress)?
        }
        PackSource::Modrinth { .. } | PackSource::Curseforge { .. } => {
            if req.instance.modpack_locked {
                sync_thirdparty(&req, &instance_id, cancel, on_progress)?;
            }
            None
        }
        PackSource::None => None,
    };

    let mut handler = ProgressHandler {
        instance_id: instance_id.clone(),
        sink: on_progress,
    };

    let java_override = resolve_java(&req, &mut handler);
    let java_override = java_override.as_ref();

    handler.stage(LaunchStage::Resolving, "Resolving loader version");

    let mut game = match req.instance.loader {
        LoaderKind::NeoForge | LoaderKind::Forge => {
            let loader = if req.instance.loader == LoaderKind::NeoForge {
                Loader::NeoForge
            } else {
                Loader::Forge
            };
            let version = match (req.instance.loader, &neoforge_override) {
                (LoaderKind::NeoForge, Some(nf)) => ForgeVersion::Name(nf.clone()),
                _ => forge_version(&req.instance.loader_version, &req.instance.minecraft_version),
            };
            let mut installer = forge::Installer::new(loader, version);
            configure_mojang(&req, installer.mojang_mut(), java_override)?;
            installer
                .install(&mut handler)
                .map_err(|e| CoreError::Launch(format!("{e:?}")))?
        }
        LoaderKind::Vanilla => {
            let mut installer = moj::Installer::new(req.instance.minecraft_version.clone());
            configure_mojang(&req, &mut installer, java_override)?;
            installer
                .install(MojOnly(&mut handler))
                .map_err(|e| CoreError::Launch(format!("{e:?}")))?
        }
        LoaderKind::Fabric | LoaderKind::Quilt => {
            let loader = if req.instance.loader == LoaderKind::Fabric {
                fabric::Loader::Fabric
            } else {
                fabric::Loader::Quilt
            };
            let mut installer = fabric::Installer::new(
                loader,
                req.instance.minecraft_version.clone(),
                fabric_loader_version(&req.instance.loader_version),
            );
            configure_mojang(&req, installer.mojang_mut(), java_override)?;
            installer
                .install(&mut handler)
                .map_err(|e| CoreError::Launch(format!("{e:?}")))?
        }
    };

    handler.stage(LaunchStage::Launching, "Starting Minecraft");

    if let Some(qp) = &req.quick_play {
        match qp {
            QuickPlay::Server { ip } => game
                .game_args
                .extend(["--quickPlayMultiplayer".to_string(), ip.clone()]),
            QuickPlay::World { folder } => game
                .game_args
                .extend(["--quickPlaySingleplayer".to_string(), folder.clone()]),
        }
    }

    let mut jvm = jvm_args(&req);
    jvm.extend(game.jvm_args.drain(..));
    game.jvm_args = jvm;

    let child = game.command().spawn().map_err(|e| {
        CoreError::Launch(format!("failed to spawn game process: {e}"))
    })?;

    handler.stage(LaunchStage::Running, "Minecraft is running");
    Ok(child)
}

fn resolve_java(req: &LaunchRequest, handler: &mut ProgressHandler) -> Option<PathBuf> {
    if req
        .instance
        .java_path
        .as_deref()
        .map(|p| !p.trim().is_empty())
        .unwrap_or(false)
    {
        return None;
    }
    let effective = req
        .instance
        .java_policy
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .unwrap_or(req.settings.java_policy.as_str());
    if effective != "auto" {
        return None;
    }
    let major = required_java_major(&req.instance.minecraft_version);
    handler.stage(LaunchStage::PreparingJvm, format!("Preparing Java {major}"));
    java::ensure_runtime(&req.paths.jvm_dir(), major).ok()
}

fn required_java_major(mc_version: &str) -> u32 {
    fetch_required_major(mc_version).unwrap_or_else(|| java::major_for_minecraft(mc_version))
}

fn fetch_required_major(mc_version: &str) -> Option<u32> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .ok()?;
    let manifest: serde_json::Value = client
        .get("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .ok()?
        .json()
        .ok()?;
    let url = manifest
        .get("versions")?
        .as_array()?
        .iter()
        .find(|v| v.get("id").and_then(|i| i.as_str()) == Some(mc_version))?
        .get("url")?
        .as_str()?
        .to_string();
    let version: serde_json::Value = client.get(&url).send().ok()?.json().ok()?;
    version
        .get("javaVersion")?
        .get("majorVersion")?
        .as_u64()
        .map(|n| n as u32)
}

fn sync_thirdparty(
    req: &LaunchRequest,
    instance_id: &str,
    cancel: &dyn Fn() -> bool,
    on_progress: &mut ProgressSink,
) -> Result<()> {
    use packwiz::Installer;

    let installer = Installer::new();
    let modrinth = installer.modrinth(req.paths.modrinth_cache_dir());
    let cf_key = req
        .settings
        .curseforge_api_key
        .clone()
        .filter(|k| !k.trim().is_empty())
        .unwrap_or_else(|| crate::modpack::DEFAULT_CURSEFORGE_API_KEY.to_string());
    let cf = installer.curseforge(req.paths.curseforge_cache_dir(), cf_key);

    let mut sink = |sp: packwiz::SyncProgress| {
        let stage = match sp.stage {
            packwiz::SyncStage::Fetching => LaunchStage::CheckingUpdates,
            _ => LaunchStage::SyncingModpack,
        };
        let mut p = LaunchProgress::new(instance_id, stage, sp.message);
        if sp.total > 0 {
            p = p.with_progress(sp.current, sp.total);
        }
        (on_progress)(p);
    };

    crate::packs::sync_pack(
        req.paths,
        instance_id,
        &req.instance.pack,
        &modrinth,
        Some(&cf),
        cancel,
        &mut sink,
    )?;
    Ok(())
}

fn sync_packwiz(
    req: &LaunchRequest,
    instance_id: &str,
    pack_url: &str,
    cancel: &dyn Fn() -> bool,
    on_progress: &mut ProgressSink,
) -> Result<Option<String>> {
    let modpack = Modpack::with_url(req.paths, instance_id, pack_url.to_string());

    if !req.instance.modpack_locked {
        if let Some(neoforge) = modpack.installed_neoforge() {
            (on_progress)(LaunchProgress::new(
                instance_id,
                LaunchStage::CheckingUpdates,
                "Modpack unlocked — skipping auto-update",
            ));
            return Ok(Some(neoforge));
        }
    }

    (on_progress)(LaunchProgress::new(
        instance_id,
        LaunchStage::CheckingUpdates,
        "Checking for modpack updates",
    ));

    let manifest = modpack.sync(false, cancel, &mut |sp: SyncProgress| {
        let stage = match sp.stage {
            SyncStage::Fetching => LaunchStage::CheckingUpdates,
            _ => LaunchStage::SyncingModpack,
        };
        let mut p = LaunchProgress::new(instance_id, stage, sp.message);
        if sp.total > 0 {
            p = p.with_progress(sp.current, sp.total);
        }
        (on_progress)(p);
    })?;

    Ok(manifest.neoforge_version)
}

struct MojOnly<'a, 'b>(&'a mut ProgressHandler<'b>);

impl moj::Handler for MojOnly<'_, '_> {
    fn on_event(&mut self, event: MojEvent) {
        self.0.handle_moj(&event);
    }
}
