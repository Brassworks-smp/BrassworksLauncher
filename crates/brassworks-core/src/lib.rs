//! # brassworks-core
//!
//! The main crate for the Brassworks Launcher. Most of the actual launcher
//! logic lives in here instead of the UI.
//!
//! This crate handles things like storing launcher data on disk, managing
//! accounts and settings, and launching Minecraft through the `portablemc`
//! crate.
//!
//! The desktop app mostly just calls functions from this crate, so if you're
//! looking for where stuff actually happens, this is probably the place.

pub mod account;
pub mod auth;
pub mod error;
pub mod export;
pub mod featured;
pub mod forge;
pub mod image_cache;
pub mod import;
pub mod instance;
pub mod launch;
pub mod modpack;
pub mod modrinth_plays;
pub mod packs;
pub mod packwiz_share;
pub mod paths;
pub mod ping;
pub mod progress;
pub mod remote;
pub mod saves;
pub mod settings;
pub mod skins;
pub mod stars;
pub mod versions;

use std::process::Child;

pub use account::{Account, AccountKind, AccountStatus, AccountStore};
pub use auth::MicrosoftCode;
pub use error::{CoreError, Result};
pub use featured::{featured_packs, FeaturedPack};
pub use import::ImportCandidate;
pub use instance::{Instance, InstanceManager, LoaderKind, LoaderVersion, PackSource};
pub use launch::{launch_instance, LaunchRequest, QuickPlay};
pub use modpack::{
    ContentVersion, InstallResult, InstalledMod, ModInfo, Modpack, ModpackStatus, ProjectDetail,
};
pub use packwiz::{
    FilterCategory, FilterOptions, FlavorChoice, FlavorGroup, PackwizBranch, SearchFilters,
    SearchHit,
};
pub use packwiz_share::{PackInstallMeta, PackwizShare};
pub use paths::Paths;

pub const PACK_SETTINGS_DIFF_PATH: &str = "__pack_settings__";

#[derive(serde::Serialize, serde::Deserialize)]
struct SharedConfigFile {
    #[serde(flatten)]
    config: export::ExportConfig,
    #[serde(default)]
    params: instance::SharePackParams,
}

fn apply_shared_params(inst: &mut instance::Instance, p: &instance::SharePackParams) {
    if inst.notes.is_none() {
        inst.notes = p.description.clone().filter(|d| !d.trim().is_empty());
    }
    if inst.min_memory_mb.is_none() {
        inst.min_memory_mb = p.min_memory_mb;
    }
    if inst.max_memory_mb.is_none() {
        inst.max_memory_mb = p.max_memory_mb;
    }
    if inst.extra_jvm_args.is_empty() {
        let args: Vec<String> = p
            .jvm_args
            .iter()
            .filter(|a| !a.trim().is_empty())
            .cloned()
            .collect();
        if !args.is_empty() {
            inst.extra_jvm_args = args;
        }
    }
    if inst.news_url.is_none() {
        inst.news_url = p.news_url.clone().filter(|u| !u.trim().is_empty());
        inst.show_news = inst.news_url.is_some();
    }
    if inst.playercount_url.is_none() {
        inst.playercount_url = p.playercount_url.clone().filter(|u| !u.trim().is_empty());
        inst.show_playercount = inst.playercount_url.is_some();
    }
}

fn newest_mtime(dir: &std::path::Path) -> Option<std::time::SystemTime> {
    let mut newest: Option<std::time::SystemTime> = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(p) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&p) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    stack.push(path);
                } else if let Ok(modified) = meta.modified() {
                    if newest.map(|n| modified > n).unwrap_or(true) {
                        newest = Some(modified);
                    }
                }
            }
        }
    }
    newest
}

pub const SHARE_INSTALL_BASE: &str = "https://brassworks.opnsoc.org/install";

#[derive(Debug, Clone, serde::Serialize)]
pub struct ShareRepoInfo {
    pub size_kb: u64,
    pub pushed_at: Option<String>,
    pub html_url: String,
    pub default_branch: String,
    pub private: bool,
    pub stargazers: u64,
    pub forks: u64,
    pub file_count: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ShareDiffEntry {
    pub path: String,
    pub status: String,
}

fn install_link(s: &PackwizShare) -> Result<String> {
    let mut url = reqwest::Url::parse(SHARE_INSTALL_BASE)
        .map_err(|e| CoreError::Modpack(e.to_string()))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("pack_url", &s.pack_url);
        if let Some(n) = &s.name {
            q.append_pair("name", n);
        }
        q.append_pair("unsup", if s.unsup { "true" } else { "false" });
        if let Some(by) = &s.shared_by {
            q.append_pair("shared_by", by);
        }
        if let Some(k) = &s.signing_key {
            q.append_pair("signing_key", k);
        }
        if let Some(i) = &s.icon {
            q.append_pair("icon", i);
        }
        if let Some(d) = &s.description {
            q.append_pair("description", d);
        }
        if let Some(n) = &s.news_url {
            q.append_pair("news_url", n);
        }
        if let Some(p) = &s.playercount_url {
            q.append_pair("playercount_url", p);
        }
        if let Some(m) = s.min_memory_mb {
            q.append_pair("min_memory_mb", &m.to_string());
        }
        if let Some(m) = s.max_memory_mb {
            q.append_pair("max_memory_mb", &m.to_string());
        }
        if let Some(args) = &s.jvm_args {
            if !args.is_empty() {
                q.append_pair("jvm_args", &args.join(" "));
            }
        }
    }
    Ok(url.to_string())
}

#[allow(clippy::too_many_arguments)]
fn share_readme(
    instance: &instance::Instance,
    repo_url: &str,
    pack_url: &str,
    branch: &str,
    has_icon: bool,
    shared_by: Option<&str>,
    install_link: &str,
) -> String {
    let name = &instance.name;
    let loader = instance.loader.label();
    let mc = &instance.minecraft_version;
    let icon = if has_icon {
        format!(
            "<p align=\"center\">\n  \
            <img src=\"./icon.png\" width=\"96\" height=\"96\" alt=\"{name} icon\" />\n\
            </p>\n\n"
        )
    } else {
        String::new()
    };
    let by_line = match shared_by {
        Some(u) => format!(
            "<p align=\"center\">\n  \
            Put together and shared by <strong>{u}</strong>.\n\
            </p>\n\n"
        ),
        None => String::new(),
    };
    format!(
        "{icon}\
        <h1 align=\"center\">{name}</h1>\n\n\
        <p align=\"center\">\n  \
        A <strong>{loader} {mc}</strong> Minecraft modpack, shared with the\n  \
        <a href=\"https://github.com/brassworks-smp\">Brassworks Launcher</a>.\n\
        </p>\n\n\
        {by_line}\
        ## Play this pack\n\n\
        The quickest way is one click: open [this install link]({install_link}) and Brassworks \
        sets everything up for you, then keeps it up to date on its own.\n\n\
        Rather do it by hand? Install the \
        [Brassworks Launcher](https://github.com/brassworks-smp), choose **Add Instance**, pick \
        **packwiz**, and paste in this manifest URL:\n\n\
        > {pack_url}\n\n\
        ## About this pack\n\n\
        | | |\n\
        |---|---|\n\
        | Minecraft | `{mc}` |\n\
        | Loader | `{loader}` |\n\
        | Shared by | {shared} |\n\
        | Pack manifest | [`pack.toml`](./pack.toml) |\n\
        | Branch | `{branch}` |\n\n\
        ---\n\n\
        This repository is kept up to date automatically by the Brassworks Launcher, so anything \
        you change here by hand may be overwritten the next time the author publishes an update.\n\n\
        [Browse the repository]({repo_url}) · [Get the Brassworks Launcher](https://github.com/brassworks-smp)\n",
        shared = shared_by.unwrap_or("the pack author"),
    )
}

/// The version a local build should carry to match what is currently published.
/// Using the published version (rather than the on-disk export config version,
/// which the share editor keeps resetting) keeps `pack.toml` — and therefore the
/// `unsup.sig` signed over it — byte-identical to the published copy, so an
/// unchanged pack does not show up as a perpetual diff.
fn shared_build_version(share: &instance::PackShare, config: &export::ExportConfig) -> String {
    share
        .published_version
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| {
            if config.version.trim().is_empty() {
                "1.0.0".to_string()
            } else {
                config.version.clone()
            }
        })
}

/// Bump a pack version by one patch level so the auto-updater treats a publish
/// as a new release. Falls back to a sensible default for non-semver inputs.
fn bump_pack_version(prev: &str) -> String {
    let prev = prev.trim();
    let mut parts = prev.split('.');
    let major = parts.next().and_then(|p| p.parse::<u64>().ok());
    let minor = parts.next().and_then(|p| p.parse::<u64>().ok());
    let patch = parts.next().and_then(|p| p.parse::<u64>().ok());
    match (major, minor, patch) {
        (Some(major), Some(minor), Some(patch)) => format!("{major}.{minor}.{}", patch + 1),
        _ => "1.0.1".to_string(),
    }
}

pub use ping::ServerStatus;
pub use saves::{DatapackInfo, ServerEntry, WorldBackup, WorldInfo};
pub use stars::StarKind;
pub use progress::{LaunchProgress, LaunchStage, ProgressSink};
pub use remote::{
    news, player_count, release_changelog, upload_log, LogUpload, NewsItem, PlayerCount,
    PlayerGroup,
};
pub use versions::{
    loader_versions, minecraft_versions, supported_loaders, LoaderVersionInfo, McVersion,
};
pub use skins::{Cape, SavedSkin, SkinLibraryView, SkinProfile};
pub use settings::{InstanceFolder, LauncherSettings};

pub use java::{JavaInstall, JavaKind};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JavaReport {
    pub system: Option<JavaInstall>,
    pub runtimes: Vec<JavaInstall>,
    pub required_major: u32,
    pub policy: String,
    pub custom_path: Option<String>,
}

use packwiz::{SyncProgress, SyncStage};

use portablemc::msa::{self, Auth};

#[derive(Debug, Clone)]
pub struct Launcher {
    paths: Paths,
    session_forge_tokens:
        std::sync::Arc<std::sync::Mutex<std::collections::BTreeMap<String, String>>>,
}

impl Launcher {
    pub fn new() -> Result<Self> {
        let paths = Paths::default()?;
        paths.ensure_base()?;
        Ok(Self {
            paths,
            session_forge_tokens: Default::default(),
        })
    }

    pub fn with_root(root: impl Into<std::path::PathBuf>) -> Result<Self> {
        let paths = Paths::with_root(root);
        paths.ensure_base()?;
        Ok(Self {
            paths,
            session_forge_tokens: Default::default(),
        })
    }

    pub fn paths(&self) -> &Paths {
        &self.paths
    }

    pub fn instances(&self) -> InstanceManager {
        InstanceManager::new(self.paths.clone())
    }

    pub fn bootstrap(&self) -> Result<()> {
        self.instances().ensure_featured()
    }


    pub fn settings(&self) -> Result<LauncherSettings> {
        read_json_or_default(&self.paths.settings_file(), "settings")
    }

    pub fn save_settings(&self, settings: &LauncherSettings) -> Result<()> {
        write_json(&self.paths.settings_file(), settings, "settings")
    }


    pub fn accounts(&self) -> Result<AccountStore> {
        let mut store: AccountStore =
            read_json_or_default(&self.paths.accounts_file(), "accounts")?;
        for account in &mut store.accounts {
            account.normalize();
        }
        Ok(store)
    }

    pub fn save_accounts(&self, store: &AccountStore) -> Result<()> {
        write_json(&self.paths.accounts_file(), store, "accounts")
    }

    pub fn add_offline_account(&self, username: impl Into<String>) -> Result<AccountStore> {
        let mut store = self.accounts()?;
        store.upsert(Account::offline(username));
        self.save_accounts(&store)?;
        Ok(store)
    }

    pub fn select_account(&self, id: &str) -> Result<AccountStore> {
        let mut store = self.accounts()?;
        if store.accounts.iter().any(|a| a.id == id) {
            store.selected = Some(id.to_string());
            self.save_accounts(&store)?;
        }
        Ok(store)
    }

    pub fn remove_account(&self, id: &str) -> Result<AccountStore> {
        let mut store = self.accounts()?;
        if let Some(account) = store.accounts.iter().find(|a| a.id == id) {
            if account.is_microsoft() {
                if let Ok(uuid) = uuid::Uuid::parse_str(&account.uuid) {
                    let db = msa::Database::new(self.paths.msa_db_file());
                    let _ = db.remove_from_uuid(uuid);
                }
            }
        }
        store.remove(id);
        self.save_accounts(&store)?;
        Ok(store)
    }

                        pub fn account_status(&self, account_id: &str) -> AccountStatus {
        let Ok(store) = self.accounts() else {
            return AccountStatus::NeedsRelogin;
        };
        let Some(account) = store.accounts.iter().find(|a| a.id == account_id) else {
            return AccountStatus::NeedsRelogin;
        };
        if !account.is_microsoft() {
            return AccountStatus::Offline;
        }
        let db = msa::Database::new(self.paths.msa_db_file());
        let Ok(uuid) = uuid::Uuid::parse_str(&account.uuid) else {
            return AccountStatus::NeedsRelogin;
        };
        match db.load_from_uuid(uuid) {
            Ok(Some(mut acc)) => match acc.request_refresh() {
                Ok(()) => {
                    let _ = db.store(acc);
                    AccountStatus::Ok
                }
                Err(e) if e.requires_relogin() => AccountStatus::NeedsRelogin,
                Err(_) => AccountStatus::Ok,
            },
            Ok(None) => AccountStatus::NeedsRelogin,
            Err(_) => AccountStatus::Ok,
        }
    }

    pub fn microsoft_login(
        &self,
        on_code: impl FnOnce(MicrosoftCode),
    ) -> Result<Account> {
        let auth = Auth::new(auth::AZURE_APP_ID);
        let flow = auth
            .request_device_code()
            .map_err(|e| CoreError::Auth(format!("{e:?}")))?;

        on_code(MicrosoftCode {
            user_code: flow.user_code().to_string(),
            verification_uri: flow.verification_uri().to_string(),
            message: flow.message().to_string(),
        });

        let mut mc_account = flow
            .wait()
            .map_err(|e| CoreError::Auth(format!("{e:?}")))?;
        let _ = mc_account.request_profile();

        let db = msa::Database::new(self.paths.msa_db_file());
        db.store(mc_account.clone())
            .map_err(|e| CoreError::Auth(format!("{e:?}")))?;

        let account = Account::microsoft(
            mc_account.uuid().to_string(),
            mc_account.username().to_string(),
        );
        let mut store = self.accounts()?;
        store.upsert(account.clone());
        self.save_accounts(&store)?;
        Ok(account)
    }


    pub fn launch(
        &self,
        instance_id: &str,
        quick_play: Option<QuickPlay>,
        cancel: &dyn Fn() -> bool,
        on_progress: &mut ProgressSink,
    ) -> Result<Child> {
                        self.reconcile_packwiz_loader(instance_id);
        let instance = self.instances().get(instance_id)?;
        let accounts = self.accounts()?;
        let account = instance
            .account_override
            .as_deref()
            .and_then(|id| accounts.accounts.iter().find(|a| a.id == id))
            .or_else(|| accounts.active())
            .ok_or(CoreError::NoAccount)?
            .clone();
        let settings = self.settings()?;

        let child = launch_instance(
            LaunchRequest {
                paths: &self.paths,
                instance: &instance,
                account: &account,
                settings: &settings,
                quick_play,
            },
            cancel,
            on_progress,
        )?;

        let mut updated = instance;
        updated.last_played = Some(chrono::Utc::now());
        let _ = self.instances().update(&updated);

        self.report_modrinth_server_play(&updated, &account);

        Ok(child)
    }

    /// Best-effort: if a featured pack carries a `modrinth_server_id`, bump that
    /// Modrinth server's plays counter on launch. Fire-and-forget on a background
    /// thread so it never blocks or fails the launch. Offline accounts are skipped
    /// (the Mojang session handshake needs a real Microsoft account).
    fn report_modrinth_server_play(&self, instance: &Instance, account: &Account) {
        if !instance.featured || !account.is_microsoft() {
            return;
        }
        let Some(project_id) = featured::featured_packs()
            .into_iter()
            .find(|fp| fp.id == instance.id)
            .and_then(|fp| fp.modrinth_server_id)
            .filter(|id| !id.trim().is_empty() && id != "REPLACE_WITH_MODRINTH_SERVER_PROJECT_ID")
        else {
            return;
        };

        // Resolve the access token now (refreshing if needed) while we still hold
        // `&self`, then move owned data into the background thread.
        let Ok(token) = self.with_token(&account.id, |t| Ok(t.to_string())) else {
            return;
        };
        let uuid = account.uuid.clone();
        let username = account.username.clone();
        std::thread::spawn(move || {
            // Best-effort; a failed analytics ping must never surface to the user.
            let _ = modrinth_plays::report_server_play(&token, &uuid, &username, &project_id);
        });
    }


    fn modpack_for(&self, instance_id: &str) -> Modpack<'_> {
        let cf_key = self.cf_key();
        let concurrency = self.concurrency();
        match self.instances().get(instance_id) {
            Ok(instance) => Modpack::for_instance(&self.paths, &instance, Some(cf_key))
                .with_concurrency(concurrency),
            Err(_) => Modpack::with_url(
                &self.paths,
                instance_id,
                modpack::PACK_URL.to_string(),
            )
            .with_curseforge_key(Some(cf_key))
            .with_concurrency(concurrency),
        }
    }

        fn concurrency(&self) -> usize {
        self.settings()
            .ok()
            .map(|s| s.download_concurrency.max(1))
            .unwrap_or(packwiz::DEFAULT_CONCURRENCY)
    }

    pub fn modpack_status(&self, instance_id: &str) -> Result<ModpackStatus> {
        self.modpack_for(instance_id).status()
    }

    pub fn sync_modpack(
        &self,
        instance_id: &str,
        force: bool,
        cancel: &dyn Fn() -> bool,
        on_progress: &mut ProgressSink,
    ) -> Result<()> {
        self.modpack_for(instance_id)
            .sync(force, cancel, &mut Self::modpack_sink(instance_id, on_progress))?;
        self.reconcile_packwiz_loader(instance_id);
        Ok(())
    }

                            fn reconcile_packwiz_loader(&self, instance_id: &str) {
        let mgr = self.instances();
        let Ok(mut inst) = mgr.get(instance_id) else {
            return;
        };
        let url = match &inst.pack {
            PackSource::Packwiz { url, .. } => url.clone(),
            _ => return,
        };
        let Ok(pack) = packwiz::Installer::new().fetch_pack(&url) else {
            return;
        };
        let (loader, loader_version) = loader_from_pack(&pack);
        let mut changed = false;
        if inst.loader != loader {
            inst.loader = loader;
                        inst.loader_version = loader_version.clone();
            changed = true;
        }
        if inst.modpack_locked {
            if let Some(mc) = &pack.versions.minecraft {
                if &inst.minecraft_version != mc {
                    inst.minecraft_version = mc.clone();
                    changed = true;
                }
            }
            if inst.loader_version != loader_version {
                inst.loader_version = loader_version;
                changed = true;
            }
        }
        if changed {
            let _ = mgr.update(&inst);
        }
    }

    pub fn reinstall_modpack(
        &self,
        instance_id: &str,
        cancel: &dyn Fn() -> bool,
        on_progress: &mut ProgressSink,
    ) -> Result<()> {
        self.modpack_for(instance_id)
            .reinstall(cancel, &mut Self::modpack_sink(instance_id, on_progress))?;
        Ok(())
    }

    pub fn reinstall_loader(&self, instance_id: &str) -> Result<()> {
        self.modpack_for(instance_id).reinstall_loader()
    }


    pub fn delete_instance(&self, instance_id: &str) -> Result<()> {
        self.instances().delete(instance_id)
    }

    pub fn set_selected_instance(&self, instance_id: &str) -> Result<()> {
        let mut settings = self.settings()?;
        settings.selected_instance = Some(instance_id.to_string());
        self.save_settings(&settings)
    }

    pub fn create_custom_instance(
        &self,
        name: &str,
        minecraft_version: &str,
        loader: LoaderKind,
        loader_version: LoaderVersion,
    ) -> Result<Instance> {
        let mgr = self.instances();
        let base = if name.trim().is_empty() {
            format!("{} {minecraft_version}", loader.label())
        } else {
            name.trim().to_string()
        };
        let display = mgr.unique_name(&base);
        let id = mgr.unique_id(&display);
        let loader_version = match loader_version {
            LoaderVersion::Stable => versions::latest_stable_version(loader, minecraft_version)
                .map(LoaderVersion::Exact)
                .unwrap_or(LoaderVersion::Stable),
            other => other,
        };
        let inst = Instance::new_custom(
            &id,
            display,
            minecraft_version,
            loader,
            loader_version,
            PackSource::None,
        );
        mgr.create(inst)
    }

        pub fn scan_importable(&self) -> Vec<ImportCandidate> {
        import::scan()
    }

                pub fn import_external(&self, keys: Vec<String>) -> Result<Vec<Instance>> {
        let candidates = import::scan();
        let mgr = self.instances();
        let mut settings = self.settings()?;
                let mut group_folder: std::collections::HashMap<String, String> = settings
            .instance_folders
            .iter()
            .map(|f| (f.name.clone(), f.id.clone()))
            .collect();
        let mut settings_dirty = false;
        let mut created = Vec::new();

        for key in keys {
            let Some(c) = candidates
                .iter()
                .find(|c| format!("{}:{}", c.source, c.key) == key)
            else {
                continue;
            };
            let loader = match c.loader.as_str() {
                "neoforge" => LoaderKind::NeoForge,
                "forge" => LoaderKind::Forge,
                "fabric" => LoaderKind::Fabric,
                "quilt" => LoaderKind::Quilt,
                _ => LoaderKind::Vanilla,
            };
            let loader_version = match &c.loader_version {
                Some(v) if !v.is_empty() => LoaderVersion::Exact(v.clone()),
                _ => LoaderVersion::Stable,
            };
                                    let pack = match (c.pack_provider.as_deref(), &c.pack_id, &c.pack_version) {
                (Some("modrinth"), Some(pid), Some(vid)) => PackSource::Modrinth {
                    project_id: Some(pid.clone()),
                    version_id: vid.clone(),
                },
                (Some("curseforge"), Some(pid), Some(fid)) => PackSource::Curseforge {
                    project_id: pid.clone(),
                    file_id: fid.clone(),
                },
                _ => PackSource::None,
            };
            let display = mgr.unique_name(&c.name);
            let id = mgr.unique_id(&display);
            let mut inst = Instance::new_custom(
                &id,
                display,
                &c.minecraft,
                loader,
                loader_version,
                pack,
            );
            inst.notes = c.notes.clone();
            if let Some(group) = &c.group {
                let fid = if let Some(fid) = group_folder.get(group) {
                    fid.clone()
                } else {
                    let fid = unique_folder_id(&settings, group);
                    settings.instance_folders.push(InstanceFolder {
                        id: fid.clone(),
                        name: group.clone(),
                        color: None,
                        collapsed: false,
                    });
                    group_folder.insert(group.clone(), fid.clone());
                    settings_dirty = true;
                    fid
                };
                inst.folder_id = Some(fid);
            }
                        inst.icon = c.icon.clone();

            let src_game = import::game_dir_for(c);
            if src_game.is_dir() {
                let dst_game = self.paths.instance_game_dir(&id);
                import::copy_dir_all(&src_game, &dst_game)
                    .map_err(|e| CoreError::Io { path: dst_game, source: e })?;
                                                let items = match c.source.as_str() {
                    "modrinth" => import::modrinth_mod_items(c),
                    _ => import::prism_mod_items(&src_game),
                };
                if !items.is_empty() {
                    write_json(
                        &self.paths.user_content(&id),
                        &serde_json::json!({ "items": items }),
                        "user_content",
                    )?;
                }
            }
            created.push(mgr.create(inst)?);
        }

        if settings_dirty {
            self.save_settings(&settings)?;
        }
        Ok(created)
    }

        pub fn list_packwiz_branches(&self, repo: &str) -> Result<Vec<packwiz::PackwizBranch>> {
        Ok(packwiz::Installer::new().github_pack_branches(repo)?)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_packwiz_instance(
        &self,
        name: &str,
        url: &str,
        optional: Vec<String>,
        unsup: bool,
        flavors: Vec<String>,
        public_key: Option<String>,
        meta: PackInstallMeta,
    ) -> Result<Instance> {
        let installer = packwiz::Installer::new();
        let pack = installer.fetch_pack(url)?;
        let mc = pack
            .versions
            .minecraft
            .clone()
            .unwrap_or_else(|| "1.21.1".to_string());
        let (loader, loader_version) = loader_from_pack(&pack);
        let mgr = self.instances();
        let display = if name.trim().is_empty() {
            pack.name.clone()
        } else {
            name.to_string()
        };
        let id = mgr.unique_id(if display.is_empty() { "modpack" } else { &display });
        let mut inst = Instance::new_custom(
            &id,
            display,
            mc,
            loader,
            loader_version,
            PackSource::Packwiz {
                url: url.to_string(),
                unsup,
            },
        );
        inst.optional_mods = Some(optional);
        inst.unsup_flavors = Some(flavors);
        inst.unsup_public_key = public_key.filter(|k| !k.trim().is_empty());
        let clean = |s: Option<String>| s.filter(|v| !v.trim().is_empty());
        inst.icon = clean(meta.icon).or_else(|| installer.find_pack_icon(url));
        if inst.icon.is_none() {
            if let Some(bytes) =
                packwiz::Installer::local_icon_path(url).and_then(|p| std::fs::read(p).ok())
            {
                inst.icon = self.write_branding_icon(&id, &bytes);
            }
        }
        inst.banner = clean(meta.banner);
        inst.notes = clean(meta.description);
        inst.shared_by = clean(meta.shared_by);
        inst.news_url = clean(meta.news_url);
        inst.playercount_url = clean(meta.playercount_url);
        inst.show_news = inst.news_url.is_some();
        inst.show_playercount = inst.playercount_url.is_some();
        inst.min_memory_mb = meta.min_memory_mb;
        inst.max_memory_mb = meta.max_memory_mb;
        if let Some(args) = meta.jvm_args {
            let args: Vec<String> = args.into_iter().filter(|a| !a.trim().is_empty()).collect();
            if !args.is_empty() {
                inst.extra_jvm_args = args;
            }
        }
        let shared = Self::fetch_shared_config(url);
        if let Some(sf) = &shared {
            apply_shared_params(&mut inst, &sf.params);
        }
        let created = mgr.create(inst)?;
        if let Some(sf) = shared {
            let mut cfg = sf.config;
            cfg.id = String::new();
            cfg.created_at = 0;
            let _ = self.save_export_config(&created.id, cfg);
        }
        Ok(created)
    }

    fn fetch_shared_config(pack_url: &str) -> Option<SharedConfigFile> {
        if !pack_url.starts_with("http") {
            return None;
        }
        let (base, _) = pack_url.rsplit_once('/')?;
        let cfg_url = format!("{base}/brassworks.share.json");
        let text = forge::fetch_text(&cfg_url).ok()?;
        serde_json::from_str::<SharedConfigFile>(&text).ok()
    }

    pub fn detect_pack_file(&self, path: &str) -> Result<instance::PackFileKind> {
        let p = std::path::Path::new(path);
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext == "mrpack" {
            return Ok(instance::PackFileKind {
                kind: "mrpack".to_string(),
                source: Some("modrinth".to_string()),
                unsup: false,
            });
        }
        let bytes = std::fs::read(p).map_err(|e| CoreError::io(p, e))?;
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes))
            .map_err(|e| CoreError::Modpack(format!("not a valid zip: {e}")))?;
        let (mut pack_toml, mut unsup_toml, mut manifest, mut mr_index) =
            (false, false, false, false);
        for i in 0..archive.len() {
            let Ok(entry) = archive.by_index(i) else {
                continue;
            };
            let Some(name) = entry.enclosed_name() else {
                continue;
            };
            let name = name.to_string_lossy().replace('\\', "/");
            match name.rsplit('/').next().unwrap_or(&name) {
                "pack.toml" => pack_toml = true,
                "unsup.toml" => unsup_toml = true,
                "manifest.json" => manifest = true,
                "modrinth.index.json" => mr_index = true,
                _ => {}
            }
        }
        if pack_toml {
            // unsup.toml is the marker that flavors/unsup are configured.
            return Ok(instance::PackFileKind {
                kind: "packwiz".to_string(),
                source: None,
                unsup: unsup_toml,
            });
        }
        if mr_index {
            return Ok(instance::PackFileKind {
                kind: "mrpack".to_string(),
                source: Some("modrinth".to_string()),
                unsup: false,
            });
        }
        if manifest {
            return Ok(instance::PackFileKind {
                kind: "curseforge".to_string(),
                source: Some("curseforge".to_string()),
                unsup: false,
            });
        }
        Err(CoreError::Modpack(
            "unrecognized pack file (expected a packwiz, CurseForge, or Modrinth pack)".to_string(),
        ))
    }

    pub fn write_temp_pack(&self, filename: &str, bytes: &[u8]) -> Result<String> {
        let base = std::path::Path::new(filename)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("pack.zip")
            .replace(['/', '\\'], "_");
        let base = if base.trim().is_empty() {
            "pack.zip".to_string()
        } else {
            base
        };
        let unique = format!(
            "drop-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let dir = self.paths.root().join("imported").join(unique);
        std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        let dest = dir.join(&base);
        std::fs::write(&dest, bytes).map_err(|e| CoreError::io(&dest, e))?;
        Ok(dest.to_string_lossy().into_owned())
    }

    pub fn extract_packwiz_pack(&self, path: &str) -> Result<String> {
        let bytes =
            std::fs::read(path).map_err(|e| CoreError::io(std::path::Path::new(path), e))?;
        let unique = format!(
            "pw-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let dest = self.paths.root().join("imported").join(unique);
        let pack_rel = extract_packwiz_zip(&bytes, &dest)?;
        Ok(packwiz::local_pack_url(&dest.join(&pack_rel)))
    }

                pub fn switch_packwiz_branch(&self, instance_id: &str, url: &str) -> Result<Instance> {
        let installer = packwiz::Installer::new();
        let pack = installer.fetch_pack(url)?;
        let mc = pack
            .versions
            .minecraft
            .clone()
            .unwrap_or_else(|| "1.21.1".to_string());
        let (loader, loader_version) = loader_from_pack(&pack);
        let mgr = self.instances();
        let mut inst = mgr.get(instance_id)?;
        let unsup = match inst.pack {
            PackSource::Packwiz { unsup, .. } => unsup,
            _ => {
                return Err(CoreError::Modpack(
                    "instance is not a packwiz pack".to_string(),
                ))
            }
        };
        inst.minecraft_version = mc;
        inst.loader = loader;
        inst.loader_version = loader_version;
        inst.pack = PackSource::Packwiz {
            url: url.to_string(),
            unsup,
        };
        if let Some(icon) = installer.find_pack_icon(url) {
            inst.icon = Some(icon);
        }
        mgr.update(&inst)?;
        Ok(inst)
    }

            pub fn preflight_modpack(
        &self,
        source: &str,
        project_id: &str,
        version_id: &str,
        cancel: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(SyncProgress),
    ) -> Result<packs::Preflight> {
        let modrinth = self.modrinth_client();
        let cf = self.cf_client();
        packs::preflight_remote(
            &self.paths, source, project_id, version_id, &modrinth, Some(&cf), cancel, progress,
        )
    }

        pub fn preflight_modpack_file(
        &self,
        file_path: &str,
        source: &str,
    ) -> Result<packs::Preflight> {
        let path = std::path::Path::new(file_path);
        let bytes = std::fs::read(path).map_err(|e| CoreError::io(path, e))?;
        let cf = self.cf_client();
        packs::preflight_file(source, bytes, Some(&cf))
    }

        pub fn inspect_packwiz(
        &self,
        url: &str,
        cancel: &dyn Fn() -> bool,
    ) -> Result<Vec<packs::OptionalComponent>> {
        modpack::Modpack::with_url(&self.paths, "__inspect__", url.to_string())
            .with_concurrency(self.concurrency())
            .optional_components(cancel)
    }

            pub fn inspect_packwiz_flavors(
        &self,
        url: &str,
        cancel: &dyn Fn() -> bool,
    ) -> Result<Vec<packwiz::FlavorGroup>> {
        modpack::Modpack::with_url(&self.paths, "__inspect__", url.to_string())
            .with_concurrency(self.concurrency())
            .flavor_groups(cancel)
    }

            pub fn set_packwiz_flavors(&self, instance_id: &str, flavors: Vec<String>) -> Result<Instance> {
        let mgr = self.instances();
        let mut inst = mgr.get(instance_id)?;
        match &mut inst.pack {
            PackSource::Packwiz { unsup, .. } => *unsup = true,
            _ => {
                return Err(CoreError::Modpack(
                    "instance is not a packwiz pack".to_string(),
                ))
            }
        }
        inst.unsup_flavors = Some(flavors);
        mgr.update(&inst)?;
        Ok(inst)
    }

    fn cf_key(&self) -> String {
        self.settings()
            .ok()
            .and_then(|s| s.curseforge_api_key)
            .filter(|k| !k.trim().is_empty())
            .unwrap_or_else(|| modpack::DEFAULT_CURSEFORGE_API_KEY.to_string())
    }

    fn modrinth_client(&self) -> packwiz::Modrinth {
        packwiz::Installer::new().modrinth(self.paths.modrinth_cache_dir())
    }

    fn cf_client(&self) -> packwiz::Curseforge {
        packwiz::Installer::new().curseforge(self.paths.curseforge_cache_dir(), self.cf_key())
    }

    pub fn search_modpacks(
        &self,
        source: &str,
        query: &str,
        filters: &SearchFilters,
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        if source == "curseforge" {
            Ok(self.cf_client().search_modpacks(query, filters, 20, offset)?)
        } else {
            Ok(self.modrinth_client().search_modpacks(query, filters, 20, offset)?)
        }
    }

    pub fn modpack_filter_options(&self, source: &str) -> Result<FilterOptions> {
        if source == "curseforge" {
            Ok(self.cf_client().filter_options("modpack"))
        } else {
            Ok(self.modrinth_client().filter_options("modpack"))
        }
    }

    pub fn modpack_versions(
        &self,
        source: &str,
        project_id: &str,
    ) -> Result<Vec<ContentVersion>> {
        let versions = if source == "curseforge" {
            self.cf_client().project_files(project_id)?
        } else {
            self.modrinth_client().project_versions(project_id)?
        };
        Ok(versions
            .into_iter()
            .map(|v| ContentVersion {
                version_id: v.version_id,
                version_number: v.version_number,
                game_versions: v.game_versions,
                loaders: v.loaders,
            })
            .collect())
    }

    pub fn scan_manual_mods(
        &self,
        folders: Vec<String>,
        wanted: Vec<packs::ManualWant>,
    ) -> Vec<(String, String)> {
        packs::scan_manual_mods(&folders, &wanted)
            .into_iter()
            .collect()
    }

    pub fn validate_manual_mod(&self, path: String, sha1: Option<String>) -> bool {
        packs::validate_manual_file(std::path::Path::new(&path), sha1.as_deref())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn install_modpack(
        &self,
        source: &str,
        project_id: &str,
        version_id: &str,
        name: &str,
        optional: Vec<String>,
        manual_mods: Vec<(String, String)>,
        cancel: &dyn Fn() -> bool,
        on_created: &mut dyn FnMut(&Instance),
        progress: &mut dyn FnMut(SyncProgress),
    ) -> Result<Instance> {
        let mgr = self.instances();
        let id = mgr.unique_id(if name.trim().is_empty() { project_id } else { name });
        let pack = if source == "curseforge" {
            PackSource::Curseforge {
                project_id: project_id.to_string(),
                file_id: version_id.to_string(),
            }
        } else {
            PackSource::Modrinth {
                project_id: Some(project_id.to_string()),
                version_id: version_id.to_string(),
            }
        };
        let mut instance = Instance::new_custom(
            &id,
            name,
            "1.21.1",
            LoaderKind::Vanilla,
            LoaderVersion::Stable,
            pack.clone(),
        );
        instance.optional_mods = Some(optional.clone());
        mgr.create(instance.clone())?;
        on_created(&instance);

        if let Err(e) = packs::place_manual_mods(&self.paths, &id, &manual_mods) {
            let _ = mgr.delete(&id);
            return Err(e);
        }

        let modrinth = self.modrinth_client();
        let cf = self.cf_client();
        let optional = packs::optional_set(&Some(optional));
        match packs::sync_pack(&self.paths, &id, &pack, &optional, self.concurrency(), &modrinth, Some(&cf), cancel, progress) {
            Ok(res) => {
                instance.minecraft_version = res.minecraft_version;
                instance.loader = res.loader;
                instance.loader_version = res
                    .loader_version
                    .map(LoaderVersion::Exact)
                    .unwrap_or(LoaderVersion::Stable);
                if instance.name.trim().is_empty() {
                    instance.name = if res.name.is_empty() { id.clone() } else { res.name };
                }
                let icon_url = if source == "curseforge" {
                    cf.project(project_id).and_then(|p| p.icon_url)
                } else {
                    modrinth.project(project_id).and_then(|p| p.icon_url)
                };
                instance.icon = icon_url
                    .as_deref()
                    .and_then(image_cache::download)
                    .and_then(|b| self.write_branding_icon(&id, &b))
                    .or(icon_url);
                mgr.update(&instance)?;
                Ok(instance)
            }
            Err(e) => {
                let _ = mgr.delete(&id);
                Err(e)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn install_modpack_file(
        &self,
        file_path: &str,
        source: &str,
        name: &str,
        optional: Vec<String>,
        manual_mods: Vec<(String, String)>,
        cancel: &dyn Fn() -> bool,
        on_created: &mut dyn FnMut(&Instance),
        progress: &mut dyn FnMut(SyncProgress),
    ) -> Result<Instance> {
        let path = std::path::Path::new(file_path);
        let bytes = std::fs::read(path).map_err(|e| CoreError::io(path, e))?;
        let fallback = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("modpack");
        let name = if name.trim().is_empty() { fallback } else { name };
        self.install_modpack_data(
            bytes, source, name, optional, manual_mods, cancel, on_created, progress,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn install_modpack_data(
        &self,
        bytes: Vec<u8>,
        source: &str,
        name: &str,
        optional: Vec<String>,
        manual_mods: Vec<(String, String)>,
        cancel: &dyn Fn() -> bool,
        on_created: &mut dyn FnMut(&Instance),
        progress: &mut dyn FnMut(SyncProgress),
    ) -> Result<Instance> {
        let mgr = self.instances();
        let base = if name.trim().is_empty() {
            "modpack".to_string()
        } else {
            name.trim().to_string()
        };
        let display = mgr.unique_name(&base);
        let id = mgr.unique_id(&display);
        let mut instance = Instance::new_custom(
            &id,
            &display,
            "1.21.1",
            LoaderKind::Vanilla,
            LoaderVersion::Stable,
            PackSource::None,
        );
        instance.modpack_locked = true;
        instance.optional_mods = Some(optional.clone());
        mgr.create(instance.clone())?;
        on_created(&instance);

        if let Err(e) = packs::place_manual_mods(&self.paths, &id, &manual_mods) {
            let _ = mgr.delete(&id);
            return Err(e);
        }

        let icon_bytes = read_zip_icon(&bytes);
        let modrinth = self.modrinth_client();
        let cf = self.cf_client();
        let optional = packs::optional_set(&Some(optional));
        match packs::install_file(&self.paths, &id, source, bytes, &optional, self.concurrency(), &modrinth, Some(&cf), cancel, progress)
        {
            Ok(res) => {
                instance.minecraft_version = res.minecraft_version;
                instance.loader = res.loader;
                instance.loader_version = res
                    .loader_version
                    .map(LoaderVersion::Exact)
                    .unwrap_or(LoaderVersion::Stable);
                if let Some(p) = icon_bytes
                    .as_deref()
                    .and_then(|b| self.write_branding_icon(&id, b))
                {
                    instance.icon = Some(p);
                }
                mgr.update(&instance)?;
                Ok(instance)
            }
            Err(e) => {
                let _ = mgr.delete(&id);
                Err(e)
            }
        }
    }

    pub fn delete_java_runtime(&self, exe_path: &str) -> Result<()> {
        java::delete_runtime(&self.paths.jvm_dir(), std::path::Path::new(exe_path))
            .map_err(CoreError::Modpack)
    }

    pub fn java_runtimes(&self) -> Vec<java::JavaInstall> {
        java::list_runtimes(&self.paths.jvm_dir())
    }

    pub fn download_java(&self, major: u32) -> Result<()> {
        java::ensure_runtime(&self.paths.jvm_dir(), major)
            .map(|_| ())
            .map_err(CoreError::Modpack)
    }


    fn with_token<T>(
        &self,
        account_id: &str,
        mut f: impl FnMut(&str) -> Result<T>,
    ) -> Result<T> {
        let store = self.accounts()?;
        let account = store
            .accounts
            .iter()
            .find(|a| a.id == account_id)
            .ok_or_else(|| CoreError::Auth("account not found".to_string()))?;
        if !account.is_microsoft() {
            return Err(CoreError::Auth(
                "Skins require a Microsoft account".to_string(),
            ));
        }
        let db = msa::Database::new(self.paths.msa_db_file());
        let uuid =
            uuid::Uuid::parse_str(&account.uuid).map_err(|e| CoreError::Auth(e.to_string()))?;
        let mut acc = db
            .load_from_uuid(uuid)
            .map_err(|e| CoreError::Auth(format!("{e:?}")))?
            .ok_or_else(|| CoreError::Auth("Sign in again".to_string()))?;

        match f(acc.access_token()) {
            Err(CoreError::Unauthorized) => {
                acc.request_refresh().map_err(|e| {
                    CoreError::Auth(format!("session expired, sign in again ({e:?})"))
                })?;
                let _ = db.store(acc.clone());
                f(acc.access_token())
            }
            other => other,
        }
    }

    pub fn skin_profile(&self, account_id: &str) -> Result<skins::SkinProfile> {
        self.with_token(account_id, |t| skins::get_profile(t))
    }

                    pub fn seed_current_skin(&self, account_id: &str) -> skins::SkinLibraryView {
        let has_skins = self
            .skin_library()
            .accounts
            .get(account_id)
            .is_some_and(|a| !a.skins.is_empty());
        if !has_skins {
            let _ = self.try_seed_current_skin(account_id);
        }
        self.list_skins(account_id)
    }

    fn try_seed_current_skin(&self, account_id: &str) -> Result<()> {
        let profile = self.skin_profile(account_id)?;
        let Some(url) = profile.skin_url.as_deref() else {
            return Ok(());
        };
        let bytes = skins::download_texture(url)?;
        let cape = profile.capes.iter().find(|c| c.active).map(|c| c.id.clone());
        let saved = self.create_preset(
            account_id,
            "Current skin",
            &profile.model,
            cape.as_deref(),
            Some(bytes),
            None,
        )?;
        self.set_selected_skin(account_id, Some(&saved.id))
    }

    pub fn set_cape(&self, account_id: &str, cape_id: Option<&str>) -> Result<()> {
        self.with_token(account_id, |t| skins::set_cape(t, cape_id))
    }

    fn skin_library(&self) -> skins::SkinLibrary {
        read_json_or_default(&self.paths.skins_index(), "skins").unwrap_or_default()
    }

    fn save_skin_library(&self, lib: &skins::SkinLibrary) -> Result<()> {
        write_json(&self.paths.skins_index(), lib, "skins")
    }

                pub fn list_skins(&self, account_id: &str) -> skins::SkinLibraryView {
        let mut lib = self.skin_library();
        let had_legacy = !lib.skins.is_empty();
        let acct = lib.account_mut(account_id);
        let normalized = acct.normalize();
        let acct = acct.clone();
        if had_legacy || normalized {
            let _ = self.save_skin_library(&lib);
        }
        skins::SkinLibraryView {
            skins: acct.skins,
            selected: acct.selected,
        }
    }

        fn write_skin_file(&self, bytes: &[u8]) -> Result<(String, String)> {
        let dir = self.paths.skins_dir();
        std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        let id = uuid::Uuid::new_v4().to_string();
        let file = dir.join(format!("{id}.png"));
        std::fs::write(&file, bytes).map_err(|e| CoreError::io(&file, e))?;
        Ok((id, file.to_string_lossy().to_string()))
    }

    fn norm_model(model: &str) -> String {
        if model == "slim" { "slim" } else { "classic" }.to_string()
    }

                    pub fn create_preset(
        &self,
        account_id: &str,
        name: &str,
        model: &str,
        cape_id: Option<&str>,
        bytes: Option<Vec<u8>>,
        url: Option<String>,
    ) -> Result<skins::SavedSkin> {
        let bytes = match bytes {
            Some(b) => b,
            None => {
                let url = url
                    .ok_or_else(|| CoreError::Modpack("No texture provided".to_string()))?;
                skins::download_texture(&url)?
            }
        };
        let (id, file) = self.write_skin_file(&bytes)?;
        let mut lib = self.skin_library();
        let acct = lib.account_mut(account_id);
        let saved = skins::SavedSkin {
            id,
            name: skins::unique_name(&acct.skins, name, None),
            file,
            model: Self::norm_model(model),
            cape_id: cape_id.map(|c| c.to_string()),
        };
        acct.skins.insert(0, saved.clone());
        self.save_skin_library(&lib)?;
        Ok(saved)
    }

                pub fn update_preset(
        &self,
        account_id: &str,
        skin_id: &str,
        name: &str,
        model: &str,
        cape_id: Option<&str>,
        bytes: Option<Vec<u8>>,
    ) -> Result<skins::SavedSkin> {
                        let new_file = match &bytes {
            Some(b) => Some(self.write_skin_file(b)?),
            None => None,
        };
        let mut lib = self.skin_library();
        let acct = lib.account_mut(account_id);
        let unique = skins::unique_name(&acct.skins, name, Some(skin_id));
        let skin = acct
            .skins
            .iter_mut()
            .find(|s| s.id == skin_id)
            .ok_or_else(|| CoreError::Modpack("Skin not found".to_string()))?;
        let old_file = new_file.as_ref().map(|(_, path)| {
            std::mem::replace(&mut skin.file, path.clone())
        });
        skin.name = unique;
        skin.model = Self::norm_model(model);
        skin.cape_id = cape_id.map(|c| c.to_string());
        let saved = skin.clone();
        self.save_skin_library(&lib)?;
        if let Some(old) = old_file {
            if old != saved.file {
                let _ = std::fs::remove_file(&old);
            }
        }
        Ok(saved)
    }

                pub fn duplicate_skin(
        &self,
        account_id: &str,
        skin_id: &str,
        name: &str,
    ) -> Result<skins::SavedSkin> {
        let (bytes, model, cape) = {
            let lib = self.skin_library();
            let src = lib
                .accounts
                .get(account_id)
                .and_then(|a| a.skins.iter().find(|s| s.id == skin_id))
                .ok_or_else(|| CoreError::Modpack("Skin not found".to_string()))?;
            let bytes = std::fs::read(&src.file)
                .map_err(|e| CoreError::io(std::path::Path::new(&src.file), e))?;
            (bytes, src.model.clone(), src.cape_id.clone())
        };
        self.create_preset(account_id, name, &model, cape.as_deref(), Some(bytes), None)
    }

            pub fn delete_skin(&self, account_id: &str, skin_id: &str) -> Result<()> {
        let mut lib = self.skin_library();
        let acct = lib.account_mut(account_id);
        if acct.selected.as_deref() == Some(skin_id) {
            return Err(CoreError::Modpack(
                "Can't delete the selected skin — apply another first".to_string(),
            ));
        }
        if let Some(s) = acct.skins.iter().find(|s| s.id == skin_id) {
            let _ = std::fs::remove_file(&s.file);
        }
        acct.skins.retain(|s| s.id != skin_id);
        self.save_skin_library(&lib)
    }

    fn set_selected_skin(&self, account_id: &str, skin_id: Option<&str>) -> Result<()> {
        let mut lib = self.skin_library();
        lib.account_mut(account_id).selected = skin_id.map(|s| s.to_string());
        self.save_skin_library(&lib)
    }

    pub fn apply_saved_skin(&self, account_id: &str, skin_id: &str) -> Result<()> {
        let lib = self.skin_library();
        let skin = lib
            .accounts
            .get(account_id)
            .and_then(|a| a.skins.iter().find(|s| s.id == skin_id))
            .ok_or_else(|| CoreError::Modpack("Skin not found".to_string()))?;
        let bytes = std::fs::read(&skin.file)
            .map_err(|e| CoreError::io(std::path::Path::new(&skin.file), e))?;
        let model = skin.model.clone();
        let cape = skin.cape_id.clone();
        self.with_token(account_id, move |t| {
            skins::upload_skin(t, bytes.clone(), &model)?;
            skins::set_cape(t, cape.as_deref())
        })?;
        self.set_selected_skin(account_id, Some(skin_id))
    }

    pub fn update_modpack(
        &self,
        instance_id: &str,
        version_id: Option<&str>,
        cancel: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(SyncProgress),
    ) -> Result<Instance> {
        let mgr = self.instances();
        let mut instance = mgr.get(instance_id)?;
        if let Some(vid) = version_id {
            instance.pack = match &instance.pack {
                PackSource::Modrinth { project_id, .. } => PackSource::Modrinth {
                    project_id: project_id.clone(),
                    version_id: vid.to_string(),
                },
                PackSource::Curseforge { project_id, .. } => PackSource::Curseforge {
                    project_id: project_id.clone(),
                    file_id: vid.to_string(),
                },
                other => other.clone(),
            };
        }
        let modrinth = self.modrinth_client();
        let cf = self.cf_client();
        let optional = packs::optional_set(&instance.optional_mods);
        let res = packs::sync_pack(
            &self.paths,
            instance_id,
            &instance.pack,
            &optional,
            self.concurrency(),
            &modrinth,
            Some(&cf),
            cancel,
            progress,
        )?;
        instance.minecraft_version = res.minecraft_version;
        instance.loader = res.loader;
        instance.loader_version = res
            .loader_version
            .map(LoaderVersion::Exact)
            .unwrap_or(LoaderVersion::Stable);
        mgr.update(&instance)?;
        Ok(instance)
    }

    pub fn list_mods(&self, instance_id: &str) -> Result<Vec<InstalledMod>> {
        self.modpack_for(instance_id).list_mods()
    }

    pub fn mod_info(
        &self,
        instance_id: &str,
        source: &str,
        project_id: &str,
        version_id: Option<&str>,
    ) -> ModInfo {
        self.modpack_for(instance_id)
            .mod_info(source, project_id, version_id)
    }

    pub fn set_content_enabled(
        &self,
        instance_id: &str,
        path: &str,
        enabled: bool,
    ) -> Result<()> {
        let unlocked = !self.modpack_locked(instance_id);
        self.modpack_for(instance_id)
            .set_enabled(path, enabled, unlocked)
    }

    pub fn remove_content(&self, instance_id: &str, path: &str) -> Result<()> {
        self.modpack_for(instance_id).remove_content(path)
    }

    pub fn search_content(
        &self,
        instance_id: &str,
        query: &str,
        project_type: &str,
        source: &str,
        filters: &SearchFilters,
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        self.modpack_for(instance_id)
            .search(query, project_type, source, filters, offset)
    }

    pub fn content_filter_options(
        &self,
        instance_id: &str,
        project_type: &str,
        source: &str,
    ) -> Result<FilterOptions> {
        self.modpack_for(instance_id)
            .filter_options(project_type, source)
    }

    pub fn content_detail(
        &self,
        instance_id: &str,
        project_id: &str,
        source: &str,
    ) -> Result<modpack::ProjectDetail> {
        self.modpack_for(instance_id)
            .project_detail(project_id, source)
    }

    pub fn content_versions(
        &self,
        instance_id: &str,
        project_id: &str,
        project_type: &str,
        source: &str,
    ) -> Result<Vec<modpack::ContentVersion>> {
        self.modpack_for(instance_id)
            .list_versions(project_id, project_type, source)
    }

    pub fn install_content(
        &self,
        instance_id: &str,
        project_id: &str,
        project_type: &str,
        source: &str,
    ) -> Result<InstallResult> {
        self.modpack_for(instance_id)
            .install_from_source(project_id, project_type, source)
    }

    pub fn install_content_version(
        &self,
        instance_id: &str,
        project_id: &str,
        version_id: &str,
        project_type: &str,
        source: &str,
    ) -> Result<InstallResult> {
        let unlocked = !self.modpack_locked(instance_id);
        self.modpack_for(instance_id)
            .install_version(project_id, version_id, project_type, source, unlocked)
    }

    pub fn update_all_content(&self, instance_id: &str) -> Result<Vec<String>> {
        self.modpack_for(instance_id).update_all()
    }

    pub fn content_changelog(
        &self,
        instance_id: &str,
        project_id: &str,
        version_id: &str,
        source: &str,
    ) -> Result<String> {
        self.modpack_for(instance_id)
            .content_changelog(project_id, version_id, source)
    }

    pub fn uninstall_game(&self, instance_id: &str) -> Result<()> {
        self.modpack_for(instance_id).uninstall()
    }

    fn export_meta_for(&self, instance: &instance::Instance) -> (export::ExportMeta, String) {
        let mp = self.modpack_for(&instance.id);
        let loader = instance.loader.as_str().to_string();
        let loader_version = match &instance.loader_version {
            instance::LoaderVersion::Exact(v) => Some(v.clone()),
            _ => mp.installed_neoforge(),
        };
        let meta = export::ExportMeta {
            name: instance.name.clone(),
            author: String::new(),
            version: "1.0.0".to_string(),
            mc_version: instance.minecraft_version.clone(),
            loader: loader.clone(),
            loader_version,
        };
        (meta, loader)
    }

    fn resolve_export_icon(&self, instance: &instance::Instance) -> Option<Vec<u8>> {
        let icon = instance.icon.as_deref()?;
        if icon.is_empty() || icon.starts_with("builtin:") {
            return None;
        }
        if icon.starts_with("http://") || icon.starts_with("https://") {
            if let Some(path) = image_cache::cached_image(&self.paths.image_cache_dir(), icon) {
                return std::fs::read(path).ok();
            }
            return image_cache::cache_image(&self.paths.image_cache_dir(), icon)
                .and_then(|p| std::fs::read(p).ok());
        }
        std::fs::read(icon).ok()
    }

    fn write_branding_icon(&self, id: &str, bytes: &[u8]) -> Option<String> {
        let dir = self.paths.instance_dir(id).join("branding");
        let dest = dir.join("icon.png");
        if std::fs::create_dir_all(&dir).is_ok() && std::fs::write(&dest, bytes).is_ok() {
            Some(dest.to_string_lossy().into_owned())
        } else {
            None
        }
    }

    pub fn export_tree(&self, instance_id: &str) -> Result<export::ExportTree> {
        self.modpack_for(instance_id).export_tree()
    }

    pub fn export_modpack(&self, instance_id: &str, format: &str) -> Result<String> {
        let instance = self.instances().get(instance_id)?;
        let fmt = export::ExportFormat::parse(format)
            .ok_or_else(|| CoreError::Modpack(format!("unknown export format '{format}'")))?;
        let mp = self.modpack_for(instance_id);
        let selection = mp.full_selection()?;
        let (mut meta, _) = self.export_meta_for(&instance);
        self.write_export(
            &instance,
            fmt,
            &mut meta,
            &selection,
            &modpack::ExportOpts::default(),
        )
    }

    pub fn export_modpack_selected(
        &self,
        instance_id: &str,
        format: &str,
        selection: export::ExportSelection,
        meta: Option<export::ExportMeta>,
    ) -> Result<String> {
        self.export_modpack_selected_opts(instance_id, format, selection, meta, false, false, "")
    }

    #[allow(clippy::too_many_arguments)]
    pub fn export_modpack_selected_opts(
        &self,
        instance_id: &str,
        format: &str,
        selection: export::ExportSelection,
        meta: Option<export::ExportMeta>,
        unsup: bool,
        sign: bool,
        sign_format: &str,
    ) -> Result<String> {
        let instance = self.instances().get(instance_id)?;
        let fmt = export::ExportFormat::parse(format)
            .ok_or_else(|| CoreError::Modpack(format!("unknown export format '{format}'")))?;
        let mut meta = meta.unwrap_or_else(|| self.export_meta_for(&instance).0);
        let unsup = unsup && fmt == export::ExportFormat::Packwiz;
        let opts = self.build_export_opts(instance_id, unsup, sign, sign_format);
        self.write_export(&instance, fmt, &mut meta, &selection, &opts)
    }

    fn build_export_opts(
        &self,
        instance_id: &str,
        unsup: bool,
        sign: bool,
        sign_format: &str,
    ) -> modpack::ExportOpts {
        let signing = if unsup && sign {
            let (seed, key_id) = self.ensure_unsup_key(instance_id);
            Some(packwiz::export::SigningInput {
                seed,
                key_id,
                format: packwiz::unsup::SignFormat::parse(sign_format),
            })
        } else {
            None
        };
        modpack::ExportOpts { unsup, signing }
    }

    fn ensure_unsup_key(&self, instance_id: &str) -> ([u8; 32], u64) {
        if let Some(key) = export::load_unsup_key(&self.paths, instance_id) {
            return key;
        }
        let seed = packwiz::unsup::generate_seed();
        let key_id = packwiz::unsup::generate_key_id();
        let _ = export::save_unsup_key(&self.paths, instance_id, &seed, key_id);
        (seed, key_id)
    }

    pub fn unsup_public_key(&self, instance_id: &str, format: &str) -> String {
        let (seed, key_id) = self.ensure_unsup_key(instance_id);
        packwiz::unsup::public_key_spec(&seed, key_id, packwiz::unsup::SignFormat::parse(format))
    }

    pub fn regenerate_unsup_key(&self, instance_id: &str, format: &str) -> Result<String> {
        let seed = packwiz::unsup::generate_seed();
        let key_id = packwiz::unsup::generate_key_id();
        export::save_unsup_key(&self.paths, instance_id, &seed, key_id)?;
        Ok(packwiz::unsup::public_key_spec(
            &seed,
            key_id,
            packwiz::unsup::SignFormat::parse(format),
        ))
    }

    fn write_export(
        &self,
        instance: &instance::Instance,
        fmt: export::ExportFormat,
        meta: &mut export::ExportMeta,
        selection: &export::ExportSelection,
        opts: &modpack::ExportOpts,
    ) -> Result<String> {
        if meta.mc_version.is_empty() {
            meta.mc_version = instance.minecraft_version.clone();
        }
        if meta.loader.is_empty() {
            meta.loader = instance.loader.as_str().to_string();
        }
        if meta.loader_version.is_none() {
            meta.loader_version = self.export_meta_for(instance).0.loader_version;
        }
        let icon = self.resolve_export_icon(instance);
        let bytes = self
            .modpack_for(&instance.id)
            .run_export_opts(fmt, meta, selection, icon, opts)?;
        let safe = export::sanitize_filename(if meta.name.is_empty() {
            &instance.name
        } else {
            &meta.name
        });
        let dir = dirs::download_dir().unwrap_or_else(|| self.paths.root().to_path_buf());
        let ext = fmt.extension();
        let mut dest = dir.join(format!("{safe}.{ext}"));
        let mut n = 1;
        while dest.exists() {
            dest = dir.join(format!("{safe} ({n}).{ext}"));
            n += 1;
        }
        std::fs::write(&dest, bytes).map_err(|e| CoreError::io(&dest, e))?;
        Ok(dest.to_string_lossy().into_owned())
    }

    pub fn list_export_configs(&self, instance_id: &str) -> Vec<export::ExportConfig> {
        export::load_configs(&self.paths, instance_id)
    }

    pub fn save_export_config(
        &self,
        instance_id: &str,
        mut config: export::ExportConfig,
    ) -> Result<export::ExportConfig> {
        if config.id.trim().is_empty() {
            config.id = format!("export-{}", export::now_secs());
        }
        if config.created_at == 0 {
            config.created_at = export::now_secs();
        }
        export::upsert_config(&self.paths, instance_id, config)
    }

    pub fn delete_export_config(&self, instance_id: &str, config_id: &str) -> Result<()> {
        export::delete_config(&self.paths, instance_id, config_id)
    }

    pub fn run_export_config(&self, instance_id: &str, config_id: &str) -> Result<String> {
        let config = export::load_configs(&self.paths, instance_id)
            .into_iter()
            .find(|c| c.id == config_id)
            .ok_or_else(|| CoreError::Modpack(format!("export config '{config_id}' not found")))?;
        let format = match config.format {
            export::ExportFormat::Packwiz => "packwiz",
            export::ExportFormat::Modrinth => "modrinth",
            export::ExportFormat::Curseforge => "curseforge",
        };
        let instance = self.instances().get(instance_id)?;
        let meta = export::ExportMeta {
            name: config.pack_name.clone(),
            author: config.author.clone(),
            version: config.version.clone(),
            mc_version: instance.minecraft_version.clone(),
            loader: instance.loader.as_str().to_string(),
            loader_version: self.export_meta_for(&instance).0.loader_version,
        };
        let sign_format = if config.sign_format.is_empty() {
            "signify"
        } else {
            &config.sign_format
        };
        self.export_modpack_selected_opts(
            instance_id,
            format,
            config.selection,
            Some(meta),
            config.unsup,
            config.sign,
            sign_format,
        )
    }

    pub fn forge_login(&self, provider: forge::Provider, token: &str) -> Result<String> {
        forge::get(provider).verify_token(token)
    }

    fn clean_token(token: Option<String>) -> Option<String> {
        token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
    }

    fn session_forge_token(&self, provider: forge::Provider) -> Option<String> {
        self.session_forge_tokens
            .lock()
            .ok()
            .and_then(|g| g.get(provider.id()).cloned())
    }

    fn persisted_forge_token(&self, provider: forge::Provider) -> Result<Option<String>> {
        let s = self.settings()?;
        if let Some(t) = s.forge_tokens.get(provider.id()) {
            return Ok(Self::clean_token(Some(t.clone())));
        }
        if provider == forge::Provider::Github {
            return Ok(Self::clean_token(s.github_token));
        }
        Ok(None)
    }

    pub fn forge_token(&self, provider: forge::Provider) -> Result<Option<String>> {
        if let Some(t) = self.session_forge_token(provider) {
            return Ok(Some(t));
        }
        self.persisted_forge_token(provider)
    }

    pub fn forge_token_remembered(&self, provider: forge::Provider) -> Result<bool> {
        Ok(self.persisted_forge_token(provider)?.is_some())
    }

    fn set_persisted_forge_token(&self, provider: forge::Provider, token: Option<String>) -> Result<()> {
        let mut s = self.settings()?;
        match Self::clean_token(token) {
            Some(t) => {
                s.forge_tokens.insert(provider.id().to_string(), t);
            }
            None => {
                s.forge_tokens.remove(provider.id());
            }
        }
        if provider == forge::Provider::Github {
            s.github_token = None;
        }
        self.save_settings(&s)
    }

    fn set_session_forge_token(&self, provider: forge::Provider, token: Option<String>) {
        if let Ok(mut g) = self.session_forge_tokens.lock() {
            match Self::clean_token(token) {
                Some(t) => {
                    g.insert(provider.id().to_string(), t);
                }
                None => {
                    g.remove(provider.id());
                }
            }
        }
    }

    pub fn save_forge_token(&self, provider: forge::Provider, token: &str, remember: bool) -> Result<()> {
        if remember {
            self.set_persisted_forge_token(provider, Some(token.to_string()))?;
            self.set_session_forge_token(provider, None);
        } else {
            self.set_session_forge_token(provider, Some(token.to_string()));
        }
        Ok(())
    }

    pub fn clear_forge_token(&self, provider: forge::Provider) -> Result<()> {
        self.set_session_forge_token(provider, None);
        self.set_persisted_forge_token(provider, None)
    }

    fn require_forge_token(&self, provider: forge::Provider) -> Result<String> {
        self.forge_token(provider)?.ok_or_else(|| {
            CoreError::Auth(format!("connect a {} account first", provider.label()))
        })
    }

    fn ensure_share_config(&self, instance: &instance::Instance) -> Result<export::ExportConfig> {
        let configs = export::load_configs(&self.paths, &instance.id);
        if let Some(share) = &instance.share {
            if let Some(c) = configs.iter().find(|c| c.id == share.config_id) {
                return Ok(c.clone());
            }
        }
        if let Some(c) = configs
            .iter()
            .find(|c| matches!(c.format, export::ExportFormat::Packwiz))
        {
            return Ok(c.clone());
        }
        let selection = self.modpack_for(&instance.id).full_selection()?;
        let cfg = export::ExportConfig {
            id: String::new(),
            name: format!("{} (shared)", instance.name),
            format: export::ExportFormat::Packwiz,
            pack_name: instance.name.clone(),
            author: String::new(),
            version: "1.0.0".to_string(),
            selection,
            created_at: 0,
            unsup: false,
            sign: false,
            sign_format: String::new(),
        };
        self.save_export_config(&instance.id, cfg)
    }

    fn build_publish_files(
        &self,
        instance: &instance::Instance,
        config: &export::ExportConfig,
    ) -> Result<modpack::PackBuildOutput> {
        let author = instance
            .share
            .as_ref()
            .and_then(|s| s.params.author.clone())
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty())
            .unwrap_or_else(|| config.author.clone());
        let meta = export::ExportMeta {
            name: if config.pack_name.is_empty() {
                instance.name.clone()
            } else {
                config.pack_name.clone()
            },
            author,
            version: if config.version.is_empty() {
                "1.0.0".to_string()
            } else {
                config.version.clone()
            },
            mc_version: instance.minecraft_version.clone(),
            loader: instance.loader.as_str().to_string(),
            loader_version: self.export_meta_for(instance).0.loader_version,
        };
        let sign_format = if config.sign_format.is_empty() {
            "signify"
        } else {
            &config.sign_format
        };
        let opts = self.build_export_opts(&instance.id, config.unsup, config.sign, sign_format);
        let icon = self.resolve_export_icon(instance);
        self.modpack_for(&instance.id)
            .export_packwiz_files(&meta, &config.selection, icon, &opts)
    }

    pub fn publish_pack(
        &self,
        instance_id: &str,
        config_id: &str,
        confirm_embedded: bool,
        provider: forge::Provider,
        progress: &mut dyn FnMut(forge::PushProgress),
        cancel: &(dyn Fn() -> bool + Sync),
    ) -> Result<instance::PublishResult> {
        let mut instance = self.instances().get(instance_id)?;
        if instance.modpack_locked {
            return Err(CoreError::Modpack(
                "this modpack is locked — unlock it to share".to_string(),
            ));
        }
        let provider = instance.share.as_ref().map(|s| s.provider).unwrap_or(provider);
        let f = forge::get(provider);
        let token = self.require_forge_token(provider)?;
        let user_login = f.verify_token(&token)?;
        let mut config = if config_id.trim().is_empty() {
            self.ensure_share_config(&instance)?
        } else {
            export::load_configs(&self.paths, instance_id)
                .into_iter()
                .find(|c| c.id == config_id)
                .ok_or_else(|| CoreError::Modpack("share config not found".to_string()))?
        };
        // Bump the pack version on every re-publish so the auto-updater picks the
        // change up as a new version. The first publish keeps the config version.
        if let Some(prev) = instance
            .share
            .as_ref()
            .and_then(|s| s.published_version.as_deref())
            .filter(|v| !v.trim().is_empty())
        {
            config.version = bump_pack_version(prev);
        } else if config.version.trim().is_empty() {
            config.version = "1.0.0".to_string();
        }
        let mut out = self.build_publish_files(&instance, &config)?;

        if !confirm_embedded && !out.embedded.is_empty() {
            return Ok(instance::PublishResult {
                needs_confirm: true,
                embedded: out.embedded,
                share: None,
            });
        }

        let first_time = instance.share.is_none();
        let created_at = instance
            .share
            .as_ref()
            .map(|s| s.created_at)
            .unwrap_or_else(chrono::Utc::now);
        let (owner, repo_name, repo_url, branch) = match &instance.share {
            Some(s) => (
                s.repo_owner.clone(),
                s.repo_name.clone(),
                s.repo_url.clone(),
                s.branch.clone(),
            ),
            None => {
                let name = forge::unique_repo_name(f, &token, &user_login, &instance.name)?;
                let desc = format!("{} — a modpack shared via Brassworks Launcher", instance.name);
                let repo = f.create_repo(&token, &name, &desc)?;
                (repo.owner, repo.name, repo.web_url, repo.default_branch)
            }
        };
        let pack_url = f.raw_url(&owner, &repo_name, &branch, "pack.toml");
        let mut existing_params = instance
            .share
            .as_ref()
            .map(|s| s.params.clone())
            .unwrap_or_default();
        // Manual news: write a news.json at the repo root and point the news URL
        // at its raw file, so simply re-publishing updates the news for everyone.
        if let Some(news) = existing_params.news.clone().filter(|n| !n.is_empty()) {
            let doc = serde_json::json!({ "title": news.title, "body": news.body });
            if let Ok(bytes) = serde_json::to_vec_pretty(&doc) {
                out.files.push(("news.json".to_string(), bytes));
            }
            existing_params.news_url = Some(f.raw_url(&owner, &repo_name, &branch, "news.json"));
        }
        let publish_sig = files_signature(&out.files, &existing_params);

        let base_share = |incomplete: bool| instance::PackShare {
            repo_owner: owner.clone(),
            repo_name: repo_name.clone(),
            repo_url: repo_url.clone(),
            branch: branch.clone(),
            pack_url: pack_url.clone(),
            config_id: config.id.clone(),
            created_at,
            last_published: None,
            published_version: None,
            published_index_hash: None,
            published_signature: None,
            incomplete,
            provider,
            params: existing_params.clone(),
            published_params: instance::SharePackParams::default(),
        };

        if first_time {
            instance.share = Some(base_share(true));
            self.instances().update(&instance)?;
        }
        // Ensure the descriptor below sees the effective params, including any
        // auto-managed news_url produced by manual news above.
        if let Some(s) = instance.share.as_mut() {
            s.params = existing_params.clone();
        }

        let icon = self.resolve_export_icon(&instance);
        let descriptor = self.pack_share_descriptor(&instance, &pack_url, Some(&config));
        let install_url = install_link(&descriptor).unwrap_or_default();
        let readme = share_readme(
            &instance,
            &repo_url,
            &pack_url,
            &branch,
            icon.is_some(),
            descriptor.shared_by.as_deref(),
            &install_url,
        );
        out.files.push(("README.md".to_string(), readme.into_bytes()));
        let shared_file = SharedConfigFile {
            config: config.clone(),
            params: existing_params.clone(),
        };
        if let Ok(cfg_json) = serde_json::to_vec_pretty(&shared_file) {
            out.files.push(("brassworks.share.json".to_string(), cfg_json));
        }
        if let Ok(packwiz_json) = serde_json::to_vec_pretty(&descriptor) {
            let safe = export::sanitize_filename(&instance.name);
            out.files.push((format!("{safe}.packwiz"), packwiz_json));
        }
        out.files
            .push(("SHARE-LINK.txt".to_string(), install_url.into_bytes()));

        let message = if first_time {
            format!("share {}", instance.name)
        } else {
            format!("update {}", instance.name)
        };
        let work_dir = self.paths.instance_dir(instance_id).join("share-repo");
        match forge::push_files(
            f,
            &token,
            &owner,
            &repo_name,
            &branch,
            &out.files,
            &message,
            &work_dir,
            progress,
            cancel,
        ) {
            Ok(_) => {
                let share = instance::PackShare {
                    last_published: Some(chrono::Utc::now()),
                    published_version: Some(out.version),
                    published_index_hash: Some(out.index_hash),
                    published_signature: Some(publish_sig),
                    incomplete: false,
                    published_params: existing_params.clone(),
                    ..base_share(false)
                };
                instance.share = Some(share.clone());
                self.instances().update(&instance)?;
                Ok(instance::PublishResult {
                    needs_confirm: false,
                    embedded: Vec::new(),
                    share: Some(share),
                })
            }
            Err(e) if e.is_cancelled() => {
                Ok(instance::PublishResult {
                    needs_confirm: false,
                    embedded: Vec::new(),
                    share: self.instances().get(instance_id)?.share,
                })
            }
            Err(e) => Err(e),
        }
    }

    pub fn relink_share(
        &self,
        instance_id: &str,
        repo_url: &str,
    ) -> Result<instance::PackShare> {
        let mut instance = self.instances().get(instance_id)?;
        if instance.modpack_locked {
            return Err(CoreError::Modpack(
                "this modpack is locked — unlock it to share".to_string(),
            ));
        }
        let provider = forge::detect(repo_url).ok_or_else(|| {
            CoreError::Modpack("unsupported git host (expected GitHub or GitLab)".to_string())
        })?;
        let f = forge::get(provider);
        let token = self.require_forge_token(provider)?;
        let (owner, repo) = f.parse_repo_url(repo_url).ok_or_else(|| {
            CoreError::Modpack(format!("not a valid {} repository URL", provider.label()))
        })?;
        let branch = f
            .repo_default_branch(&token, &owner, &repo)
            .unwrap_or_else(|_| "main".to_string());
        let cfg_url = f.raw_url(&owner, &repo, &branch, "brassworks.share.json");
        let text = forge::fetch_text(&cfg_url).map_err(|_| {
            CoreError::Modpack(
                "this repository wasn't shared from Brassworks (no share config found)".to_string(),
            )
        })?;
        let shared: SharedConfigFile =
            serde_json::from_str(&text).map_err(|e| CoreError::serde("share config", e))?;
        let SharedConfigFile { mut config, params } = shared;
        config.id = String::new();
        let saved = self.save_export_config(instance_id, config)?;
        apply_shared_params(&mut instance, &params);
        let share = instance::PackShare {
            repo_owner: owner.clone(),
            repo_name: repo.clone(),
            repo_url: f.web_url(&owner, &repo),
            branch: branch.clone(),
            pack_url: f.raw_url(&owner, &repo, &branch, "pack.toml"),
            config_id: saved.id,
            created_at: chrono::Utc::now(),
            last_published: None,
            published_version: None,
            published_index_hash: None,
            published_signature: None,
            incomplete: false,
            provider,
            published_params: params.clone(),
            params,
        };
        instance.share = Some(share.clone());
        self.instances().update(&instance)?;
        Ok(share)
    }

    pub fn sync_from_shared(
        &self,
        instance_id: &str,
        cancel: &dyn Fn() -> bool,
        on_progress: &mut ProgressSink,
    ) -> Result<()> {
        let instance = self.instances().get(instance_id)?;
        let share = instance
            .share
            .clone()
            .ok_or_else(|| CoreError::Modpack("this instance is not shared".to_string()))?;
        let config = export::load_configs(&self.paths, instance_id)
            .into_iter()
            .find(|c| c.id == share.config_id);
        let unsup = config.as_ref().map(|c| c.unsup).unwrap_or(false);
        let public_key = if unsup && config.as_ref().map(|c| c.sign).unwrap_or(false) {
            let fmt = config
                .as_ref()
                .map(|c| c.sign_format.clone())
                .unwrap_or_default();
            let fmt = if fmt.is_empty() { "signify" } else { &fmt };
            Some(self.unsup_public_key(instance_id, fmt))
        } else {
            None
        };
        self.modpack_for(instance_id)
            .with_pack(share.pack_url.clone(), unsup, public_key)
            .sync(true, cancel, &mut Self::modpack_sink(instance_id, on_progress))?;
        Ok(())
    }

    pub fn share_pending_changes(&self, instance_id: &str) -> Result<bool> {
        let instance = self.instances().get(instance_id)?;
        let Some(share) = &instance.share else {
            return Ok(false);
        };
        let Some(published) = share.last_published else {
            return Ok(true);
        };
        let config = export::load_configs(&self.paths, instance_id)
            .into_iter()
            .find(|c| c.id == share.config_id);
        if let (Some(pub_sig), Some(config)) = (&share.published_signature, &config) {
            let mut config = config.clone();
            config.version = shared_build_version(share, &config);
            let current = self.publish_signature(&instance, &config, &share.params)?;
            return Ok(&current != pub_sig);
        }
        if share.params != share.published_params {
            return Ok(true);
        }
        let game = self.paths.instance_game_dir(instance_id);
        let newest = ["mods", "config", "defaultconfigs", "kubejs", "scripts"]
            .iter()
            .filter_map(|d| newest_mtime(&game.join(d)))
            .max();
        let published = std::time::SystemTime::from(published);
        Ok(newest.map(|t| t > published).unwrap_or(false))
    }
    fn publish_signature(
        &self,
        instance: &instance::Instance,
        config: &export::ExportConfig,
        params: &instance::SharePackParams,
    ) -> Result<String> {
        let out = self.build_publish_files(instance, config)?;
        Ok(files_signature(&out.files, params))
    }

    fn active_mc_username(&self) -> Option<String> {
        self.accounts()
            .ok()
            .and_then(|s| s.active().map(|a| a.username.clone()))
            .filter(|u| !u.trim().is_empty())
    }

    fn pack_share_descriptor(
        &self,
        instance: &instance::Instance,
        pack_url: &str,
        config: Option<&export::ExportConfig>,
    ) -> PackwizShare {
        let unsup = config.map(|c| c.unsup).unwrap_or(false);
        let signing_key = if unsup && config.map(|c| c.sign).unwrap_or(false) {
            let fmt = config.map(|c| c.sign_format.clone()).unwrap_or_default();
            let fmt = if fmt.is_empty() { "signify" } else { &fmt };
            Some(self.unsup_public_key(&instance.id, fmt))
        } else {
            None
        };
        let has_icon = instance
            .icon
            .as_deref()
            .map(|i| !i.is_empty() && !i.starts_with("builtin:"))
            .unwrap_or(false);
        let icon = if has_icon {
            pack_url
                .rsplit_once('/')
                .map(|(base, _)| format!("{base}/icon.png"))
        } else {
            None
        };
        let p = instance.share.as_ref().map(|s| s.params.clone()).unwrap_or_default();
        let author = p
            .author
            .clone()
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty());
        PackwizShare {
            pack_url: pack_url.to_string(),
            name: Some(instance.name.clone()),
            description: p.description.filter(|d| !d.trim().is_empty()),
            unsup,
            shared_by: author.or_else(|| self.active_mc_username()),
            icon,
            signing_key,
            news_url: p.news_url.filter(|u| !u.trim().is_empty()),
            playercount_url: p.playercount_url.filter(|u| !u.trim().is_empty()),
            min_memory_mb: p.min_memory_mb,
            max_memory_mb: p.max_memory_mb,
            jvm_args: (!p.jvm_args.is_empty()).then_some(p.jvm_args),
            ..Default::default()
        }
    }

    fn build_pack_share(&self, instance: &instance::Instance) -> Result<PackwizShare> {
        let share = instance
            .share
            .as_ref()
            .ok_or_else(|| CoreError::Modpack("this instance is not shared".to_string()))?;
        let config = export::load_configs(&self.paths, &instance.id)
            .into_iter()
            .find(|c| c.id == share.config_id);
        Ok(self.pack_share_descriptor(instance, &share.pack_url, config.as_ref()))
    }

    pub fn share_link(&self, instance_id: &str) -> Result<String> {
        let instance = self.instances().get(instance_id)?;
        let s = self.build_pack_share(&instance)?;
        install_link(&s)
    }

    pub fn write_share_file(&self, instance_id: &str) -> Result<String> {
        let instance = self.instances().get(instance_id)?;
        let s = self.build_pack_share(&instance)?;
        let json =
            serde_json::to_vec_pretty(&s).map_err(|e| CoreError::serde("packwiz share", e))?;
        let safe = export::sanitize_filename(&instance.name);
        let dir = dirs::download_dir().unwrap_or_else(|| self.paths.root().to_path_buf());
        let mut dest = dir.join(format!("{safe}.packwiz"));
        let mut n = 1;
        while dest.exists() {
            dest = dir.join(format!("{safe} ({n}).packwiz"));
            n += 1;
        }
        std::fs::write(&dest, json).map_err(|e| CoreError::io(&dest, e))?;
        Ok(dest.to_string_lossy().into_owned())
    }

    /// Write an exported file to the user's Downloads folder, de-duplicating the
    /// name if it already exists. Returns the full path written.
    pub fn write_download_file(&self, stem: &str, ext: &str, contents: &[u8]) -> Result<String> {
        let safe = export::sanitize_filename(stem);
        let safe = if safe.is_empty() { "export".to_string() } else { safe };
        let dir = dirs::download_dir().unwrap_or_else(|| self.paths.root().to_path_buf());
        let mut dest = dir.join(format!("{safe}.{ext}"));
        let mut n = 1;
        while dest.exists() {
            dest = dir.join(format!("{safe} ({n}).{ext}"));
            n += 1;
        }
        std::fs::write(&dest, contents).map_err(|e| CoreError::io(&dest, e))?;
        Ok(dest.to_string_lossy().into_owned())
    }

    pub fn disconnect_share(&self, instance_id: &str) -> Result<()> {
        let mut instance = self.instances().get(instance_id)?;
        if let Some(share) = instance.share.take() {
            let _ = export::delete_config(&self.paths, instance_id, &share.config_id);
        }
        let _ = std::fs::remove_dir_all(self.paths.instance_dir(instance_id).join("share-repo"));
        self.instances().update(&instance)
    }

    pub fn share_params(&self, instance_id: &str) -> Result<instance::SharePackParams> {
        Ok(self
            .instances()
            .get(instance_id)?
            .share
            .map(|s| s.params)
            .unwrap_or_default())
    }

    pub fn set_share_params(
        &self,
        instance_id: &str,
        params: instance::SharePackParams,
    ) -> Result<()> {
        let mut instance = self.instances().get(instance_id)?;
        if let Some(share) = instance.share.as_mut() {
            share.params = params;
            self.instances().update(&instance)?;
        }
        Ok(())
    }

    pub fn share_repo_info(&self, instance_id: &str) -> Result<ShareRepoInfo> {
        let instance = self.instances().get(instance_id)?;
        let share = instance
            .share
            .as_ref()
            .ok_or_else(|| CoreError::Modpack("this instance is not shared".to_string()))?;
        let token = self.require_forge_token(share.provider)?;
        let stats =
            forge::get(share.provider).repo_stats(&token, &share.repo_owner, &share.repo_name)?;
        let work_dir = self.paths.instance_dir(instance_id).join("share-repo");
        Ok(ShareRepoInfo {
            size_kb: stats.size_kb,
            pushed_at: stats.pushed_at,
            html_url: stats.html_url,
            default_branch: stats.default_branch,
            private: stats.private,
            stargazers: stats.stargazers,
            forks: stats.forks,
            file_count: forge::local_head_file_count(&work_dir),
        })
    }

    pub fn share_diff(&self, instance_id: &str) -> Result<Vec<ShareDiffEntry>> {
        let instance = self.instances().get(instance_id)?;
        let share = instance
            .share
            .clone()
            .ok_or_else(|| CoreError::Modpack("this instance is not shared".to_string()))?;
        let token = self.require_forge_token(share.provider)?;
        let mut config = export::load_configs(&self.paths, instance_id)
            .into_iter()
            .find(|c| c.id == share.config_id)
            .ok_or_else(|| CoreError::Modpack("share config not found".to_string()))?;
        config.version = shared_build_version(&share, &config);

        let out = self.build_publish_files(&instance, &config)?;
        let mut current: std::collections::HashMap<String, String> = out
            .files
            .iter()
            .filter(|(p, _)| !is_share_meta(p))
            .map(|(p, b)| (p.clone(), packwiz::sha256_hex(b)))
            .collect();

        let work_dir = self.paths.instance_dir(instance_id).join("share-repo");
        let repo = forge::open_synced(
            forge::get(share.provider),
            &token,
            &share.repo_owner,
            &share.repo_name,
            &share.branch,
            &work_dir,
        )?;
        let published: std::collections::HashMap<String, String> = forge::head_file_hashes(&repo)?
            .into_iter()
            .filter(|(p, _)| !is_share_meta(p))
            .collect();

        let mut entries = Vec::new();
        for (path, hash) in &current {
            match published.get(path) {
                None => entries.push(ShareDiffEntry {
                    path: path.clone(),
                    status: "added".to_string(),
                }),
                Some(ph) if ph != hash => entries.push(ShareDiffEntry {
                    path: path.clone(),
                    status: "modified".to_string(),
                }),
                _ => {}
            }
        }
        for path in published.keys() {
            if !current.contains_key(path) {
                entries.push(ShareDiffEntry {
                    path: path.clone(),
                    status: "removed".to_string(),
                });
            }
        }
        current.clear();
        if share.params != share.published_params {
            entries.push(ShareDiffEntry {
                path: PACK_SETTINGS_DIFF_PATH.to_string(),
                status: "modified".to_string(),
            });
        }
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(entries)
    }


    pub fn list_worlds(&self, instance_id: &str) -> Vec<WorldInfo> {
        let stars = stars::load(&self.paths, instance_id);
        let mut worlds = saves::list_worlds(&self.paths.instance_saves_dir(instance_id));
        for w in worlds.iter_mut() {
            w.starred = stars.contains(StarKind::Worlds, &w.folder);
        }
        worlds
    }

    pub fn world_icon_path(&self, instance_id: &str, folder: &str) -> Option<String> {
        saves::world_icon_path(&self.paths.instance_saves_dir(instance_id), folder)
            .map(|p| p.to_string_lossy().into_owned())
    }

    pub fn delete_world(&self, instance_id: &str, folder: &str) -> Result<()> {
        saves::delete_world(&self.paths.instance_saves_dir(instance_id), folder)
    }

    pub fn backup_world(&self, instance_id: &str, world: &str) -> Result<String> {
        saves::backup_world(
            &self.paths.instance_saves_dir(instance_id),
            &self.paths.instance_game_dir(instance_id),
            world,
        )
    }

    pub fn list_world_backups(&self, instance_id: &str) -> Vec<WorldBackup> {
        saves::list_backups(&self.paths.instance_game_dir(instance_id))
    }

    pub fn export_world(&self, instance_id: &str, world: &str) -> Result<String> {
        let bytes = saves::zip_world(&self.paths.instance_saves_dir(instance_id), world)?;
        let safe: String = world
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .collect();
        let dir = dirs::download_dir().unwrap_or_else(|| self.paths.root().to_path_buf());
        let dest = dir.join(format!("{}.zip", safe.trim_matches('-')));
        std::fs::write(&dest, bytes).map_err(|e| CoreError::io(&dest, e))?;
        Ok(dest.to_string_lossy().into_owned())
    }

    pub fn list_datapacks(&self, instance_id: &str, world: &str) -> Vec<DatapackInfo> {
        saves::list_datapacks(
            &self.paths.instance_saves_dir(instance_id),
            world,
            &self.paths.datapacks_index(instance_id),
        )
    }

    pub fn set_datapack_enabled(
        &self,
        instance_id: &str,
        world: &str,
        filename: &str,
        enabled: bool,
    ) -> Result<()> {
        saves::set_datapack_enabled(
            &self.paths.instance_saves_dir(instance_id),
            world,
            filename,
            enabled,
        )
    }

    pub fn remove_datapack(&self, instance_id: &str, world: &str, filename: &str) -> Result<()> {
        saves::remove_datapack(
            &self.paths.instance_saves_dir(instance_id),
            world,
            filename,
            &self.paths.datapacks_index(instance_id),
        )
    }

    pub fn install_datapack(
        &self,
        instance_id: &str,
        world: &str,
        source: &str,
        project_id: &str,
        version_id: Option<&str>,
    ) -> Result<String> {
        let saves_dir = self.paths.instance_saves_dir(instance_id);
        let index_file = self.paths.datapacks_index(instance_id);
        let previous = saves::tracked_filename(&index_file, world, project_id);

        let modpack = self.modpack_for(instance_id);
        let (filename, resolved_vid) =
            modpack.install_datapack(world, source, project_id, version_id)?;
        if let Some(old) = previous {
            if old != filename {
                let _ = saves::remove_datapack(&saves_dir, world, &old, &index_file);
            }
        }

        let detail = modpack.project_detail(project_id, source).ok();
        let _ = saves::record_datapack(
            &index_file,
            world,
            source,
            project_id,
            &resolved_vid,
            &filename,
            detail.as_ref().map(|d| d.title.clone()),
            detail.as_ref().map(|d| d.description.clone()),
            detail.as_ref().and_then(|d| d.icon_url.clone()),
        );
        Ok(filename)
    }

    pub fn list_servers(&self, instance_id: &str) -> Vec<ServerEntry> {
        let stars = stars::load(&self.paths, instance_id);
        let mut servers = saves::read_servers(&self.paths.instance_servers_file(instance_id));
        let featured_enabled = self.settings().map(|s| s.show_featured).unwrap_or(true);
        if featured_enabled
            && self.instances().get(instance_id).map(|i| i.featured).unwrap_or(false)
        {
            if let Some(fs) = featured::featured_packs()
                .into_iter()
                .find(|f| f.id == instance_id)
                .and_then(|f| f.server)
            {
                                                                                servers.retain(|s| !server_ip_eq(&s.ip, &fs.ip));
                servers.insert(
                    0,
                    ServerEntry {
                        name: fs.name,
                        ip: fs.ip,
                        icon: None,
                        accept_textures: None,
                        featured: true,
                        starred: false,
                    },
                );
            }
        }
        for s in servers.iter_mut() {
            s.starred =
                s.featured || stars.contains(StarKind::Servers, &saves::server_key(&s.name, &s.ip));
        }
        servers
    }

    pub fn save_servers(&self, instance_id: &str, entries: &[ServerEntry]) -> Result<()> {
        saves::write_servers(&self.paths.instance_servers_file(instance_id), entries)
    }

    pub fn ping_server(&self, address: &str) -> ServerStatus {
        ping::ping(address)
    }

    pub fn toggle_star(&self, instance_id: &str, kind: &str, key: &str) -> Result<bool> {
        let kind = StarKind::parse(kind)
            .ok_or_else(|| CoreError::Modpack(format!("unknown star kind: {kind}")))?;
        stars::toggle(&self.paths, instance_id, kind, key)
    }

    pub fn screenshot_stars(&self, instance_id: &str) -> Vec<String> {
        stars::load(&self.paths, instance_id).screenshots
    }

    pub fn update_selected_content(
        &self,
        instance_id: &str,
        keys: &[String],
    ) -> Result<Vec<String>> {
        self.modpack_for(instance_id).update_selected(keys)
    }

    pub fn modpack_locked(&self, instance_id: &str) -> bool {
        self.instances()
            .get(instance_id)
            .map(|i| i.modpack_locked)
            .unwrap_or(true)
    }

    pub fn set_modpack_locked(&self, instance_id: &str, locked: bool) -> Result<()> {
        let mut instance = self.instances().get(instance_id)?;
        instance.modpack_locked = locked;
        self.instances().update(&instance)?;
        if locked {
            let _ = self.modpack_for(instance_id).relock_reconcile();
        }
        Ok(())
    }

    pub fn read_log(&self, instance_id: &str) -> String {
        let log = self
            .paths
            .instance_game_dir(instance_id)
            .join("logs")
            .join("latest.log");
        std::fs::read_to_string(&log).unwrap_or_default()
    }

                        pub fn tail_log(&self, instance_id: &str, offset: u64) -> LogTail {
        let log = self
            .paths
            .instance_game_dir(instance_id)
            .join("logs")
            .join("latest.log");
        tail_file(&log, offset)
    }

    pub fn upload_log(&self, instance_id: &str) -> Result<LogUpload> {
        let log = self
            .paths
            .instance_game_dir(instance_id)
            .join("logs")
            .join("latest.log");
        let content = std::fs::read_to_string(&log).map_err(|e| CoreError::io(&log, e))?;
        upload_log(&content)
    }

    pub fn java_report(&self, instance_id: &str) -> JavaReport {
        let mc = self
            .instances()
            .get(instance_id)
            .map(|i| i.minecraft_version)
            .unwrap_or_else(|_| "1.21.1".to_string());
        let settings = self.settings().unwrap_or_default();
        JavaReport {
            system: java::detect_system(),
            runtimes: java::list_runtimes(&self.paths.jvm_dir()),
            required_major: java::major_for_minecraft(&mc),
            policy: settings.java_policy,
            custom_path: settings.java_path,
        }
    }

    pub fn cache_size(&self) -> u64 {
        [
            self.paths.modrinth_cache_dir(),
            self.paths.curseforge_cache_dir(),
            self.paths.image_cache_dir(),
        ]
        .iter()
        .map(|d| dir_size(d))
        .sum()
    }

    pub fn clear_cache(&self) -> Result<()> {
        for dir in [
            self.paths.modrinth_cache_dir(),
            self.paths.curseforge_cache_dir(),
            self.paths.image_cache_dir(),
        ] {
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
            }
        }
        Ok(())
    }

    pub fn cache_images(&self, values: &[String]) {
        let dir = self.paths.image_cache_dir();
        for value in values {
            if value.trim().is_empty() {
                continue;
            }
            let _ = image_cache::cache_image(&dir, value);
        }
    }

    pub fn cached_image(&self, value: &str) -> Option<std::path::PathBuf> {
        image_cache::cached_image(&self.paths.image_cache_dir(), value)
    }

    pub fn add_playtime(&self, instance_id: &str, seconds: u64) -> Result<()> {
        let mut instance = self.instances().get(instance_id)?;
        instance.playtime_seconds = instance.playtime_seconds.saturating_add(seconds);
        self.instances().update(&instance)
    }

    fn modpack_sink<'a>(
        instance_id: &'a str,
        on_progress: &'a mut ProgressSink,
    ) -> impl FnMut(SyncProgress) + 'a {
        move |sp: SyncProgress| {
            let stage = match sp.stage {
                SyncStage::Fetching => LaunchStage::CheckingUpdates,
                _ => LaunchStage::SyncingModpack,
            };
            let mut p = LaunchProgress::new(instance_id, stage, sp.message);
            if sp.total > 0 {
                p = p.with_progress(sp.current, sp.total);
            }
            (on_progress)(p);
        }
    }
}

fn read_zip_icon(bytes: &[u8]) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?;
    let mut file = archive.by_name("icon.png").ok()?;
    let mut out = Vec::new();
    file.read_to_end(&mut out).ok()?;
    Some(out)
}

fn is_share_meta(p: &str) -> bool {
    p == "README.md"
        || p == "brassworks.share.json"
        || p == "SHARE-LINK.txt"
        || p.ends_with(".packwiz")
}

fn files_signature(files: &[(String, Vec<u8>)], params: &instance::SharePackParams) -> String {
    let mut parts: Vec<(String, String)> = files
        .iter()
        .filter(|(p, _)| !is_share_meta(p))
        .map(|(p, b)| (p.clone(), packwiz::sha256_hex(b)))
        .collect();
    parts.sort();
    let mut buf = String::new();
    for (p, h) in parts {
        buf.push_str(&p);
        buf.push('\0');
        buf.push_str(&h);
        buf.push('\n');
    }
    buf.push_str("\0params\0");
    buf.push_str(&serde_json::to_string(params).unwrap_or_default());
    packwiz::sha256_hex(buf.as_bytes())
}

fn extract_packwiz_zip(bytes: &[u8], dest: &std::path::Path) -> Result<String> {
    use std::io::{Read, Write};
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| CoreError::Modpack(format!("not a valid zip: {e}")))?;
    let mut pack_rel: Option<String> = None;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| CoreError::Modpack(format!("zip entry: {e}")))?;
        if entry.is_dir() {
            continue;
        }
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let out_path = dest.join(&rel);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
        }
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|e| CoreError::io(&out_path, e))?;
        std::fs::File::create(&out_path)
            .and_then(|mut f| f.write_all(&buf))
            .map_err(|e| CoreError::io(&out_path, e))?;
        if rel_str == "pack.toml" || rel_str.ends_with("/pack.toml") {
            let depth = rel_str.matches('/').count();
            let replace = pack_rel
                .as_ref()
                .map(|p| p.matches('/').count() > depth)
                .unwrap_or(true);
            if replace {
                pack_rel = Some(rel_str);
            }
        }
    }
    pack_rel.ok_or_else(|| CoreError::Modpack("no pack.toml found in the zip".to_string()))
}

fn loader_from_pack(pack: &packwiz::Pack) -> (LoaderKind, LoaderVersion) {
    let ver = |v: &String| {
        if v.trim().is_empty() {
            LoaderVersion::Stable
        } else {
            LoaderVersion::Exact(v.clone())
        }
    };
    if let Some(v) = &pack.versions.neoforge {
        (LoaderKind::NeoForge, ver(v))
    } else if let Some(v) = &pack.versions.forge {
        (LoaderKind::Forge, ver(v))
    } else if let Some(v) = &pack.versions.fabric {
        (LoaderKind::Fabric, ver(v))
    } else if let Some(v) = &pack.versions.quilt {
        (LoaderKind::Quilt, ver(v))
    } else {
        (LoaderKind::Vanilla, LoaderVersion::Stable)
    }
}

fn server_ip_eq(a: &str, b: &str) -> bool {
    fn norm(s: &str) -> String {
        let s = s.trim().to_ascii_lowercase();
        s.strip_suffix(":25565").unwrap_or(&s).to_string()
    }
    norm(a) == norm(b)
}

fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0;
    if let Ok(read) = std::fs::read_dir(path) {
        for entry in read.flatten() {
            match entry.file_type() {
                Ok(ft) if ft.is_dir() => total += dir_size(&entry.path()),
                Ok(ft) if ft.is_file() => {
                    total += entry.metadata().map(|m| m.len()).unwrap_or(0)
                }
                _ => {}
            }
        }
    }
    total
}

fn read_json_or_default<T>(path: &std::path::Path, what: &str) -> Result<T>
where
    T: serde::de::DeserializeOwned + Default,
{
    match std::fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| CoreError::serde(what, e))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(CoreError::io(path, e)),
    }
}

fn write_json<T: serde::Serialize>(
    path: &std::path::Path,
    value: &T,
    what: &str,
) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
    }
    let json = serde_json::to_vec_pretty(value).map_err(|e| CoreError::serde(what, e))?;
    std::fs::write(path, json).map_err(|e| CoreError::io(path, e))
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct LogTail {
        pub content: String,
        pub offset: u64,
            pub reset: bool,
}

fn tail_file(path: &std::path::Path, offset: u64) -> LogTail {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else {
                        return LogTail { content: String::new(), offset: 0, reset: offset != 0 };
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let (start, reset) = if offset > len { (0, true) } else { (offset, false) };
    if f.seek(SeekFrom::Start(start)).is_err() {
        return LogTail { content: String::new(), offset: len, reset: true };
    }
    let mut buf = Vec::new();
    let n = f.read_to_end(&mut buf).unwrap_or(0);
    LogTail {
        content: String::from_utf8_lossy(&buf).into_owned(),
        offset: start + n as u64,
        reset,
    }
}

fn unique_folder_id(settings: &LauncherSettings, name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let slug = slug.trim_matches('-');
    let base = if slug.is_empty() { "folder" } else { slug };
    let mut id = format!("f-{base}");
    let mut n = 1;
    while settings.instance_folders.iter().any(|f| f.id == id) {
        id = format!("f-{base}-{n}");
        n += 1;
    }
    id
}

#[cfg(test)]
mod share_link_tests {
    use super::{install_link, share_readme, PackwizShare};

    #[test]
    fn install_link_carries_query() {
        let share = PackwizShare {
            pack_url: "https://raw.githubusercontent.com/swzo/my-pack/main/pack.toml".to_string(),
            name: Some("My SMP".to_string()),
            unsup: true,
            signing_key: Some("signify ABC123".to_string()),
            description: Some("A cozy pack".to_string()),
            min_memory_mb: Some(2048),
            max_memory_mb: Some(6144),
            jvm_args: Some(vec!["-XX:+UseG1GC".to_string(), "-Dfoo=bar".to_string()]),
            news_url: Some("https://example.com/news.json".to_string()),
            ..Default::default()
        };
        let link = install_link(&share).unwrap();
        assert!(link.starts_with("https://brassworks.opnsoc.org/install?"));
        assert!(link.contains("pack_url=https%3A%2F%2Fraw.githubusercontent.com"));
        assert!(link.contains("name=My+SMP"));
        assert!(link.contains("unsup=true"));
        assert!(link.contains("signing_key=signify+ABC123"));

        let url = reqwest::Url::parse(&link).unwrap();
        let parsed = PackwizShare::from_query_pairs(url.query_pairs()).unwrap();
        assert_eq!(parsed.pack_url, share.pack_url);
        assert!(parsed.unsup);
        assert_eq!(parsed.signing_key.as_deref(), Some("signify ABC123"));
        assert_eq!(parsed.description.as_deref(), Some("A cozy pack"));
        assert_eq!(parsed.min_memory_mb, Some(2048));
        assert_eq!(parsed.max_memory_mb, Some(6144));
        assert_eq!(parsed.jvm_args.as_deref().map(|a| a.len()), Some(2));
        assert_eq!(parsed.news_url.as_deref(), Some("https://example.com/news.json"));
    }

    #[test]
    fn readme_mentions_pack_url() {
        use crate::instance::{Instance, LoaderKind, LoaderVersion, PackSource};
        let inst = Instance::new_custom(
            "id",
            "My SMP",
            "1.21.1",
            LoaderKind::Fabric,
            LoaderVersion::Stable,
            PackSource::None,
        );
        let r = share_readme(
            &inst,
            "https://github.com/swzo/my-pack",
            "https://x/pack.toml",
            "main",
            true,
            Some("Steve"),
            "https://brassworks.opnsoc.org/install?pack_url=x",
        );
        assert!(r.contains("My SMP"));
        assert!(r.contains("https://x/pack.toml"));
        assert!(r.contains("icon.png"));
        assert!(r.contains("Steve"));
        assert!(r.contains("install?pack_url=x"));
    }
}

#[cfg(test)]
mod shared_config_file_tests {
    use super::{export, SharedConfigFile};

    fn sample_config() -> export::ExportConfig {
        export::ExportConfig {
            id: "c1".to_string(),
            name: "Shared".to_string(),
            format: export::ExportFormat::Packwiz,
            pack_name: "Pack".to_string(),
            author: String::new(),
            version: "1.0.0".to_string(),
            selection: export::ExportSelection::default(),
            created_at: 0,
            unsup: false,
            sign: false,
            sign_format: String::new(),
        }
    }

    #[test]
    fn legacy_bare_config_parses_with_default_params() {
        let json = serde_json::to_string(&sample_config()).unwrap();
        let parsed: SharedConfigFile = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.config.name, "Shared");
        assert!(parsed.params.jvm_args.is_empty());
        assert!(parsed.params.description.is_none());
    }

    #[test]
    fn new_file_still_parses_as_bare_config_and_roundtrips_params() {
        let file = SharedConfigFile {
            config: sample_config(),
            params: crate::instance::SharePackParams {
                description: Some("cozy".to_string()),
                jvm_args: vec!["-XX:+UseG1GC".to_string()],
                max_memory_mb: Some(6144),
                ..Default::default()
            },
        };
        let json = serde_json::to_string(&file).unwrap();
        let as_cfg: export::ExportConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(as_cfg.name, "Shared");
        let back: SharedConfigFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.params.description.as_deref(), Some("cozy"));
        assert_eq!(back.params.max_memory_mb, Some(6144));
        assert_eq!(back.params.jvm_args.len(), 1);
    }
}

#[cfg(test)]
mod packwiz_import_tests {
    use super::extract_packwiz_zip;
    use std::io::Write;

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            for (name, bytes) in entries {
                w.start_file(*name, opts).unwrap();
                w.write_all(bytes).unwrap();
            }
            w.finish().unwrap();
        }
        buf
    }

    #[test]
    fn extracts_files_and_finds_root_pack_toml() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out");
        let bytes = zip_with(&[
            ("pack.toml", b"name = \"x\""),
            ("index.toml", b"hash-format = \"sha256\""),
            ("mods/a.pw.toml", b"name = \"a\""),
            ("nested/pack.toml", b"name = \"deep\""),
        ]);
        let rel = extract_packwiz_zip(&bytes, &dest).unwrap();
        assert_eq!(rel, "pack.toml");
        assert!(dest.join("mods/a.pw.toml").exists());
        assert!(dest.join("index.toml").exists());
    }

    #[test]
    fn errors_when_no_pack_toml() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = zip_with(&[("readme.txt", b"hi")]);
        assert!(extract_packwiz_zip(&bytes, &dir.path().join("out")).is_err());
    }

    #[test]
    fn read_zip_icon_extracts_root_icon() {
        use super::read_zip_icon;
        let with = zip_with(&[("manifest.json", b"{}"), ("icon.png", b"PNGDATA")]);
        assert_eq!(read_zip_icon(&with).as_deref(), Some(&b"PNGDATA"[..]));
        let without = zip_with(&[("modrinth.index.json", b"{}")]);
        assert!(read_zip_icon(&without).is_none());
    }
}
