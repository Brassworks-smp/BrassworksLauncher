
use std::collections::HashSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use packwiz::{Installer, Manifest, ResolvedVersion, SearchHit, Side, SyncOptions, SyncProgress};

use crate::error::{CoreError, Result};
use crate::paths::Paths;
use crate::settings::LauncherSettings;

pub const PACK_URL: &str =
    "https://raw.githubusercontent.com/salem-5/Brassworks-SMP-Season-2/master/pack.toml";

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
    pub modrinth_id: Option<String>,
    pub modrinth_version: Option<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentVersion {
    pub version_id: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
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
    modrinth_id: Option<String>,
    modrinth_version: Option<String>,
    version: Option<String>,
}

pub struct Modpack<'a> {
    paths: &'a Paths,
    instance_id: String,
    pack_url: String,
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
        }
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
        self.manifest()
            .ok()
            .and_then(|m| m.minecraft_version)
            .unwrap_or_else(|| DEFAULT_MC.to_string())
    }


    pub fn status(&self) -> Result<ModpackStatus> {
        let installer = Installer::new();
        let pack = installer.fetch_pack(&self.pack_url)?;
        let manifest = self.manifest()?;

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
        let installer = Installer::new();
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
            out.push(InstalledMod {
                name: m.name,
                filename: m.filename,
                path: m.path,
                side: m.side,
                category: m.category,
                enabled,
                managed: true,
                modrinth_id: m.modrinth_id,
                modrinth_version: m.modrinth_version,
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
            out.push(InstalledMod {
                name: u.name,
                filename: u.filename,
                path: u.path,
                side: "client".to_string(),
                category: u.category,
                enabled,
                managed: false,
                modrinth_id: u.modrinth_id,
                modrinth_version: u.modrinth_version,
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
                    modrinth_id: None,
                    modrinth_version: None,
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

    pub fn mod_info(&self, modrinth_id: &str, version_id: Option<&str>) -> ModInfo {
        let installer = Installer::new();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        let project = modrinth.project(modrinth_id);
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
        offset: u32,
    ) -> Result<Vec<SearchHit>> {
        let installer = Installer::new();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        let loader = loader_for(project_type);
        Ok(modrinth.search(query, project_type, loader, &self.game_version(), 20, offset)?)
    }

    pub fn project_detail(&self, project_id: &str) -> Result<ProjectDetail> {
        let installer = Installer::new();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        let p = modrinth
            .project(project_id)
            .ok_or_else(|| CoreError::Modpack("Project not found".to_string()))?;
        Ok(ProjectDetail {
            id: p.id,
            title: p.title,
            description: p.description,
            body: p.body,
            icon_url: p.icon_url,
        })
    }

    pub fn list_versions(
        &self,
        project_id: &str,
        project_type: &str,
    ) -> Result<Vec<ContentVersion>> {
        let installer = Installer::new();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        let versions =
            modrinth.list_versions(project_id, &self.game_version(), loader_for(project_type))?;
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

    pub fn install_from_modrinth(
        &self,
        project_id: &str,
        project_type: &str,
    ) -> Result<InstalledMod> {
        let installer = Installer::new();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        let game_version = self.game_version();
        let loader = loader_for(project_type);
        let version = modrinth
            .best_version(project_id, &game_version, loader)?
            .ok_or_else(|| {
                CoreError::Modpack(format!(
                    "No {project_type} version for Minecraft {game_version}{}",
                    loader.map(|l| format!(" / {l}")).unwrap_or_default()
                ))
            })?;
        self.place_version(project_id, project_type, version, true)
    }

    pub fn install_version(
        &self,
        project_id: &str,
        version_id: &str,
        project_type: &str,
        unlocked: bool,
    ) -> Result<InstalledMod> {
        let managed = self
            .manifest()
            .map(|m| {
                m.mods
                    .iter()
                    .any(|x| x.modrinth_id.as_deref() == Some(project_id))
            })
            .unwrap_or(false);
        if managed && !unlocked {
            return Err(CoreError::Modpack(
                "Unlock the modpack to change a modpack mod's version".to_string(),
            ));
        }

        let installer = Installer::new();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        let version = modrinth
            .resolve_version(version_id)?
            .ok_or_else(|| CoreError::Modpack("Version not found".to_string()))?;
        self.place_version(project_id, project_type, version, unlocked)
    }

    fn place_version(
        &self,
        project_id: &str,
        project_type: &str,
        version: ResolvedVersion,
        allow_disable_managed: bool,
    ) -> Result<InstalledMod> {
        let installer = Installer::new();
        let modrinth = installer.modrinth(self.paths.modrinth_cache_dir());
        let folder = folder_for(project_type);

        let bytes = modrinth.download(&version.url)?;
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
                    if m.modrinth_id.as_deref() == Some(project_id) {
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

        let project = modrinth.project(project_id);
        let name = project
            .as_ref()
            .map(|p| p.title.clone())
            .unwrap_or_else(|| version.filename.clone());

        let mut user = self.load_user();
        for old in user.items.iter().filter(|i| {
            i.modrinth_id.as_deref() == Some(project_id) && i.path != rel
        }) {
            let _ = std::fs::remove_file(game_dir.join(&old.path));
            let _ = std::fs::remove_file(game_dir.join(format!("{}.disabled", old.path)));
        }
        user.items.retain(|i| {
            i.path != rel && i.modrinth_id.as_deref() != Some(project_id)
        });
        user.items.push(UserItem {
            name: name.clone(),
            filename: version.filename.clone(),
            path: rel.clone(),
            category: folder.to_string(),
            modrinth_id: Some(project_id.to_string()),
            modrinth_version: Some(version.version_id.clone()),
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
            modrinth_id: Some(project_id.to_string()),
            modrinth_version: Some(version.version_id),
            version: Some(version.version_number),
            title: project.as_ref().map(|p| p.title.clone()),
            description: project.as_ref().map(|p| p.description.clone()),
            icon_url: project.and_then(|p| p.icon_url),
        })
    }

    pub fn relock_reconcile(&self) -> Result<()> {
        let game_dir = self.game_dir();
        let manifest = self.manifest()?;
        let managed_ids: Vec<String> = manifest
            .mods
            .iter()
            .filter_map(|m| m.modrinth_id.clone())
            .collect();

        for m in manifest.mods.iter() {
            let disabled = game_dir.join(format!("{}.disabled", m.path));
            if disabled.exists() {
                let _ = std::fs::rename(&disabled, game_dir.join(&m.path));
            }
        }

        let mut user = self.load_user();
        let removed: Vec<_> = user
            .items
            .iter()
            .filter(|i| {
                i.modrinth_id
                    .as_deref()
                    .map(|id| managed_ids.iter().any(|m| m == id))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        for item in &removed {
            let _ = std::fs::remove_file(game_dir.join(&item.path));
            let _ = std::fs::remove_file(game_dir.join(format!("{}.disabled", item.path)));
        }
        user.items.retain(|i| {
            !i.modrinth_id
                .as_deref()
                .map(|id| managed_ids.iter().any(|m| m == id))
                .unwrap_or(false)
        });
        self.save_user(&user)?;
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

fn loader_for(project_type: &str) -> Option<&'static str> {
    match project_type {
        "mod" => Some(LOADER),
        _ => None,
    }
}

fn folder_for(project_type: &str) -> &'static str {
    match project_type {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        _ => "mods",
    }
}
