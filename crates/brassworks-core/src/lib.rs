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
pub mod instance;
pub mod launch;
pub mod modpack;
pub mod paths;
pub mod progress;
pub mod remote;
pub mod settings;

use std::process::Child;

pub use account::{Account, AccountKind, AccountStore};
pub use auth::MicrosoftCode;
pub use error::{CoreError, Result};
pub use instance::{Instance, InstanceManager, LoaderKind, LoaderVersion};
pub use launch::{launch_instance, LaunchRequest};
pub use modpack::{
    ContentVersion, InstalledMod, ModInfo, Modpack, ModpackStatus, ProjectDetail,
};
pub use packwiz::SearchHit;
pub use paths::Paths;
pub use progress::{LaunchProgress, LaunchStage, ProgressSink};
pub use remote::{news, player_count, upload_log, LogUpload, NewsItem, PlayerCount, PlayerGroup};
pub use settings::LauncherSettings;

use packwiz::{SyncProgress, SyncStage};

use portablemc::msa::{self, Auth};

#[derive(Debug, Clone)]
pub struct Launcher {
    paths: Paths,
}

impl Launcher {
    pub fn new() -> Result<Self> {
        let paths = Paths::default()?;
        paths.ensure_base()?;
        Ok(Self { paths })
    }

    pub fn with_root(root: impl Into<std::path::PathBuf>) -> Result<Self> {
        let paths = Paths::with_root(root);
        paths.ensure_base()?;
        Ok(Self { paths })
    }

    pub fn paths(&self) -> &Paths {
        &self.paths
    }

    pub fn instances(&self) -> InstanceManager {
        InstanceManager::new(self.paths.clone())
    }

    pub fn bootstrap(&self) -> Result<Instance> {
        self.instances().ensure_default()
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
        cancel: &dyn Fn() -> bool,
        on_progress: &mut ProgressSink,
    ) -> Result<Child> {
        let instance = self.instances().get(instance_id)?;
        let accounts = self.accounts()?;
        let account = accounts.active().ok_or(CoreError::NoAccount)?.clone();
        let settings = self.settings()?;

        let child = launch_instance(
            LaunchRequest {
                paths: &self.paths,
                instance: &instance,
                account: &account,
                settings: &settings,
            },
            cancel,
            on_progress,
        )?;

        let mut updated = instance;
        updated.last_played = Some(chrono::Utc::now());
        let _ = self.instances().update(&updated);

        Ok(child)
    }


    fn modpack_for(&self, instance_id: &str) -> Modpack<'_> {
        let url = self
            .settings()
            .map(|s| modpack::resolve_pack_url(&s))
            .unwrap_or_else(|_| modpack::PACK_URL.to_string());
        Modpack::with_url(&self.paths, instance_id, url)
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
        Ok(())
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

    pub fn list_mods(&self, instance_id: &str) -> Result<Vec<InstalledMod>> {
        self.modpack_for(instance_id).list_mods()
    }

    pub fn mod_info(
        &self,
        instance_id: &str,
        modrinth_id: &str,
        version_id: Option<&str>,
    ) -> ModInfo {
        self.modpack_for(instance_id).mod_info(modrinth_id, version_id)
    }

    pub fn set_content_enabled(
        &self,
        instance_id: &str,
        path: &str,
        enabled: bool,
    ) -> Result<()> {
        let unlocked = !self.modpack_locked();
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
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        self.modpack_for(instance_id).search(query, project_type, offset)
    }

    pub fn content_detail(
        &self,
        instance_id: &str,
        project_id: &str,
    ) -> Result<modpack::ProjectDetail> {
        self.modpack_for(instance_id).project_detail(project_id)
    }

    pub fn content_versions(
        &self,
        instance_id: &str,
        project_id: &str,
        project_type: &str,
    ) -> Result<Vec<modpack::ContentVersion>> {
        self.modpack_for(instance_id)
            .list_versions(project_id, project_type)
    }

    pub fn install_content(
        &self,
        instance_id: &str,
        project_id: &str,
        project_type: &str,
    ) -> Result<InstalledMod> {
        self.modpack_for(instance_id)
            .install_from_modrinth(project_id, project_type)
    }

    pub fn install_content_version(
        &self,
        instance_id: &str,
        project_id: &str,
        version_id: &str,
        project_type: &str,
    ) -> Result<InstalledMod> {
        let unlocked = !self.modpack_locked();
        self.modpack_for(instance_id)
            .install_version(project_id, version_id, project_type, unlocked)
    }

    pub fn modpack_locked(&self) -> bool {
        self.settings().map(|s| s.modpack_locked).unwrap_or(true)
    }

    pub fn set_modpack_locked(&self, instance_id: &str, locked: bool) -> Result<()> {
        let mut settings = self.settings()?;
        settings.modpack_locked = locked;
        self.save_settings(&settings)?;
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

    pub fn upload_log(&self, instance_id: &str) -> Result<LogUpload> {
        let log = self
            .paths
            .instance_game_dir(instance_id)
            .join("logs")
            .join("latest.log");
        let content = std::fs::read_to_string(&log).map_err(|e| CoreError::io(&log, e))?;
        upload_log(&content)
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
