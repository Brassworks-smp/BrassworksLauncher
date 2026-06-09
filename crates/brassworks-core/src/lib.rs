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
    ContentVersion, InstallResult, InstalledMod, ModInfo, Modpack, ModpackStatus, ProjectDetail,
};
pub use packwiz::SearchHit;
pub use paths::Paths;
pub use progress::{LaunchProgress, LaunchStage, ProgressSink};
pub use remote::{
    news, player_count, release_changelog, upload_log, LogUpload, NewsItem, PlayerCount,
    PlayerGroup,
};
pub use settings::LauncherSettings;

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
        let settings = self.settings().ok();
        let url = settings
            .as_ref()
            .map(modpack::resolve_pack_url)
            .unwrap_or_else(|| modpack::PACK_URL.to_string());
        let cf_key = settings
            .and_then(|s| s.curseforge_api_key)
            .filter(|k| !k.trim().is_empty())
            .unwrap_or_else(|| modpack::DEFAULT_CURSEFORGE_API_KEY.to_string());
        Modpack::with_url(&self.paths, instance_id, url).with_curseforge_key(Some(cf_key))
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
        source: &str,
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        self.modpack_for(instance_id)
            .search(query, project_type, source, offset)
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
        let unlocked = !self.modpack_locked();
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

    pub fn update_selected_content(
        &self,
        instance_id: &str,
        keys: &[String],
    ) -> Result<Vec<String>> {
        self.modpack_for(instance_id).update_selected(keys)
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
        ]
        .iter()
        .map(|d| dir_size(d))
        .sum()
    }

    pub fn clear_cache(&self) -> Result<()> {
        for dir in [
            self.paths.modrinth_cache_dir(),
            self.paths.curseforge_cache_dir(),
        ] {
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
            }
        }
        Ok(())
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
