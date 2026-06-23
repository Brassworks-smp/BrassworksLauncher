use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};

#[derive(Debug, Clone)]
pub struct Paths {
    root: PathBuf,
}

impl Paths {
    pub fn with_root(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn default() -> Result<Self> {
        let base = dirs::data_dir().ok_or(CoreError::NoDataDir)?;
        Ok(Self::with_root(base.join("BrassworksLauncher")))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn shared_dir(&self) -> PathBuf {
        self.root.join("shared")
    }

    pub fn instances_dir(&self) -> PathBuf {
        self.root.join("instances")
    }

    pub fn instance_dir(&self, id: &str) -> PathBuf {
        self.instances_dir().join(id)
    }

    pub fn instance_game_dir(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("minecraft")
    }

    pub fn instance_config(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("instance.json")
    }

    pub fn instance_assets_dir(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("assets")
    }

    pub fn modpack_manifest(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("packwiz.json")
    }

    pub fn user_content(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("user_content.json")
    }

    pub fn stars_file(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("stars.json")
    }

    pub fn instance_saves_dir(&self, id: &str) -> PathBuf {
        self.instance_game_dir(id).join("saves")
    }

    pub fn instance_servers_file(&self, id: &str) -> PathBuf {
        self.instance_game_dir(id).join("servers.dat")
    }

    pub fn datapacks_index(&self, id: &str) -> PathBuf {
        self.instance_dir(id).join("datapacks.json")
    }

    pub fn instance_game_subdir(&self, id: &str, sub: &str) -> PathBuf {
        self.instance_game_dir(id).join(sub)
    }

    pub fn modrinth_cache_dir(&self) -> PathBuf {
        self.shared_dir().join("modrinth-cache")
    }

    pub fn curseforge_cache_dir(&self) -> PathBuf {
        self.shared_dir().join("curseforge-cache")
    }

    pub fn modpack_cache_dir(&self) -> PathBuf {
        self.shared_dir().join("modpack-cache")
    }

    pub fn modpack_archive_cache(&self, source: &str, version_id: &str) -> PathBuf {
        let safe: String = version_id
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        self.modpack_cache_dir().join(format!("{source}-{safe}.zip"))
    }

    pub fn jvm_dir(&self) -> PathBuf {
        self.shared_dir().join("jvm")
    }

    pub fn thumbnails_dir(&self) -> PathBuf {
        self.root().join("thumbnails")
    }

    pub fn image_cache_dir(&self) -> PathBuf {
        self.root().join("image-cache")
    }

    pub fn skins_dir(&self) -> PathBuf {
        self.shared_dir().join("skins")
    }

    pub fn skins_index(&self) -> PathBuf {
        self.skins_dir().join("skins.json")
    }

    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    pub fn accounts_file(&self) -> PathBuf {
        self.root.join("accounts.json")
    }

    pub fn msa_db_file(&self) -> PathBuf {
        self.root.join("msa_accounts.json")
    }

    pub fn ensure_base(&self) -> Result<()> {
        for dir in [self.root.clone(), self.shared_dir(), self.instances_dir()] {
            std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod paths_tests {
    use super::Paths;
    use std::path::Path;

    fn paths() -> Paths {
        Paths::with_root("root")
    }

    #[test]
    fn root_is_preserved() {
        assert_eq!(paths().root(), Path::new("root"));
    }

    #[test]
    fn top_level_dirs() {
        let p = paths();
        assert_eq!(p.shared_dir(), Path::new("root").join("shared"));
        assert_eq!(p.instances_dir(), Path::new("root").join("instances"));
        assert_eq!(p.thumbnails_dir(), Path::new("root").join("thumbnails"));
    }

    #[test]
    fn instance_paths() {
        let p = paths();
        let base = Path::new("root").join("instances").join("foo");
        assert_eq!(p.instance_dir("foo"), base);
        assert_eq!(p.instance_game_dir("foo"), base.join("minecraft"));
        assert_eq!(p.instance_config("foo"), base.join("instance.json"));
        assert_eq!(p.instance_assets_dir("foo"), base.join("assets"));
        assert_eq!(p.modpack_manifest("foo"), base.join("packwiz.json"));
        assert_eq!(p.user_content("foo"), base.join("user_content.json"));
        assert_eq!(p.stars_file("foo"), base.join("stars.json"));
        assert_eq!(p.datapacks_index("foo"), base.join("datapacks.json"));
    }

    #[test]
    fn game_sub_paths() {
        let p = paths();
        let game = Path::new("root").join("instances").join("foo").join("minecraft");
        assert_eq!(p.instance_saves_dir("foo"), game.join("saves"));
        assert_eq!(p.instance_servers_file("foo"), game.join("servers.dat"));
        assert_eq!(p.instance_game_subdir("foo", "mods"), game.join("mods"));
        assert_eq!(p.instance_game_subdir("foo", "config"), game.join("config"));
    }

    #[test]
    fn shared_caches_and_jvm() {
        let p = paths();
        let shared = Path::new("root").join("shared");
        assert_eq!(p.modrinth_cache_dir(), shared.join("modrinth-cache"));
        assert_eq!(p.curseforge_cache_dir(), shared.join("curseforge-cache"));
        assert_eq!(p.modpack_cache_dir(), shared.join("modpack-cache"));
        assert_eq!(
            p.modpack_archive_cache("modrinth", "aBc123"),
            shared.join("modpack-cache").join("modrinth-aBc123.zip")
        );
        assert_eq!(
            p.modpack_archive_cache("curseforge", "12/34"),
            shared.join("modpack-cache").join("curseforge-12_34.zip")
        );
        assert_eq!(p.jvm_dir(), shared.join("jvm"));
        assert_eq!(p.skins_dir(), shared.join("skins"));
        assert_eq!(p.skins_index(), shared.join("skins").join("skins.json"));
    }

    #[test]
    fn root_level_files() {
        let p = paths();
        let root = Path::new("root");
        assert_eq!(p.settings_file(), root.join("settings.json"));
        assert_eq!(p.accounts_file(), root.join("accounts.json"));
        assert_eq!(p.msa_db_file(), root.join("msa_accounts.json"));
    }

    #[test]
    fn ids_are_kept_distinct() {
        let p = paths();
        assert_ne!(p.instance_dir("a"), p.instance_dir("b"));
        assert_eq!(
            p.instance_config("with-dashes"),
            Path::new("root")
                .join("instances")
                .join("with-dashes")
                .join("instance.json")
        );
    }

    #[test]
    fn absolute_root_is_respected() {
        let p = Paths::with_root("/data/bw");
        assert_eq!(p.instances_dir(), Path::new("/data/bw").join("instances"));
    }
}
