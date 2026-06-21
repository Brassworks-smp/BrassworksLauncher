use std::collections::HashSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use packwiz::{
    Curseforge, FlavorGroup, Installer, Manifest, OptionalChoice, ResolvedVersion, SearchHit, Side,
    SyncOptions, SyncProgress,
};

use crate::packs::OptionalComponent;

use crate::error::{CoreError, Result};
use crate::instance::{Instance, PackSource};
use crate::paths::Paths;
use crate::settings::LauncherSettings;

pub const PACK_URL: &str =
    "https://raw.githubusercontent.com/salem-5/Brassworks-SMP-Season-2/master/pack.toml";

pub const DEFAULT_CURSEFORGE_API_KEY: &str = match option_env!("CURSEFORGE_API_KEY") {
    Some(k) => k,
    None => "$2a$10$dpx2qFIGDGtt0dWZHJ1fPeMN1UyPHp5/qBOeMSKgODujN3Qul2MVa",
};

pub fn resolve_pack_url(settings: &LauncherSettings) -> String {
    if let Some(url) = settings
        .pack_url
        .as_ref()
        .map(|u| u.trim())
        .filter(|u| !u.is_empty())
    {
        return url.to_string();
    }
    if settings.dev_mode {
        return PACK_URL.replace("/master/", "/dev/");
    }
    PACK_URL.to_string()
}

const DEFAULT_MC: &str = "1.21.1";
const LOADER: &str = "neoforge";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackStatus {
    pub installed_version: Option<String>,
    pub latest_version: String,
    pub name: String,
    pub update_available: bool,
    pub complete: bool,
    pub failed: Vec<String>,
    pub failures: Vec<packwiz::FileFailure>,
    pub neoforge_version: Option<String>,
    pub minecraft_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledMod {
    pub name: String,
    pub filename: String,
    pub path: String,
    pub side: String,
    pub category: String,
    pub enabled: bool,
    pub managed: bool,
    pub source: String,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub version: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModInfo {
    pub title: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDetail {
    pub id: String,
    pub title: String,
    pub description: String,
    pub body: String,
    pub icon_url: Option<String>,
    pub url: Option<String>,
    pub downloads: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentVersion {
    pub version_id: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub item: InstalledMod,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct UserContent {
    items: Vec<UserItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UserItem {
    name: String,
    filename: String,
    path: String,
    category: String,
    #[serde(default)]
    modrinth_id: Option<String>,
    #[serde(default)]
    modrinth_version: Option<String>,
    #[serde(default)]
    source: String,
    #[serde(default)]
    curseforge_id: Option<i64>,
    #[serde(default)]
    curseforge_file: Option<i64>,
    version: Option<String>,
}

impl UserItem {
    fn ids(&self) -> (String, Option<String>, Option<String>) {
        resolve_ids(
            &self.source,
            self.modrinth_id.clone(),
            self.modrinth_version.clone(),
            self.curseforge_id,
            self.curseforge_file,
        )
    }
}

fn resolve_ids(
    stored_source: &str,
    modrinth_id: Option<String>,
    modrinth_version: Option<String>,
    curseforge_id: Option<i64>,
    curseforge_file: Option<i64>,
) -> (String, Option<String>, Option<String>) {
    if curseforge_id.is_some() || stored_source == "curseforge" {
        (
            "curseforge".to_string(),
            curseforge_id.map(|i| i.to_string()),
            curseforge_file.map(|i| i.to_string()),
        )
    } else if modrinth_id.is_some() {
        ("modrinth".to_string(), modrinth_id, modrinth_version)
    } else {
        ("local".to_string(), None, None)
    }
}

pub struct Modpack<'a> {
    paths: &'a Paths,
    instance_id: String,
    pack_url: String,
    cf_api_key: Option<String>,
    mod_loader: Option<String>,
    mc_override: Option<String>,
    optional: OptionalChoice,
    unsup: bool,
    flavors: HashSet<String>,
    public_key: Option<String>,
    concurrency: usize,
}

pub fn optional_choice(selection: &Option<Vec<String>>) -> OptionalChoice {
    match selection {
        Some(ids) => OptionalChoice::Explicit(ids.iter().cloned().collect()),
        None => OptionalChoice::Default,
    }
}

impl<'a> Modpack<'a> {
    pub fn new(paths: &'a Paths, instance_id: impl Into<String>) -> Self {
        Self::with_url(paths, instance_id, PACK_URL.to_string())
    }

    pub fn with_url(
        paths: &'a Paths,
        instance_id: impl Into<String>,
        pack_url: String,
    ) -> Self {
        Self {
            paths,
            instance_id: instance_id.into(),
            pack_url,
            cf_api_key: None,
            mod_loader: Some(LOADER.to_string()),
            mc_override: None,
            optional: OptionalChoice::Default,
            unsup: false,
            flavors: HashSet::new(),
            public_key: None,
            concurrency: packwiz::DEFAULT_CONCURRENCY,
        }
    }

    pub fn for_instance(paths: &'a Paths, instance: &Instance, cf_key: Option<String>) -> Self {
        let (pack_url, unsup) = match &instance.pack {
            PackSource::Packwiz { url, unsup } => (url.clone(), *unsup),
            _ => (String::new(), false),
        };
        Self {
            paths,
            instance_id: instance.id.clone(),
            pack_url,
            cf_api_key: cf_key.filter(|k| !k.trim().is_empty()),
            mod_loader: instance.loader.content_loader().map(|s| s.to_string()),
            mc_override: Some(instance.minecraft_version.clone()),
            optional: optional_choice(&instance.optional_mods),
            unsup,
            flavors: instance.unsup_flavors.iter().flatten().cloned().collect(),
            public_key: instance.unsup_public_key.clone().filter(|k| !k.trim().is_empty()),
            concurrency: packwiz::DEFAULT_CONCURRENCY,
        }
    }

        pub fn with_concurrency(mut self, concurrency: usize) -> Self {
        self.concurrency = concurrency.max(1);
        self
    }

        fn installer(&self) -> Installer {
        Installer::new().with_concurrency(self.concurrency)
    }

            pub fn with_optional(mut self, choice: OptionalChoice) -> Self {
        self.optional = choice;
        self
    }

        pub fn optional_components(&self, cancel: &dyn Fn() -> bool) -> Result<Vec<OptionalComponent>> {
        if !self.has_packwiz() {
            return Ok(Vec::new());
        }
        let installer = self.installer();
        let mods = installer.inspect_optional(&self.pack_url, cancel)?;
        Ok(mods
            .into_iter()
            .map(|m| OptionalComponent {
                id: m.path,
                name: m.name,
                description: m.description,
                default: m.default,
                side: m.side,
                category: m.category,
            })
            .collect())
    }

            pub fn flavor_groups(&self, cancel: &dyn Fn() -> bool) -> Result<Vec<FlavorGroup>> {
        if !self.has_packwiz() {
            return Ok(Vec::new());
        }
        Ok(self.installer().inspect_unsup(&self.pack_url, cancel)?)
    }

    fn has_packwiz(&self) -> bool {
        !self.pack_url.trim().is_empty()
    }

    fn loader_for(&self, project_type: &str) -> Option<&str> {
        match project_type {
            "mod" => self.mod_loader.as_deref(),
            "datapack" => Some("datapack"),
            _ => None,
        }
    }

    pub fn with_curseforge_key(mut self, key: Option<String>) -> Self {
        self.cf_api_key = key.filter(|k| !k.trim().is_empty());
        self
    }

    fn curseforge(&self) -> Result<Curseforge> {
        let key = self.cf_api_key.clone().ok_or_else(|| {
            CoreError::Modpack(
                "Add a CurseForge API key in Settings to browse CurseForge content".to_string(),
            )
        })?;
        let installer = self.installer();
        Ok(installer.curseforge(self.paths.curseforge_cache_dir(), key))
    }

    fn game_dir(&self) -> PathBuf {
        self.paths.instance_game_dir(&self.instance_id)
    }

    fn options(&self) -> SyncOptions {
        SyncOptions {
            pack_url: self.pack_url.clone(),
            game_dir: self.game_dir(),
            manifest_path: self.paths.modpack_manifest(&self.instance_id),
            side: Side::Client,
            optional: self.optional.clone(),
            unsup: self.unsup,
            flavors: self.flavors.clone(),
            public_key: self.public_key.clone(),
        }
    }

    fn manifest(&self) -> Result<Manifest> {
        Ok(Manifest::load(&self.paths.modpack_manifest(&self.instance_id))?)
    }

    fn load_user(&self) -> UserContent {
        match std::fs::read(self.paths.user_content(&self.instance_id)) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => UserContent::default(),
        }
    }

    fn save_user(&self, user: &UserContent) -> Result<()> {
        let path = self.paths.user_content(&self.instance_id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
        }
        let json =
            serde_json::to_vec_pretty(user).map_err(|e| CoreError::serde("user_content", e))?;
        std::fs::write(&path, json).map_err(|e| CoreError::io(&path, e))
    }

    fn game_version(&self) -> String {
        if let Some(mc) = &self.mc_override {
            return mc.clone();
        }
        self.manifest()
            .ok()
            .and_then(|m| m.minecraft_version)
            .unwrap_or_else(|| DEFAULT_MC.to_string())
    }


    pub fn status(&self) -> Result<ModpackStatus> {
        let manifest = self.manifest()?;

        if !self.has_packwiz() {
            let installed = if manifest.pack_version.is_empty() {
                None
            } else {
                Some(manifest.pack_version.clone())
            };
            return Ok(ModpackStatus {
                installed_version: installed.clone(),
                latest_version: installed.unwrap_or_default(),
                name: String::new(),
                update_available: !manifest.complete && !manifest.files.is_empty(),
                complete: manifest.complete,
                failed: manifest.failed.clone(),
                failures: manifest.failures.clone(),
                neoforge_version: manifest.neoforge_version.clone(),
                minecraft_version: manifest
                    .minecraft_version
                    .clone()
                    .or_else(|| self.mc_override.clone()),
            });
        }

        let installer = self.installer();
        let pack = installer.fetch_pack(&self.pack_url)?;

        let installed_version = if manifest.pack_version.is_empty() {
            None
        } else {
            Some(manifest.pack_version.clone())
        };
        let update_available = installed_version.as_deref() != Some(pack.version.as_str())
            || !manifest.complete;

        Ok(ModpackStatus {
            installed_version,
            latest_version: pack.version.clone(),
            name: pack.name.clone(),
            update_available,
            complete: manifest.complete,
            failed: manifest.failed.clone(),
            failures: manifest.failures.clone(),
            neoforge_version: pack.versions.neoforge.clone(),
            minecraft_version: pack.versions.minecraft.clone(),
        })
    }

    pub fn sync(
        &self,
        force: bool,
        cancel: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(SyncProgress),
    ) -> Result<Manifest> {
        let installer = self.installer();
        Ok(installer.sync(&self.options(), force, cancel, progress)?)
    }

    pub fn reinstall(
        &self,
        cancel: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(SyncProgress),
    ) -> Result<Manifest> {
        let game_dir = self.game_dir();
        if let Ok(manifest) = self.manifest() {
            for path in manifest.files.keys() {
                let _ = std::fs::remove_file(game_dir.join(path));
            }
        }
        let _ = std::fs::remove_file(self.paths.modpack_manifest(&self.instance_id));
        self.sync(true, cancel, progress)
    }


    pub fn list_mods(&self) -> Result<Vec<InstalledMod>> {
        let game_dir = self.game_dir();
        let manifest = self.manifest()?;
        let mut tracked: HashSet<String> = HashSet::new();
        let mut out = Vec::new();

        for m in manifest.mods {
            tracked.insert(m.path.clone());
            let enabled = game_dir.join(&m.path).exists();
            let (source, project_id, version_id) = resolve_ids(
                &m.source,
                m.modrinth_id,
                m.modrinth_version,
                m.curseforge_id,
                m.curseforge_file,
            );
            out.push(InstalledMod {
                name: m.name,
                filename: m.filename,
                path: m.path,
                side: m.side,
                category: m.category,
                enabled,
                managed: true,
                source,
                project_id,
                version_id,
                version: None,
                title: None,
                description: None,
                icon_url: None,
            });
        }

        for u in self.load_user().items {
            tracked.insert(u.path.clone());
            let enabled = game_dir.join(&u.path).exists();
            let disabled = game_dir.join(format!("{}.disabled", u.path)).exists();
            if !enabled && !disabled {
                continue;
            }
            let (source, project_id, version_id) = u.ids();
            out.push(InstalledMod {
                name: u.name,
                filename: u.filename,
                path: u.path,
                side: "client".to_string(),
                category: u.category,
                enabled,
                managed: false,
                source,
                project_id,
                version_id,
                version: u.version,
                title: None,
                description: None,
                icon_url: None,
            });
        }

        for folder in ["mods", "resourcepacks", "shaderpacks"] {
            let dir = game_dir.join(folder);
            let read = match std::fs::read_dir(&dir) {
                Ok(r) => r,
                Err(_) => continue,
            };
            for entry in read.flatten() {
                if !entry.path().is_file() {
                    continue;
                }
                let raw = entry.file_name().to_string_lossy().to_string();
                let (enabled, base) = match raw.strip_suffix(".disabled") {
                    Some(b) => (false, b.to_string()),
                    None => (true, raw.clone()),
                };
                if !(base.ends_with(".jar") || base.ends_with(".zip")) {
                    continue;
                }
                let rel = format!("{folder}/{base}");
                if tracked.contains(&rel) {
                    continue;
                }
                tracked.insert(rel.clone());
                out.push(InstalledMod {
                    name: base.clone(),
                    filename: base,
                    path: rel,
                    side: "client".to_string(),
                    category: folder.to_string(),
                    enabled,
                    managed: false,
                    source: "local".to_string(),
                    project_id: None,
                    version_id: None,
                    version: None,
                    title: None,
                    description: None,
                    icon_url: None,
                });
            }
        }

        out.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
        });
        Ok(out)
    }

    pub fn mod_info(&self, source: &str, project_id: &str, version_id: Option<&str>) -> ModInfo {
        if source == "curseforge" {
            let Ok(cf) = self.curseforge() else {
                return ModInfo {
                    title: None,
                    description: None,
                    icon_url: None,
                    version: None,
                };
            };
            let project = cf.project(project_id);
            let version = version_id
                .and_then(|v| cf.resolve_version(project_id, v).ok().flatten())
                .map(|r| r.version_number);
            return ModInfo {
                title: project.as_ref().map(|p| p.title.clone()),
                description: project.as_ref().map(|p| p.description.clone()),
                icon_url: project.and_then(|p| p.icon_url),
                version,
            };
        }

        let installer = self.installer();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        let project = modrinth.project(project_id);
        let version = version_id.and_then(|v| modrinth.version_number(v));
        ModInfo {
            title: project.as_ref().map(|p| p.title.clone()),
            description: project.as_ref().map(|p| p.description.clone()),
            icon_url: project.and_then(|p| p.icon_url),
            version,
        }
    }


    fn is_managed(&self, path: &str) -> bool {
        self.manifest()
            .map(|m| m.mods.iter().any(|x| x.path == path))
            .unwrap_or(false)
    }

    pub fn installed_neoforge(&self) -> Option<String> {
        self.manifest().ok().and_then(|m| m.neoforge_version)
    }

    pub fn set_enabled(&self, path: &str, enabled: bool, unlocked: bool) -> Result<()> {
        if self.is_managed(path) && !unlocked {
            return Err(CoreError::Modpack(
                "Unlock the modpack to disable its content".to_string(),
            ));
        }
        let game_dir = self.game_dir();
        let active = game_dir.join(path);
        let disabled = game_dir.join(format!("{path}.disabled"));
        if enabled {
            if disabled.exists() {
                std::fs::rename(&disabled, &active).map_err(|e| CoreError::io(&active, e))?;
            }
        } else if active.exists() {
            std::fs::rename(&active, &disabled).map_err(|e| CoreError::io(&disabled, e))?;
        }
        Ok(())
    }

    pub fn remove_content(&self, path: &str) -> Result<()> {
        if self.is_managed(path) {
            return Err(CoreError::Modpack(
                "Modpack content can't be removed".to_string(),
            ));
        }
        let game_dir = self.game_dir();
        let _ = std::fs::remove_file(game_dir.join(path));
        let _ = std::fs::remove_file(game_dir.join(format!("{path}.disabled")));
        let mut user = self.load_user();
        user.items.retain(|i| i.path != path);
        self.save_user(&user)?;
        Ok(())
    }


    pub fn search(
        &self,
        query: &str,
        project_type: &str,
        source: &str,
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        let loader = self.loader_for(project_type);
        let game_version = self.game_version();
        if source == "curseforge" {
            return Ok(self
                .curseforge()?
                .search(query, project_type, loader, &game_version, 20, offset)?);
        }
        let installer = self.installer();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        Ok(modrinth.search(query, project_type, loader, &game_version, 20, offset)?)
    }

    pub fn project_detail(&self, project_id: &str, source: &str) -> Result<ProjectDetail> {
        if source == "curseforge" {
            let p = self
                .curseforge()?
                .project(project_id)
                .ok_or_else(|| CoreError::Modpack("Project not found".to_string()))?;
            return Ok(ProjectDetail {
                id: p.id,
                title: p.title,
                description: p.description,
                body: p.body,
                icon_url: p.icon_url,
                url: p.url,
                downloads: p.downloads,
            });
        }
        let installer = self.installer();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        let p = modrinth
            .project(project_id)
            .ok_or_else(|| CoreError::Modpack("Project not found".to_string()))?;
        let slug = if p.slug.is_empty() { p.id.clone() } else { p.slug.clone() };
        Ok(ProjectDetail {
            id: p.id,
            title: p.title,
            description: p.description,
            body: p.body,
            icon_url: p.icon_url,
            url: Some(format!("https://modrinth.com/project/{slug}")),
            downloads: p.downloads,
        })
    }

    pub fn list_versions(
        &self,
        project_id: &str,
        project_type: &str,
        source: &str,
    ) -> Result<Vec<ContentVersion>> {
        let loader = self.loader_for(project_type);
        let game_version = self.game_version();
        let versions = if source == "curseforge" {
            self.curseforge()?
                .list_versions(project_id, &game_version, loader)?
        } else {
            let installer = self.installer();
            installer
                .modrinth(self.paths.modrinth_cache_dir())
                .list_versions(project_id, &game_version, loader)?
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

    fn best_one(
        &self,
        source: &str,
        project_id: &str,
        project_type: &str,
    ) -> Result<Option<ResolvedVersion>> {
        let game_version = self.game_version();
        let loader = self.loader_for(project_type);
        if source == "curseforge" {
            Ok(self
                .curseforge()?
                .best_version(project_id, &game_version, loader)?)
        } else {
            let installer = self.installer();
            Ok(installer
                .modrinth(self.paths.modrinth_cache_dir())
                .best_version(project_id, &game_version, loader)?)
        }
    }

    fn resolve_one(
        &self,
        source: &str,
        project_id: &str,
        version_id: &str,
    ) -> Result<Option<ResolvedVersion>> {
        if source == "curseforge" {
            Ok(self
                .curseforge()?
                .resolve_version(project_id, version_id)?)
        } else {
            let installer = self.installer();
            Ok(installer
                .modrinth(self.paths.modrinth_cache_dir())
                .resolve_version(version_id)?)
        }
    }

    pub fn content_changelog(
        &self,
        project_id: &str,
        version_id: &str,
        source: &str,
    ) -> Result<String> {
        let changelog = if source == "curseforge" {
            self.curseforge()?.file_changelog(project_id, version_id)
        } else {
            let installer = self.installer();
            installer
                .modrinth(self.paths.modrinth_cache_dir())
                .version_changelog(version_id)
        };
        Ok(changelog.unwrap_or_else(|| "_No changelog provided for this version._".to_string()))
    }

    pub fn install_from_source(
        &self,
        project_id: &str,
        project_type: &str,
        source: &str,
    ) -> Result<InstallResult> {
        let version = self.best_one(source, project_id, project_type)?.ok_or_else(|| {
            let loader = self.loader_for(project_type);
            CoreError::Modpack(format!(
                "No {project_type} version for Minecraft {}{}",
                self.game_version(),
                loader.map(|l| format!(" / {l}")).unwrap_or_default()
            ))
        })?;
        let item = self.place_version(source, project_id, project_type, version.clone(), true)?;
        let dependencies = self.install_dependencies(source, &version);
        Ok(InstallResult { item, dependencies })
    }

    pub fn install_version(
        &self,
        project_id: &str,
        version_id: &str,
        project_type: &str,
        source: &str,
        unlocked: bool,
    ) -> Result<InstallResult> {
        let managed = self
            .manifest()
            .map(|m| m.mods.iter().any(|x| managed_matches(x, source, project_id)))
            .unwrap_or(false);
        if managed && !unlocked {
            return Err(CoreError::Modpack(
                "Unlock the modpack to change a modpack mod's version".to_string(),
            ));
        }

        let version = self
            .resolve_one(source, project_id, version_id)?
            .ok_or_else(|| CoreError::Modpack("Version not found".to_string()))?;
        let item = self.place_version(source, project_id, project_type, version.clone(), unlocked)?;
        let dependencies = self.install_dependencies(source, &version);
        Ok(InstallResult { item, dependencies })
    }

    pub fn install_datapack(
        &self,
        world: &str,
        source: &str,
        project_id: &str,
        version_id: Option<&str>,
    ) -> Result<(String, String)> {
        let version = match version_id {
            Some(vid) => self.resolve_one(source, project_id, vid)?,
            None => self.best_one(source, project_id, "datapack")?,
        }
        .ok_or_else(|| {
            CoreError::Modpack(format!(
                "No datapack version for Minecraft {}",
                self.game_version()
            ))
        })?;

        let installer = self.installer();
        let http = installer.modrinth(self.paths.modrinth_cache_dir());
        let bytes = http.download(&version.url)?;
        if let Some(expected) = &version.sha512 {
            let actual = packwiz::sha512_hex(&bytes);
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(CoreError::Modpack(
                    "Downloaded file failed hash verification".to_string(),
                ));
            }
        }

        let dir = self.game_dir().join("saves").join(world).join("datapacks");
        std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        let dest = dir.join(&version.filename);
        std::fs::write(&dest, &bytes).map_err(|e| CoreError::io(&dest, e))?;
        Ok((version.filename, version.version_id))
    }

    fn already_present(&self, source: &str, project_id: &str) -> bool {
        if self
            .manifest()
            .map(|m| m.mods.iter().any(|x| managed_matches(x, source, project_id)))
            .unwrap_or(false)
        {
            return true;
        }
        self.load_user().items.iter().any(|i| {
            let (s, pid, _) = i.ids();
            s == source && pid.as_deref() == Some(project_id)
        })
    }

    fn install_dependencies(&self, source: &str, version: &ResolvedVersion) -> Vec<String> {
        let mut visited: HashSet<String> = HashSet::new();
        let mut installed: Vec<String> = Vec::new();
        self.install_deps_inner(source, version, &mut visited, &mut installed, 0);
        installed
    }

    fn install_deps_inner(
        &self,
        source: &str,
        version: &ResolvedVersion,
        visited: &mut HashSet<String>,
        installed: &mut Vec<String>,
        depth: u32,
    ) {
        if depth > 4 {
            return;
        }
        for dep in version.dependencies.iter().filter(|d| d.required) {
            let Some(pid) = dep.project_id.clone() else {
                continue;
            };
            if !visited.insert(format!("{source}:{pid}")) {
                continue;
            }
            if self.already_present(source, &pid) {
                continue;
            }
            let resolved = match &dep.version_id {
                Some(vid) => self.resolve_one(source, &pid, vid).ok().flatten(),
                None => self.best_one(source, &pid, "mod").ok().flatten(),
            };
            if let Some(rv) = resolved {
                if let Ok(m) = self.place_version(source, &pid, "mod", rv.clone(), false) {
                    installed.push(m.name);
                    self.install_deps_inner(source, &rv, visited, installed, depth + 1);
                }
            }
        }
    }

    pub fn update_all(&self) -> Result<Vec<String>> {
        self.update_filtered(None)
    }

    pub fn update_selected(&self, keys: &[String]) -> Result<Vec<String>> {
        let set: HashSet<&str> = keys.iter().map(|s| s.as_str()).collect();
        self.update_filtered(Some(&set))
    }

    fn update_filtered(&self, only: Option<&HashSet<&str>>) -> Result<Vec<String>> {
        let mut updated = Vec::new();
        for item in self.load_user().items.clone() {
            let (source, pid, vid) = item.ids();
            let (Some(pid), Some(vid)) = (pid, vid) else {
                continue;
            };
            if let Some(set) = only {
                if !set.contains(format!("{source}:{pid}").as_str()) {
                    continue;
                }
            }
            let project_type = project_type_for_category(&item.category);
            if let Ok(Some(best)) = self.best_one(&source, &pid, project_type) {
                if best.version_id != vid {
                    if self
                        .place_version(&source, &pid, project_type, best, false)
                        .is_ok()
                    {
                        updated.push(item.name.clone());
                    }
                }
            }
        }
        Ok(updated)
    }

    fn place_version(
        &self,
        source: &str,
        project_id: &str,
        project_type: &str,
        version: ResolvedVersion,
        allow_disable_managed: bool,
    ) -> Result<InstalledMod> {
        let installer = self.installer();
        let http = installer.modrinth(self.paths.modrinth_cache_dir());
        let folder = folder_for(project_type);

        let bytes = http.download(&version.url)?;
        if let Some(expected) = &version.sha512 {
            let actual = packwiz::sha512_hex(&bytes);
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(CoreError::Modpack(
                    "Downloaded file failed hash verification".to_string(),
                ));
            }
        }

        let game_dir = self.game_dir();
        if allow_disable_managed {
            if let Ok(manifest) = self.manifest() {
                for m in manifest.mods.iter() {
                    if managed_matches(m, source, project_id) {
                        let active = game_dir.join(&m.path);
                        if active.exists() {
                            let _ = std::fs::rename(
                                &active,
                                game_dir.join(format!("{}.disabled", m.path)),
                            );
                        }
                    }
                }
            }
        }

        let rel = format!("{folder}/{}", version.filename);
        let dest = game_dir.join(&rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
        }
        std::fs::write(&dest, &bytes).map_err(|e| CoreError::io(&dest, e))?;

        let (title, description, icon_url) = if source == "curseforge" {
            match self.curseforge().ok().and_then(|cf| cf.project(project_id)) {
                Some(p) => (Some(p.title), Some(p.description), p.icon_url),
                None => (None, None, None),
            }
        } else {
            match http.project(project_id) {
                Some(p) => (Some(p.title), Some(p.description), p.icon_url),
                None => (None, None, None),
            }
        };
        let name = title.clone().unwrap_or_else(|| version.filename.clone());

        let (modrinth_id, modrinth_version, curseforge_id, curseforge_file) = if source
            == "curseforge"
        {
            (
                None,
                None,
                project_id.parse::<i64>().ok(),
                version.version_id.parse::<i64>().ok(),
            )
        } else {
            (
                Some(project_id.to_string()),
                Some(version.version_id.clone()),
                None,
                None,
            )
        };

        let mut user = self.load_user();
        for old in user.items.iter().filter(|i| {
            let (s, pid, _) = i.ids();
            s == source && pid.as_deref() == Some(project_id) && i.path != rel
        }) {
            let _ = std::fs::remove_file(game_dir.join(&old.path));
            let _ = std::fs::remove_file(game_dir.join(format!("{}.disabled", old.path)));
        }
        user.items.retain(|i| {
            let (s, pid, _) = i.ids();
            i.path != rel && !(s == source && pid.as_deref() == Some(project_id))
        });
        user.items.push(UserItem {
            name: name.clone(),
            filename: version.filename.clone(),
            path: rel.clone(),
            category: folder.to_string(),
            modrinth_id,
            modrinth_version,
            source: source.to_string(),
            curseforge_id,
            curseforge_file,
            version: Some(version.version_number.clone()),
        });
        self.save_user(&user)?;

        Ok(InstalledMod {
            name,
            filename: version.filename,
            path: rel,
            side: "client".to_string(),
            category: folder.to_string(),
            enabled: true,
            managed: false,
            source: source.to_string(),
            project_id: Some(project_id.to_string()),
            version_id: Some(version.version_id),
            version: Some(version.version_number),
            title,
            description,
            icon_url,
        })
    }

    pub fn relock_reconcile(&self) -> Result<()> {
        let game_dir = self.game_dir();
        let manifest = self.manifest()?;
        let managed_keys: HashSet<(String, String)> = manifest
            .mods
            .iter()
            .filter_map(|m| {
                let (s, pid, _) = resolve_ids(
                    &m.source,
                    m.modrinth_id.clone(),
                    m.modrinth_version.clone(),
                    m.curseforge_id,
                    m.curseforge_file,
                );
                pid.map(|p| (s, p))
            })
            .collect();

        for m in manifest.mods.iter() {
            let disabled = game_dir.join(format!("{}.disabled", m.path));
            if disabled.exists() {
                let _ = std::fs::rename(&disabled, game_dir.join(&m.path));
            }
        }

        let shadows_managed = |i: &UserItem| {
            let (s, pid, _) = i.ids();
            pid.map(|p| managed_keys.contains(&(s, p))).unwrap_or(false)
        };

        let mut user = self.load_user();
        for item in user.items.iter().filter(|i| shadows_managed(i)) {
            let _ = std::fs::remove_file(game_dir.join(&item.path));
            let _ = std::fs::remove_file(game_dir.join(format!("{}.disabled", item.path)));
        }
        user.items.retain(|i| !shadows_managed(i));
        self.save_user(&user)?;
        Ok(())
    }

    pub fn export_modrinth(
        &self,
        name: &str,
        mc_version: &str,
        loader: &str,
        loader_version: Option<&str>,
    ) -> Result<Vec<u8>> {
        let game_dir = self.game_dir();
        let installer = self.installer();
        let http = installer.modrinth(self.paths.modrinth_cache_dir());

        let mut files: Vec<serde_json::Value> = Vec::new();
        let mut overrides: Vec<(String, Vec<u8>)> = Vec::new();
        for m in self.list_mods().unwrap_or_default() {
            if !m.enabled {
                continue;
            }
            let Ok(bytes) = std::fs::read(game_dir.join(&m.path)) else {
                continue;
            };
            if m.source == "modrinth" {
                if let Some(rv) = m
                    .version_id
                    .as_deref()
                    .and_then(|v| http.resolve_version(v).ok().flatten())
                {
                    if let (Some(sha1), Some(sha512)) = (rv.sha1.clone(), rv.sha512.clone()) {
                        files.push(serde_json::json!({
                            "path": m.path,
                            "hashes": { "sha1": sha1, "sha512": sha512 },
                            "env": { "client": "required", "server": "required" },
                            "downloads": [rv.url],
                            "fileSize": bytes.len(),
                        }));
                        continue;
                    }
                }
            }
            overrides.push((m.path.clone(), bytes));
        }
        collect_config_overrides(&game_dir, &mut overrides);

        let mut deps = serde_json::Map::new();
        deps.insert("minecraft".into(), serde_json::json!(mc_version));
        if let (Some(key), Some(v)) = (modrinth_loader_key(loader), loader_version) {
            deps.insert(key.into(), serde_json::json!(v));
        }
        let index = serde_json::json!({
            "formatVersion": 1,
            "game": "minecraft",
            "versionId": "1.0.0",
            "name": name,
            "files": files,
            "dependencies": serde_json::Value::Object(deps),
        });

        zip_pack("modrinth.index.json", &index, &overrides)
    }

    pub fn export_curseforge(
        &self,
        name: &str,
        mc_version: &str,
        loader: &str,
        loader_version: Option<&str>,
    ) -> Result<Vec<u8>> {
        let game_dir = self.game_dir();

        let mut cf_files: Vec<serde_json::Value> = Vec::new();
        let mut overrides: Vec<(String, Vec<u8>)> = Vec::new();
        for m in self.list_mods().unwrap_or_default() {
            if !m.enabled {
                continue;
            }
            if m.source == "curseforge" {
                if let (Some(pid), Some(fid)) = (
                    m.project_id.as_deref().and_then(|s| s.parse::<i64>().ok()),
                    m.version_id.as_deref().and_then(|s| s.parse::<i64>().ok()),
                ) {
                    cf_files.push(serde_json::json!({
                        "projectID": pid, "fileID": fid, "required": true,
                    }));
                    continue;
                }
            }
            if let Ok(bytes) = std::fs::read(game_dir.join(&m.path)) {
                overrides.push((m.path.clone(), bytes));
            }
        }
        collect_config_overrides(&game_dir, &mut overrides);

        let loader_id = match loader {
            "neoforge" => "neoforge",
            "fabric" => "fabric",
            "quilt" => "quilt",
            _ => "forge",
        };
        let loader_str = match loader_version {
            Some(v) => format!("{loader_id}-{v}"),
            None => loader_id.to_string(),
        };
        let manifest = serde_json::json!({
            "minecraft": {
                "version": mc_version,
                "modLoaders": [{ "id": loader_str, "primary": true }],
            },
            "manifestType": "minecraftModpack",
            "manifestVersion": 1,
            "name": name,
            "version": "1.0.0",
            "author": "",
            "files": cf_files,
            "overrides": "overrides",
        });

        zip_pack("manifest.json", &manifest, &overrides)
    }

    pub fn uninstall(&self) -> Result<()> {
        let game_dir = self.game_dir();
        if game_dir.exists() {
            std::fs::remove_dir_all(&game_dir).map_err(|e| CoreError::io(&game_dir, e))?;
        }
        let _ = std::fs::remove_file(self.paths.modpack_manifest(&self.instance_id));
        let _ = std::fs::remove_file(self.paths.user_content(&self.instance_id));
        let _ = self.reinstall_loader();
        Ok(())
    }

    pub fn reinstall_loader(&self) -> Result<()> {
        let manifest = self.manifest()?;
        let versions_dir = self.paths.shared_dir().join("versions");
        if let Some(neoforge) = manifest.neoforge_version.as_deref() {
            let dir = versions_dir.join(format!("neoforge-{neoforge}"));
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
            }
        }
        Ok(())
    }
}

fn managed_matches(m: &packwiz::ManagedMod, source: &str, project_id: &str) -> bool {
    let (s, pid, _) = resolve_ids(
        &m.source,
        m.modrinth_id.clone(),
        m.modrinth_version.clone(),
        m.curseforge_id,
        m.curseforge_file,
    );
    s == source && pid.as_deref() == Some(project_id)
}

fn folder_for(project_type: &str) -> &'static str {
    match project_type {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        _ => "mods",
    }
}

fn collect_config_overrides(
    game_dir: &std::path::Path,
    overrides: &mut Vec<(String, Vec<u8>)>,
) {
    for sub in ["config", "defaultconfigs", "kubejs", "scripts", "options.txt"] {
        let root = game_dir.join(sub);
        if root.is_file() {
            if let Ok(bytes) = std::fs::read(&root) {
                overrides.push((sub.to_string(), bytes));
            }
            continue;
        }
        let mut stack = vec![root];
        while let Some(d) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&d) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                match entry.file_type() {
                    Ok(ft) if ft.is_dir() => stack.push(path),
                    Ok(ft) if ft.is_file() => {
                        if let Ok(rel) = path.strip_prefix(game_dir) {
                            if let Ok(bytes) = std::fs::read(&path) {
                                overrides.push((
                                    rel.to_string_lossy().replace('\\', "/"),
                                    bytes,
                                ));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

fn modrinth_loader_key(loader: &str) -> Option<&'static str> {
    match loader {
        "neoforge" => Some("neoforge"),
        "forge" => Some("forge"),
        "fabric" => Some("fabric-loader"),
        "quilt" => Some("quilt-loader"),
        _ => None,
    }
}

fn zip_pack(
    index_name: &str,
    index: &serde_json::Value,
    overrides: &[(String, Vec<u8>)],
) -> Result<Vec<u8>> {
    use std::io::Write;
    let zip_err = |e: zip::result::ZipError| CoreError::Modpack(format!("zip: {e}"));
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = zip::write::SimpleFileOptions::default();
        let json =
            serde_json::to_vec_pretty(index).map_err(|e| CoreError::serde("modpack index", e))?;
        zip.start_file(index_name.to_string(), opts).map_err(zip_err)?;
        zip.write_all(&json)
            .map_err(|e| CoreError::Modpack(format!("zip write: {e}")))?;
        for (path, bytes) in overrides {
            zip.start_file(format!("overrides/{path}"), opts)
                .map_err(zip_err)?;
            zip.write_all(bytes)
                .map_err(|e| CoreError::Modpack(format!("zip write: {e}")))?;
        }
        zip.finish().map_err(zip_err)?;
    }
    Ok(buf)
}

fn project_type_for_category(category: &str) -> &'static str {
    match category {
        "resourcepacks" => "resourcepack",
        "shaderpacks" => "shader",
        _ => "mod",
    }
}

#[cfg(test)]
mod modpack_tests {
    use super::*;

    fn settings() -> LauncherSettings {
        serde_json::from_str::<LauncherSettings>("{}").unwrap()
    }

    #[test]
    fn resolve_ids_curseforge_from_ids() {
        let (source, id, file) = resolve_ids("", None, None, Some(7), Some(9));
        assert_eq!(source, "curseforge");
        assert_eq!(id, Some("7".to_string()));
        assert_eq!(file, Some("9".to_string()));
    }

    #[test]
    fn resolve_ids_curseforge_from_source() {
        let (source, id, file) = resolve_ids("curseforge", None, None, None, None);
        assert_eq!(source, "curseforge");
        assert_eq!(id, None);
        assert_eq!(file, None);
    }

    #[test]
    fn resolve_ids_modrinth() {
        let (source, id, version) = resolve_ids(
            "",
            Some("abc".to_string()),
            Some("v1".to_string()),
            None,
            None,
        );
        assert_eq!(source, "modrinth");
        assert_eq!(id, Some("abc".to_string()));
        assert_eq!(version, Some("v1".to_string()));
    }

    #[test]
    fn resolve_ids_local_fallback() {
        let (source, id, version) = resolve_ids("", None, None, None, None);
        assert_eq!(source, "local");
        assert_eq!(id, None);
        assert_eq!(version, None);
    }

    #[test]
    fn resolve_ids_curseforge_takes_priority_over_modrinth() {
        let (source, _, _) = resolve_ids("", Some("m".to_string()), None, Some(1), None);
        assert_eq!(source, "curseforge");
    }

    #[test]
    fn resolve_pack_url_default() {
        assert_eq!(resolve_pack_url(&settings()), PACK_URL);
    }

    #[test]
    fn resolve_pack_url_custom_overrides() {
        let mut s = settings();
        s.pack_url = Some("https://example.com/pack.toml".to_string());
        assert_eq!(resolve_pack_url(&s), "https://example.com/pack.toml");
    }

    #[test]
    fn resolve_pack_url_ignores_blank_custom() {
        let mut s = settings();
        s.pack_url = Some("   ".to_string());
        assert_eq!(resolve_pack_url(&s), PACK_URL);
    }

    #[test]
    fn resolve_pack_url_dev_mode_switches_branch() {
        let mut s = settings();
        s.dev_mode = true;
        assert_eq!(resolve_pack_url(&s), PACK_URL.replace("/master/", "/dev/"));
    }

    #[test]
    fn resolve_pack_url_custom_beats_dev_mode() {
        let mut s = settings();
        s.dev_mode = true;
        s.pack_url = Some("https://custom".to_string());
        assert_eq!(resolve_pack_url(&s), "https://custom");
    }

    #[test]
    fn optional_choice_default_when_none() {
        assert!(matches!(optional_choice(&None), OptionalChoice::Default));
    }

    #[test]
    fn optional_choice_explicit_set() {
        let choice = optional_choice(&Some(vec!["a".to_string(), "b".to_string()]));
        match choice {
            OptionalChoice::Explicit(set) => {
                assert!(set.contains("a"));
                assert!(set.contains("b"));
                assert_eq!(set.len(), 2);
            }
            _ => panic!("expected explicit"),
        }
    }

    #[test]
    fn optional_choice_empty_is_explicit_empty() {
        match optional_choice(&Some(vec![])) {
            OptionalChoice::Explicit(set) => assert!(set.is_empty()),
            _ => panic!("expected explicit"),
        }
    }

    #[test]
    fn project_type_mapping() {
        assert_eq!(project_type_for_category("resourcepacks"), "resourcepack");
        assert_eq!(project_type_for_category("shaderpacks"), "shader");
        assert_eq!(project_type_for_category("mods"), "mod");
        assert_eq!(project_type_for_category("anything"), "mod");
    }
}
