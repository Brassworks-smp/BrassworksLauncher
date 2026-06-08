
use std::path::PathBuf;
use std::process::Child;

use portablemc::base::{Event as BaseEvent, JvmPolicy};
use portablemc::forge::{self, Event as ForgeEvent, Loader, Version as ForgeVersion};
use portablemc::moj::{self, Event as MojEvent};
use portablemc::msa;
use packwiz::{SyncProgress, SyncStage};
use uuid::Uuid;

use crate::account::{Account, AccountKind};
use crate::error::{CoreError, Result};
use crate::instance::{Instance, LoaderKind, LoaderVersion};
use crate::modpack::Modpack;
use crate::paths::Paths;
use crate::progress::{LaunchProgress, LaunchStage, ProgressSink};
use crate::settings::LauncherSettings;

pub struct LaunchRequest<'a> {
    pub paths: &'a Paths,
    pub instance: &'a Instance,
    pub account: &'a Account,
    pub settings: &'a LauncherSettings,
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

fn forge_version(spec: &LoaderVersion, mc_version: &str) -> ForgeVersion {
    match spec {
        LoaderVersion::Stable => ForgeVersion::Stable(mc_version.to_string()),
        LoaderVersion::Unstable => ForgeVersion::Unstable(mc_version.to_string()),
        LoaderVersion::Exact(name) => ForgeVersion::Name(name.clone()),
    }
}

fn configure_mojang(req: &LaunchRequest, mojang: &mut moj::Installer) -> Result<()> {
    let base = mojang.base_mut();

    base.set_main_dir(req.paths.shared_dir());
    base.set_mc_dir(req.paths.instance_game_dir(&req.instance.id));

    base.set_launcher_name("BrassworksLauncher");
    base.set_launcher_version(env!("CARGO_PKG_VERSION"));

    let java = req
        .instance
        .java_path
        .as_deref()
        .or(req.settings.java_path.as_deref());
    match java {
        Some(path) => {
            base.set_jvm_policy(JvmPolicy::Static(PathBuf::from(path)));
        }
        None => {
            base.set_jvm_policy(JvmPolicy::SystemThenMojang);
        }
    }

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

    if let Some((w, h)) = req.instance.resolution {
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

    let neoforge_override = sync_modpack(&req, &instance_id, cancel, on_progress)?;

    let mut handler = ProgressHandler {
        instance_id: instance_id.clone(),
        sink: on_progress,
    };

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
            configure_mojang(&req, installer.mojang_mut())?;
            installer
                .install(&mut handler)
                .map_err(|e| CoreError::Launch(format!("{e:?}")))?
        }
        LoaderKind::Vanilla => {
            let mut installer = moj::Installer::new(req.instance.minecraft_version.clone());
            configure_mojang(&req, &mut installer)?;
            installer
                .install(MojOnly(&mut handler))
                .map_err(|e| CoreError::Launch(format!("{e:?}")))?
        }
        LoaderKind::Fabric => {
            return Err(CoreError::Launch(
                "Fabric is not supported yet".to_string(),
            ));
        }
    };

    handler.stage(LaunchStage::Launching, "Starting Minecraft");

    let mut jvm = jvm_args(&req);
    jvm.extend(game.jvm_args.drain(..));
    game.jvm_args = jvm;

    let child = game.command().spawn().map_err(|e| {
        CoreError::Launch(format!("failed to spawn game process: {e}"))
    })?;

    handler.stage(LaunchStage::Running, "Minecraft is running");
    Ok(child)
}

fn sync_modpack(
    req: &LaunchRequest,
    instance_id: &str,
    cancel: &dyn Fn() -> bool,
    on_progress: &mut ProgressSink,
) -> Result<Option<String>> {
    let pack_url = crate::modpack::resolve_pack_url(req.settings);
    let modpack = Modpack::with_url(req.paths, instance_id, pack_url);

    if !req.settings.modpack_locked {
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
