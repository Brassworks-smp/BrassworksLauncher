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
pub mod featured;
pub mod instance;
pub mod launch;
pub mod modpack;
pub mod packs;
pub mod paths;
pub mod progress;
pub mod remote;
pub mod settings;
pub mod skins;
pub mod versions;

use std::process::Child;

pub use account::{Account, AccountKind, AccountStore};
pub use auth::MicrosoftCode;
pub use error::{CoreError, Result};
pub use featured::{featured_packs, FeaturedPack};
pub use instance::{Instance, InstanceManager, LoaderKind, LoaderVersion, PackSource};
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
pub use versions::{loader_versions, minecraft_versions, LoaderVersionInfo, McVersion};
pub use skins::{Cape, SavedSkin, SkinLibraryView, SkinProfile};
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
        let cf_key = self.cf_key();
        match self.instances().get(instance_id) {
            Ok(instance) => Modpack::for_instance(&self.paths, &instance, Some(cf_key)),
            Err(_) => Modpack::with_url(
                &self.paths,
                instance_id,
                modpack::PACK_URL.to_string(),
            )
            .with_curseforge_key(Some(cf_key)),
        }
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

    pub fn create_packwiz_instance(&self, name: &str, url: &str) -> Result<Instance> {
        let pack = packwiz::Installer::new().fetch_pack(url)?;
        let mc = pack
            .versions
            .minecraft
            .clone()
            .unwrap_or_else(|| "1.21.1".to_string());
        let (loader, loader_version) = if let Some(v) = &pack.versions.neoforge {
            (LoaderKind::NeoForge, LoaderVersion::Exact(v.clone()))
        } else if let Some(v) = &pack.versions.forge {
            (LoaderKind::Forge, LoaderVersion::Exact(v.clone()))
        } else if let Some(v) = &pack.versions.fabric {
            (LoaderKind::Fabric, LoaderVersion::Exact(v.clone()))
        } else if let Some(v) = &pack.versions.quilt {
            (LoaderKind::Quilt, LoaderVersion::Exact(v.clone()))
        } else {
            (LoaderKind::Vanilla, LoaderVersion::Stable)
        };
        let mgr = self.instances();
        let display = if name.trim().is_empty() {
            pack.name.clone()
        } else {
            name.to_string()
        };
        let id = mgr.unique_id(if display.is_empty() { "modpack" } else { &display });
        let inst = Instance::new_custom(
            &id,
            display,
            mc,
            loader,
            loader_version,
            PackSource::Packwiz {
                url: url.to_string(),
            },
        );
        mgr.create(inst)
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
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        if source == "curseforge" {
            Ok(self.cf_client().search_modpacks(query, 20, offset)?)
        } else {
            Ok(self.modrinth_client().search_modpacks(query, 20, offset)?)
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

    pub fn install_modpack(
        &self,
        source: &str,
        project_id: &str,
        version_id: &str,
        name: &str,
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
        mgr.create(instance.clone())?;
        on_created(&instance);

        let modrinth = self.modrinth_client();
        let cf = self.cf_client();
        match packs::sync_pack(&self.paths, &id, &pack, &modrinth, Some(&cf), cancel, progress) {
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
                instance.icon = if source == "curseforge" {
                    cf.project(project_id).and_then(|p| p.icon_url)
                } else {
                    modrinth.project(project_id).and_then(|p| p.icon_url)
                };
                mgr.update(&instance)?;
                Ok(instance)
            }
            Err(e) => {
                let _ = mgr.delete(&id);
                Err(e)
            }
        }
    }

    pub fn install_modpack_file(
        &self,
        file_path: &str,
        source: &str,
        name: &str,
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
        self.install_modpack_data(bytes, source, name, cancel, on_created, progress)
    }

    pub fn install_modpack_data(
        &self,
        bytes: Vec<u8>,
        source: &str,
        name: &str,
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
        mgr.create(instance.clone())?;
        on_created(&instance);

        let modrinth = self.modrinth_client();
        let cf = self.cf_client();
        match packs::install_file(&self.paths, &id, source, bytes, &modrinth, Some(&cf), cancel, progress)
        {
            Ok(res) => {
                instance.minecraft_version = res.minecraft_version;
                instance.loader = res.loader;
                instance.loader_version = res
                    .loader_version
                    .map(LoaderVersion::Exact)
                    .unwrap_or(LoaderVersion::Stable);
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

    pub fn set_cape(&self, account_id: &str, cape_id: Option<&str>) -> Result<()> {
        self.with_token(account_id, |t| skins::set_cape(t, cape_id))
    }

    fn skin_library(&self) -> skins::SkinLibrary {
        read_json_or_default(&self.paths.skins_index(), "skins").unwrap_or_default()
    }

    fn save_skin_library(&self, lib: &skins::SkinLibrary) -> Result<()> {
        write_json(&self.paths.skins_index(), lib, "skins")
    }

    /// `account_id`'s saved skins + selected id. Folds any legacy global skins
    /// into this account on first access (persisted best-effort).
    pub fn list_skins(&self, account_id: &str) -> skins::SkinLibraryView {
        let mut lib = self.skin_library();
        let had_legacy = !lib.skins.is_empty();
        let acct = lib.account_mut(account_id).clone();
        if had_legacy {
            let _ = self.save_skin_library(&lib);
        }
        skins::SkinLibraryView {
            skins: acct.skins,
            selected: acct.selected,
        }
    }

    /// Write a new texture file under the skins dir and return its path.
    fn write_skin_file(&self, bytes: &[u8]) -> Result<(String, String)> {
        let dir = self.paths.skins_dir();
        std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        let id = uuid::Uuid::new_v4().to_string();
        let file = dir.join(format!("{id}.png"));
        std::fs::write(&file, bytes).map_err(|e| CoreError::io(&file, e))?;
        Ok((id, file.to_string_lossy().to_string()))
    }

    pub fn save_skin(
        &self,
        account_id: &str,
        name: &str,
        bytes: &[u8],
        model: &str,
        cape_id: Option<&str>,
        source: Option<&str>,
    ) -> Result<skins::SavedSkin> {
        let (id, file) = self.write_skin_file(bytes)?;
        let saved = skins::SavedSkin {
            id,
            name: if name.trim().is_empty() {
                "Skin".to_string()
            } else {
                name.trim().to_string()
            },
            file,
            model: if model == "slim" { "slim" } else { "classic" }.to_string(),
            cape_id: cape_id.map(|c| c.to_string()),
            source: source.map(|s| s.to_string()),
        };
        let mut lib = self.skin_library();
        lib.account_mut(account_id).skins.insert(0, saved.clone());
        self.save_skin_library(&lib)?;
        Ok(saved)
    }

    pub fn delete_skin(&self, account_id: &str, skin_id: &str) -> Result<()> {
        let mut lib = self.skin_library();
        let acct = lib.account_mut(account_id);
        if let Some(s) = acct.skins.iter().find(|s| s.id == skin_id) {
            let _ = std::fs::remove_file(&s.file);
        }
        acct.skins.retain(|s| s.id != skin_id);
        if acct.selected.as_deref() == Some(skin_id) {
            acct.selected = None;
        }
        self.save_skin_library(&lib)
    }

    pub fn update_skin(
        &self,
        account_id: &str,
        skin_id: &str,
        model: &str,
        cape_id: Option<&str>,
    ) -> Result<()> {
        let mut lib = self.skin_library();
        let skin = lib
            .account_mut(account_id)
            .skins
            .iter_mut()
            .find(|s| s.id == skin_id)
            .ok_or_else(|| CoreError::Modpack("Skin not found".to_string()))?;
        skin.model = if model == "slim" { "slim" } else { "classic" }.to_string();
        skin.cape_id = cape_id.map(|c| c.to_string());
        self.save_skin_library(&lib)
    }

    pub fn replace_skin_texture(
        &self,
        account_id: &str,
        skin_id: &str,
        bytes: &[u8],
    ) -> Result<()> {
        let mut lib = self.skin_library();
        let skin = lib
            .account_mut(account_id)
            .skins
            .iter()
            .find(|s| s.id == skin_id)
            .ok_or_else(|| CoreError::Modpack("Skin not found".to_string()))?;
        std::fs::write(&skin.file, bytes)
            .map_err(|e| CoreError::io(std::path::Path::new(&skin.file), e))
    }

    /// Mark `skin_id` as the account's currently-applied skin.
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

    /// Apply a default preset by URL: saves it into the account's library (one
    /// entry per preset, updated in place on re-apply) so it becomes editable,
    /// pushes the texture + cape to Mojang, and marks it selected.
    pub fn apply_preset(
        &self,
        account_id: &str,
        name: &str,
        url: &str,
        model: &str,
        cape_id: Option<&str>,
    ) -> Result<skins::SavedSkin> {
        let bytes = skins::download_texture(url)?;
        let model = if model == "slim" { "slim" } else { "classic" }.to_string();
        let source = format!("preset:{name}");

        let mut lib = self.skin_library();
        let saved = {
            let acct = lib.account_mut(account_id);
            let existing = acct
                .skins
                .iter_mut()
                .find(|s| s.source.as_deref() == Some(source.as_str()));
            let saved = if let Some(s) = existing {
                std::fs::write(&s.file, &bytes)
                    .map_err(|e| CoreError::io(std::path::Path::new(&s.file), e))?;
                s.model = model.clone();
                s.cape_id = cape_id.map(|c| c.to_string());
                s.clone()
            } else {
                let (id, file) = self.write_skin_file(&bytes)?;
                let s = skins::SavedSkin {
                    id,
                    name: name.to_string(),
                    file,
                    model: model.clone(),
                    cape_id: cape_id.map(|c| c.to_string()),
                    source: Some(source.clone()),
                };
                acct.skins.insert(0, s.clone());
                s
            };
            acct.selected = Some(saved.id.clone());
            saved
        };
        self.save_skin_library(&lib)?;

        let cape = cape_id.map(|c| c.to_string());
        let upload_model = model.clone();
        self.with_token(account_id, move |t| {
            skins::upload_skin(t, bytes.clone(), &upload_model)?;
            skins::set_cape(t, cape.as_deref())
        })?;
        Ok(saved)
    }

    pub fn upload_and_apply_skin(
        &self,
        account_id: &str,
        name: &str,
        bytes: Vec<u8>,
        model: &str,
    ) -> Result<skins::SavedSkin> {
        let saved = self.save_skin(account_id, name, &bytes, model, None, None)?;
        self.with_token(account_id, |t| skins::upload_skin(t, bytes.clone(), model))?;
        self.set_selected_skin(account_id, Some(&saved.id))?;
        Ok(saved)
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
        let res = packs::sync_pack(
            &self.paths,
            instance_id,
            &instance.pack,
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
