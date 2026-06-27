use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::featured::FeaturedPack;
use crate::paths::Paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoaderKind {
    Vanilla,
    NeoForge,
    Forge,
    Fabric,
    Quilt,
}

impl LoaderKind {
    pub fn content_loader(self) -> Option<&'static str> {
        match self {
            LoaderKind::Vanilla => None,
            LoaderKind::NeoForge => Some("neoforge"),
            LoaderKind::Forge => Some("forge"),
            LoaderKind::Fabric => Some("fabric"),
            LoaderKind::Quilt => Some("quilt"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            LoaderKind::Vanilla => "vanilla",
            LoaderKind::NeoForge => "neoforge",
            LoaderKind::Forge => "forge",
            LoaderKind::Fabric => "fabric",
            LoaderKind::Quilt => "quilt",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            LoaderKind::Vanilla => "Vanilla",
            LoaderKind::NeoForge => "NeoForge",
            LoaderKind::Forge => "Forge",
            LoaderKind::Fabric => "Fabric",
            LoaderKind::Quilt => "Quilt",
        }
    }

    pub fn parse(s: &str) -> LoaderKind {
        match s.to_ascii_lowercase().as_str() {
            "neoforge" | "neo_forge" => LoaderKind::NeoForge,
            "forge" => LoaderKind::Forge,
            "fabric" => LoaderKind::Fabric,
            "quilt" => LoaderKind::Quilt,
            _ => LoaderKind::Vanilla,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "channel", content = "value", rename_all = "snake_case")]
pub enum LoaderVersion {
    Stable,
    Unstable,
    Exact(String),
}

impl Default for LoaderVersion {
    fn default() -> Self {
        LoaderVersion::Stable
    }
}

impl LoaderVersion {
    pub fn parse(s: &str) -> LoaderVersion {
        match s.trim().to_ascii_lowercase().as_str() {
            "" | "stable" | "latest" | "recommended" => LoaderVersion::Stable,
            "unstable" | "snapshot" | "latest-unstable" => LoaderVersion::Unstable,
            other => LoaderVersion::Exact(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PackSource {
    None,
    Packwiz {
        url: String,
                        #[serde(default)]
        unsup: bool,
    },
    Modrinth {
        #[serde(default)]
        project_id: Option<String>,
        version_id: String,
    },
    Curseforge {
        project_id: String,
        file_id: String,
    },
}

impl Default for PackSource {
    fn default() -> Self {
        PackSource::None
    }
}

impl PackSource {
    pub fn is_managed(&self) -> bool {
        !matches!(self, PackSource::None)
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub minecraft_version: String,
    pub loader: LoaderKind,
    #[serde(default)]
    pub loader_version: LoaderVersion,

    #[serde(default)]
    pub max_memory_mb: Option<u32>,
    #[serde(default)]
    pub min_memory_mb: Option<u32>,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub java_policy: Option<String>,
    #[serde(default)]
    pub extra_jvm_args: Vec<String>,
    #[serde(default)]
    pub resolution: Option<(u16, u16)>,
    #[serde(default)]
    pub pre_launch_command: Option<String>,
    #[serde(default)]
    pub post_exit_command: Option<String>,

    #[serde(default)]
    pub pack: PackSource,
    #[serde(default)]
    pub featured: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default = "default_true")]
    pub modpack_locked: bool,

    #[serde(default)]
    pub news_url: Option<String>,
    #[serde(default)]
    pub playercount_url: Option<String>,
    #[serde(default = "default_true")]
    pub show_news: bool,
    #[serde(default = "default_true")]
    pub show_playercount: bool,

    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub last_played: Option<DateTime<Utc>>,
    #[serde(default)]
    pub playtime_seconds: u64,

    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub optional_mods: Option<Vec<String>>,
    #[serde(default)]
    pub unsup_flavors: Option<Vec<String>>,
    #[serde(default)]
    pub unsup_public_key: Option<String>,
    #[serde(default)]
    pub pinned_settings: Vec<String>,
    #[serde(default)]
    pub account_override: Option<String>,
    #[serde(default)]
    pub auto_join: Option<crate::launch::QuickPlay>,
    #[serde(default)]
    pub share: Option<PackShare>,
    #[serde(default)]
    pub shared_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackShare {
    pub repo_owner: String,
    pub repo_name: String,
    pub repo_url: String,
    #[serde(default = "default_main")]
    pub branch: String,
    pub pack_url: String,
    pub config_id: String,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub last_published: Option<DateTime<Utc>>,
    #[serde(default)]
    pub published_version: Option<String>,
    #[serde(default)]
    pub published_index_hash: Option<String>,
    #[serde(default)]
    pub published_signature: Option<String>,
    #[serde(default)]
    pub incomplete: bool,
    #[serde(default)]
    pub provider: crate::forge::Provider,
    #[serde(default)]
    pub params: SharePackParams,
    #[serde(default)]
    pub published_params: SharePackParams,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SharePackParams {
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub min_memory_mb: Option<u32>,
    #[serde(default)]
    pub max_memory_mb: Option<u32>,
    #[serde(default)]
    pub jvm_args: Vec<String>,
    #[serde(default)]
    pub news_url: Option<String>,
    #[serde(default)]
    pub playercount_url: Option<String>,
}

fn default_main() -> String {
    "main".to_string()
}

/// Classification of a dropped/picked modpack file (see `detect_pack_file`).
#[derive(Debug, Clone, Serialize)]
pub struct PackFileKind {
    /// `"packwiz"`, `"mrpack"`, or `"curseforge"`.
    pub kind: String,
    /// Install source for `mrpack`/`curseforge` (`"modrinth"`/`"curseforge"`);
    /// `None` for packwiz (which installs from an extracted local pack URL).
    pub source: Option<String>,
    /// Whether a packwiz pack carries unsup (flavors/signing).
    pub unsup: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublishResult {
    pub needs_confirm: bool,
    pub embedded: Vec<String>,
    pub share: Option<PackShare>,
}

impl Instance {
    pub fn from_featured(fp: &FeaturedPack) -> Self {
        Self {
            id: fp.id.clone(),
            name: fp.name.clone(),
            minecraft_version: fp.mc_version.clone(),
            loader: LoaderKind::parse(&fp.loader),
            loader_version: LoaderVersion::parse(&fp.loader_version),
            max_memory_mb: None,
            min_memory_mb: None,
            java_path: None,
            java_policy: None,
            extra_jvm_args: Vec::new(),
            resolution: None,
            pre_launch_command: None,
            post_exit_command: None,
            pack: PackSource::Packwiz {
                url: fp.pack_url.clone(),
                unsup: fp.unsup,
            },
            featured: true,
            pinned: false,
            icon: fp.icon.clone(),
            banner: fp.banner.clone(),
            logo: fp.logo.clone(),
            modpack_locked: fp.locked_default,
            news_url: fp.news_url.clone(),
            playercount_url: fp.playercount_url.clone(),
            show_news: fp.news_url.is_some(),
            show_playercount: fp.playercount_url.is_some(),
            created_at: Utc::now(),
            last_played: None,
            playtime_seconds: 0,
            notes: None,
            tags: Vec::new(),
            folder_id: None,
            optional_mods: None,
            unsup_flavors: None,
            unsup_public_key: fp.unsup_public_key.clone(),
                                    pinned_settings: vec!["open_settings".to_string()],
            account_override: None,
            auto_join: None,
            share: None,
            shared_by: None,
        }
    }

    pub fn new_custom(
        id: impl Into<String>,
        name: impl Into<String>,
        minecraft_version: impl Into<String>,
        loader: LoaderKind,
        loader_version: LoaderVersion,
        pack: PackSource,
    ) -> Self {
        let modpack_locked = !matches!(pack, PackSource::None);
                                let pinned_settings = if modpack_locked {
            vec!["open_settings".to_string()]
        } else {
            Vec::new()
        };
        Self {
            id: id.into(),
            name: name.into(),
            minecraft_version: minecraft_version.into(),
            loader,
            loader_version,
            max_memory_mb: None,
            min_memory_mb: None,
            java_path: None,
            java_policy: None,
            extra_jvm_args: Vec::new(),
            resolution: None,
            pre_launch_command: None,
            post_exit_command: None,
            pack,
            featured: false,
            pinned: false,
            icon: Some("builtin:box".to_string()),
            banner: None,
            logo: None,
            modpack_locked,
            news_url: None,
            playercount_url: None,
            show_news: false,
            show_playercount: false,
            created_at: Utc::now(),
            last_played: None,
            playtime_seconds: 0,
            notes: None,
            tags: Vec::new(),
            folder_id: None,
            optional_mods: None,
            unsup_flavors: None,
            unsup_public_key: None,
            pinned_settings,
            account_override: None,
            auto_join: None,
            share: None,
            shared_by: None,
        }
    }

    fn load_from(paths: &Paths, id: &str) -> Result<Self> {
        let file = paths.instance_config(id);
        let bytes = std::fs::read(&file).map_err(|e| CoreError::io(&file, e))?;
        serde_json::from_slice(&bytes).map_err(|e| CoreError::serde(file.display().to_string(), e))
    }

    pub fn save(&self, paths: &Paths) -> Result<()> {
        let dir = paths.instance_dir(&self.id);
        std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        let game_dir = paths.instance_game_dir(&self.id);
        std::fs::create_dir_all(&game_dir).map_err(|e| CoreError::io(&game_dir, e))?;

        let file = paths.instance_config(&self.id);
        let json = serde_json::to_vec_pretty(self)
            .map_err(|e| CoreError::serde(file.display().to_string(), e))?;
        std::fs::write(&file, json).map_err(|e| CoreError::io(&file, e))
    }
}

#[derive(Debug, Clone)]
pub struct InstanceManager {
    paths: Paths,
}

impl InstanceManager {
    pub fn new(paths: Paths) -> Self {
        Self { paths }
    }

    pub fn list(&self) -> Result<Vec<Instance>> {
        let dir = self.paths.instances_dir();
        let mut out = Vec::new();
        let read = match std::fs::read_dir(&dir) {
            Ok(read) => read,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(CoreError::io(&dir, e)),
        };
        for entry in read {
            let entry = entry.map_err(|e| CoreError::io(&dir, e))?;
            if !entry.path().is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            if self.paths.instance_config(&id).exists() {
                out.push(Instance::load_from(&self.paths, &id)?);
            }
        }
        out.sort_by(|a, b| {
            b.featured
                .cmp(&a.featured)
                .then_with(|| b.pinned.cmp(&a.pinned))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Instance> {
        if !self.paths.instance_config(id).exists() {
            return Err(CoreError::InstanceNotFound(id.to_string()));
        }
        Instance::load_from(&self.paths, id)
    }

    pub fn create(&self, instance: Instance) -> Result<Instance> {
        if self.paths.instance_config(&instance.id).exists() {
            return Err(CoreError::InstanceExists(instance.id.clone()));
        }
        instance.save(&self.paths)?;
        Ok(instance)
    }

    pub fn update(&self, instance: &Instance) -> Result<()> {
        if !self.paths.instance_config(&instance.id).exists() {
            return Err(CoreError::InstanceNotFound(instance.id.clone()));
        }
        instance.save(&self.paths)
    }

    pub fn import_branding(&self, id: &str, kind: &str, src: &std::path::Path) -> Result<String> {
        if !self.paths.instance_config(id).exists() {
            return Err(CoreError::InstanceNotFound(id.to_string()));
        }
        if !matches!(kind, "icon" | "banner" | "logo") {
            return Err(CoreError::Modpack(format!("unknown branding kind '{kind}'")));
        }
        let ext = src
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .filter(|e| {
                matches!(
                    e.as_str(),
                    "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg"
                )
            })
            .unwrap_or_else(|| "png".to_string());
        let dir = self.paths.instance_dir(id).join("branding");
        std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        if let Ok(read) = std::fs::read_dir(&dir) {
            for entry in read.flatten() {
                let p = entry.path();
                if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                    if name.starts_with(&format!("{kind}-")) || name.starts_with(&format!("{kind}.")) {
                        let _ = std::fs::remove_file(&p);
                    }
                }
            }
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let dest = dir.join(format!("{kind}-{stamp}.{ext}"));
        std::fs::copy(src, &dest).map_err(|e| CoreError::io(&dest, e))?;
        Ok(dest.to_string_lossy().to_string())
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let instance = self.get(id)?;
        if instance.featured {
            return Err(CoreError::Modpack(
                "Featured packs can't be deleted".to_string(),
            ));
        }
        let dir = self.paths.instance_dir(id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        }
        Ok(())
    }

    pub fn ensure_featured(&self) -> Result<()> {
        let featured = crate::featured::featured_packs();
        let featured_ids: std::collections::HashSet<&str> =
            featured.iter().map(|fp| fp.id.as_str()).collect();

        for fp in &featured {
            match self.get(&fp.id) {
                Ok(mut inst) => {
                    inst.featured = true;
                                                                                                    match &mut inst.pack {
                        PackSource::Packwiz { unsup, .. } => *unsup = fp.unsup,
                        _ => {
                            inst.pack = PackSource::Packwiz {
                                url: fp.pack_url.clone(),
                                unsup: fp.unsup,
                            }
                        }
                    }
                    inst.unsup_public_key = fp.unsup_public_key.clone();
                    inst.icon = fp.icon.clone();
                    inst.banner = fp.banner.clone();
                    inst.logo = fp.logo.clone();
                    inst.news_url = fp.news_url.clone();
                    inst.playercount_url = fp.playercount_url.clone();
                    self.update(&inst)?;
                }
                Err(CoreError::InstanceNotFound(_)) => {
                    self.create(Instance::from_featured(fp))?;
                }
                Err(e) => return Err(e),
            }
        }

                                for mut inst in self.list()? {
            if inst.featured && !featured_ids.contains(inst.id.as_str()) {
                inst.featured = false;
                self.update(&inst)?;
            }
        }
        Ok(())
    }

    pub fn unique_id(&self, name: &str) -> String {
        let mut base: String = name
            .trim()
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        while base.contains("--") {
            base = base.replace("--", "-");
        }
        let base = base.trim_matches('-').to_string();
        let base = if base.is_empty() { "instance".to_string() } else { base };
        if !self.paths.instance_config(&base).exists() {
            return base;
        }
        for n in 2.. {
            let candidate = format!("{base}-{n}");
            if !self.paths.instance_config(&candidate).exists() {
                return candidate;
            }
        }
        unreachable!()
    }

    pub fn unique_name(&self, base: &str) -> String {
        let existing: Vec<String> = self
            .list()
            .unwrap_or_default()
            .into_iter()
            .map(|i| i.name)
            .collect();
        if !existing.iter().any(|n| n == base) {
            return base.to_string();
        }
        for n in 2.. {
            let candidate = format!("{base} ({n})");
            if !existing.iter().any(|n| n == &candidate) {
                return candidate;
            }
        }
        unreachable!()
    }

    pub fn default_id(&self) -> Option<String> {
        self.list().ok().and_then(|list| {
            list.iter()
                .find(|i| i.featured)
                .or_else(|| list.first())
                .map(|i| i.id.clone())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loader_parse_and_label() {
        assert_eq!(LoaderKind::parse("neo_forge"), LoaderKind::NeoForge);
        assert_eq!(LoaderKind::parse("QUILT"), LoaderKind::Quilt);
        assert_eq!(LoaderKind::parse("fabric"), LoaderKind::Fabric);
        assert_eq!(LoaderKind::parse("nonsense"), LoaderKind::Vanilla);
        assert_eq!(LoaderKind::NeoForge.label(), "NeoForge");
        assert_eq!(LoaderKind::Quilt.content_loader(), Some("quilt"));
        assert_eq!(LoaderKind::Vanilla.content_loader(), None);
    }

    #[test]
    fn loader_version_parse() {
        assert_eq!(LoaderVersion::parse(""), LoaderVersion::Stable);
        assert_eq!(LoaderVersion::parse("latest"), LoaderVersion::Stable);
        assert_eq!(
            LoaderVersion::parse("0.16.0"),
            LoaderVersion::Exact("0.16.0".to_string())
        );
    }

    #[test]
    fn custom_lock_defaults_by_pack() {
        let custom = Instance::new_custom(
            "a",
            "A",
            "1.21.1",
            LoaderKind::Fabric,
            LoaderVersion::Stable,
            PackSource::None,
        );
        assert!(!custom.modpack_locked, "custom instances start unlocked");

        let pack = Instance::new_custom(
            "b",
            "B",
            "1.21.1",
            LoaderKind::Fabric,
            LoaderVersion::Stable,
            PackSource::Modrinth {
                project_id: None,
                version_id: "v".to_string(),
            },
        );
        assert!(pack.modpack_locked, "modpack-backed instances start locked");
    }

    #[test]
    fn pack_source_serde_tagged() {
        let p = PackSource::Packwiz {
            url: "u".to_string(),
            unsup: true,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"kind\":\"packwiz\""));
        let none: PackSource = serde_json::from_str(r#"{"kind":"none"}"#).unwrap();
        assert_eq!(none, PackSource::None);
                let legacy: PackSource =
            serde_json::from_str(r#"{"kind":"packwiz","url":"u"}"#).unwrap();
        assert_eq!(legacy, PackSource::Packwiz { url: "u".into(), unsup: false });
    }
}

#[cfg(test)]
mod instance_more {
    use super::*;
    use crate::featured::featured_packs;
    use crate::paths::Paths;

    fn manager() -> (tempfile::TempDir, InstanceManager) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(dir.path());
        paths.ensure_base().unwrap();
        (dir, InstanceManager::new(paths))
    }

    fn custom(id: &str, name: &str) -> Instance {
        Instance::new_custom(
            id,
            name,
            "1.21.1",
            LoaderKind::Vanilla,
            LoaderVersion::Stable,
            PackSource::None,
        )
    }

    #[test]
    fn loader_kind_roundtrip_strings() {
        for (text, kind) in [
            ("vanilla", LoaderKind::Vanilla),
            ("neoforge", LoaderKind::NeoForge),
            ("neo_forge", LoaderKind::NeoForge),
            ("forge", LoaderKind::Forge),
            ("fabric", LoaderKind::Fabric),
            ("quilt", LoaderKind::Quilt),
        ] {
            assert_eq!(LoaderKind::parse(text), kind);
        }
        assert_eq!(LoaderKind::parse("UNKNOWN"), LoaderKind::Vanilla);
    }

    #[test]
    fn loader_kind_str_and_label() {
        assert_eq!(LoaderKind::Vanilla.as_str(), "vanilla");
        assert_eq!(LoaderKind::NeoForge.as_str(), "neoforge");
        assert_eq!(LoaderKind::Forge.as_str(), "forge");
        assert_eq!(LoaderKind::Fabric.as_str(), "fabric");
        assert_eq!(LoaderKind::Quilt.as_str(), "quilt");
        assert_eq!(LoaderKind::NeoForge.label(), "NeoForge");
        assert_eq!(LoaderKind::Forge.label(), "Forge");
    }

    #[test]
    fn loader_kind_content_loader() {
        assert_eq!(LoaderKind::Vanilla.content_loader(), None);
        assert_eq!(LoaderKind::NeoForge.content_loader(), Some("neoforge"));
        assert_eq!(LoaderKind::Forge.content_loader(), Some("forge"));
        assert_eq!(LoaderKind::Fabric.content_loader(), Some("fabric"));
        assert_eq!(LoaderKind::Quilt.content_loader(), Some("quilt"));
    }

    #[test]
    fn loader_version_channels() {
        assert_eq!(LoaderVersion::parse(""), LoaderVersion::Stable);
        assert_eq!(LoaderVersion::parse("stable"), LoaderVersion::Stable);
        assert_eq!(LoaderVersion::parse("latest"), LoaderVersion::Stable);
        assert_eq!(LoaderVersion::parse("recommended"), LoaderVersion::Stable);
        assert_eq!(LoaderVersion::parse("unstable"), LoaderVersion::Unstable);
        assert_eq!(LoaderVersion::parse("snapshot"), LoaderVersion::Unstable);
        assert_eq!(LoaderVersion::parse("latest-unstable"), LoaderVersion::Unstable);
    }

    #[test]
    fn loader_version_exact_is_lowercased_and_trimmed() {
        assert_eq!(
            LoaderVersion::parse("  0.16.0  "),
            LoaderVersion::Exact("0.16.0".to_string())
        );
        assert_eq!(
            LoaderVersion::parse("Beta1"),
            LoaderVersion::Exact("beta1".to_string())
        );
    }

    #[test]
    fn loader_version_default_is_stable() {
        assert_eq!(LoaderVersion::default(), LoaderVersion::Stable);
    }

    #[test]
    fn pack_source_managed_flag() {
        assert!(!PackSource::None.is_managed());
        assert!(PackSource::Packwiz { url: "u".into(), unsup: false }.is_managed());
        assert!(PackSource::Modrinth { project_id: None, version_id: "v".into() }.is_managed());
        assert!(PackSource::Curseforge { project_id: "1".into(), file_id: "2".into() }.is_managed());
    }

    #[test]
    fn pack_source_serde_variants() {
        let m = PackSource::Modrinth { project_id: Some("p".into()), version_id: "v".into() };
        let json = serde_json::to_string(&m).unwrap();
        let back: PackSource = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);

        let c: PackSource =
            serde_json::from_str(r#"{"kind":"curseforge","project_id":"1","file_id":"2"}"#).unwrap();
        assert_eq!(c, PackSource::Curseforge { project_id: "1".into(), file_id: "2".into() });
    }

    #[test]
    fn new_custom_lock_and_pins() {
        let plain = custom("a", "A");
        assert!(!plain.modpack_locked);
        assert!(plain.pinned_settings.is_empty());

        let managed = Instance::new_custom(
            "b",
            "B",
            "1.21.1",
            LoaderKind::Fabric,
            LoaderVersion::Stable,
            PackSource::Modrinth { project_id: None, version_id: "v".into() },
        );
        assert!(managed.modpack_locked);
        assert_eq!(managed.pinned_settings, vec!["open_settings".to_string()]);
    }

    #[test]
    fn from_featured_marks_featured() {
        let packs = featured_packs();
        let fp = packs.first().expect("a bundled featured pack");
        let inst = Instance::from_featured(fp);
        assert!(inst.featured);
        assert_eq!(inst.id, fp.id);
        assert_eq!(inst.name, fp.name);
        assert!(inst.pack.is_managed());
    }

    #[test]
    fn create_get_update_delete() {
        let (_d, m) = manager();
        let inst = m.create(custom("x", "X")).unwrap();
        assert_eq!(m.get("x").unwrap().name, "X");
        let mut updated = inst.clone();
        updated.name = "Renamed".to_string();
        m.update(&updated).unwrap();
        assert_eq!(m.get("x").unwrap().name, "Renamed");
        m.delete("x").unwrap();
        assert!(m.get("x").is_err());
    }

    #[test]
    fn create_rejects_duplicate_id() {
        let (_d, m) = manager();
        m.create(custom("x", "X")).unwrap();
        assert!(m.create(custom("x", "Y")).is_err());
    }

    #[test]
    fn list_sorts_pinned_then_name() {
        let (_d, m) = manager();
        let mut zebra = custom("zebra", "Zebra");
        zebra.pinned = true;
        let mut mango = custom("mango", "Mango");
        mango.pinned = true;
        let apple = custom("apple", "apple");
        m.create(zebra).unwrap();
        m.create(apple).unwrap();
        m.create(mango).unwrap();
        let ids: Vec<String> = m.list().unwrap().into_iter().map(|i| i.id).collect();
        assert_eq!(ids, vec!["mango", "zebra", "apple"]);
    }

    #[test]
    fn default_id_prefers_first() {
        let (_d, m) = manager();
        assert!(m.default_id().is_none());
        m.create(custom("only", "Only")).unwrap();
        assert_eq!(m.default_id(), Some("only".to_string()));
    }

    #[test]
    fn unique_id_slugs_names() {
        let (_d, m) = manager();
        assert_eq!(m.unique_id("My Cool Pack!!"), "my-cool-pack");
        assert_eq!(m.unique_id("   "), "instance");
        assert_eq!(m.unique_id("***"), "instance");
        assert_eq!(m.unique_id("Already-Good"), "already-good");
    }

    #[test]
    fn unique_id_avoids_collision() {
        let (_d, m) = manager();
        m.create(custom("my-pack", "My Pack")).unwrap();
        assert_eq!(m.unique_id("My Pack"), "my-pack-2");
    }

    #[test]
    fn unique_name_avoids_collision() {
        let (_d, m) = manager();
        m.create(custom("p", "Pack")).unwrap();
        assert_eq!(m.unique_name("Pack"), "Pack (2)");
        assert_eq!(m.unique_name("Other"), "Other");
    }

    #[test]
    fn import_branding_copies_into_instance() {
        let (dir, m) = manager();
        m.create(custom("x", "X")).unwrap();
        let src = dir.path().join("source.png");
        std::fs::write(&src, b"img").unwrap();
        let dest = m.import_branding("x", "icon", &src).unwrap();
        let dest_path = std::path::Path::new(&dest);
        assert!(dest_path.is_file());
        assert!(dest_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("icon-"));
        assert!(dest.ends_with(".png"));
    }

    #[test]
    fn import_branding_falls_back_extension() {
        let (dir, m) = manager();
        m.create(custom("x", "X")).unwrap();
        let src = dir.path().join("source.txt");
        std::fs::write(&src, b"img").unwrap();
        let dest = m.import_branding("x", "banner", &src).unwrap();
        assert!(dest.ends_with(".png"));
        assert!(std::path::Path::new(&dest)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("banner-"));
    }

    #[test]
    fn import_branding_rejects_bad_kind_and_missing_instance() {
        let (dir, m) = manager();
        m.create(custom("x", "X")).unwrap();
        let src = dir.path().join("source.png");
        std::fs::write(&src, b"img").unwrap();
        assert!(m.import_branding("x", "bogus", &src).is_err());
        assert!(m.import_branding("nope", "icon", &src).is_err());
    }
}
