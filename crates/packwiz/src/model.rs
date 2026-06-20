use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Pack {
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    #[serde(rename = "pack-format", default)]
    pub pack_format: String,
    pub index: PackIndex,
    #[serde(default)]
    pub versions: Versions,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PackIndex {
    pub file: String,
    #[serde(rename = "hash-format", default)]
    pub hash_format: String,
    #[serde(default)]
    pub hash: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Versions {
    #[serde(default)]
    pub minecraft: Option<String>,
    #[serde(default)]
    pub neoforge: Option<String>,
    #[serde(default)]
    pub forge: Option<String>,
    #[serde(default)]
    pub fabric: Option<String>,
    #[serde(default)]
    pub quilt: Option<String>,
            #[serde(default)]
    pub unsup: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Index {
    #[serde(rename = "hash-format", default = "default_index_hash_format")]
    pub hash_format: String,
    #[serde(default)]
    pub files: Vec<IndexFile>,
}

fn default_index_hash_format() -> String {
    "sha256".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct IndexFile {
    pub file: String,
    #[serde(default)]
    pub hash: String,
    #[serde(rename = "hash-format", default)]
    pub hash_format: Option<String>,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(default)]
    pub metafile: bool,
    #[serde(default)]
    pub preserve: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetaFile {
    pub name: String,
    pub filename: String,
    #[serde(default = "default_side")]
    pub side: String,
    pub download: Download,
    #[serde(default)]
    pub update: Option<Update>,
        #[serde(default)]
    pub option: Option<ModOption>,
}

fn default_side() -> String {
    "both".to_string()
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ModOption {
    #[serde(default)]
    pub optional: bool,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Download {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(rename = "hash-format", default)]
    pub hash_format: String,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Update {
    #[serde(default)]
    pub modrinth: Option<ModrinthUpdate>,
    #[serde(default)]
    pub curseforge: Option<CurseforgeUpdate>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModrinthUpdate {
    #[serde(rename = "mod-id")]
    pub mod_id: String,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CurseforgeUpdate {
    #[serde(rename = "project-id", default)]
    pub project_id: i64,
    #[serde(rename = "file-id", default)]
    pub file_id: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_optional_metafile() {
        let toml = r#"
            name = "Cool Mod"
            filename = "coolmod.jar"
            side = "client"
            [download]
            url = "https://example.com/coolmod.jar"
            hash-format = "sha256"
            hash = "abc"
            [option]
            optional = true
            default = false
            description = "Adds cool things"
        "#;
        let meta: MetaFile = toml::from_str(toml).unwrap();
        let opt = meta.option.expect("has [option]");
        assert!(opt.optional);
        assert!(!opt.default);
        assert_eq!(opt.description.as_deref(), Some("Adds cool things"));
    }

    #[test]
    fn non_optional_metafile_has_no_option() {
        let toml = r#"
            name = "Required Mod"
            filename = "req.jar"
            [download]
            url = "https://example.com/req.jar"
            hash-format = "sha256"
            hash = "abc"
        "#;
        let meta: MetaFile = toml::from_str(toml).unwrap();
        assert!(meta.option.is_none());
    }
}

#[cfg(test)]
mod model_more {
    use super::*;

    #[test]
    fn parse_pack_with_versions() {
        let toml = r#"
            name = "My Pack"
            author = "swzo"
            version = "1.0.0"
            pack-format = "packwiz:1.1.0"
            [index]
            file = "index.toml"
            hash-format = "sha256"
            hash = "abcdef"
            [versions]
            minecraft = "1.21.1"
            neoforge = "21.1.0"
        "#;
        let pack: Pack = toml::from_str(toml).unwrap();
        assert_eq!(pack.name, "My Pack");
        assert_eq!(pack.author, "swzo");
        assert_eq!(pack.version, "1.0.0");
        assert_eq!(pack.pack_format, "packwiz:1.1.0");
        assert_eq!(pack.index.file, "index.toml");
        assert_eq!(pack.index.hash_format, "sha256");
        assert_eq!(pack.index.hash, "abcdef");
        assert_eq!(pack.versions.minecraft.as_deref(), Some("1.21.1"));
        assert_eq!(pack.versions.neoforge.as_deref(), Some("21.1.0"));
        assert!(pack.versions.fabric.is_none());
    }

    #[test]
    fn parse_pack_minimal() {
        let toml = r#"
            name = "Bare"
            [index]
            file = "index.toml"
        "#;
        let pack: Pack = toml::from_str(toml).unwrap();
        assert_eq!(pack.name, "Bare");
        assert_eq!(pack.author, "");
        assert_eq!(pack.version, "");
        assert!(pack.versions.minecraft.is_none());
    }

    #[test]
    fn index_default_hash_format() {
        let index: Index = toml::from_str("").unwrap();
        assert_eq!(index.hash_format, "sha256");
        assert!(index.files.is_empty());
    }

    #[test]
    fn index_with_files() {
        let toml = r#"
            hash-format = "sha512"
            [[files]]
            file = "mods/a.pw.toml"
            hash = "aaa"
            metafile = true
            [[files]]
            file = "config/b.toml"
            hash = "bbb"
        "#;
        let index: Index = toml::from_str(toml).unwrap();
        assert_eq!(index.hash_format, "sha512");
        assert_eq!(index.files.len(), 2);
        assert_eq!(index.files[0].file, "mods/a.pw.toml");
        assert!(index.files[0].metafile);
        assert!(!index.files[1].metafile);
        assert!(!index.files[1].preserve);
    }

    #[test]
    fn index_file_defaults() {
        let toml = r#"file = "x.toml""#;
        let f: IndexFile = toml::from_str(toml).unwrap();
        assert_eq!(f.file, "x.toml");
        assert_eq!(f.hash, "");
        assert!(f.hash_format.is_none());
        assert!(f.alias.is_none());
        assert!(!f.metafile);
        assert!(!f.preserve);
    }

    #[test]
    fn metafile_default_side_is_both() {
        let toml = r#"
            name = "Mod"
            filename = "mod.jar"
            [download]
            url = "https://x/mod.jar"
            hash-format = "sha256"
            hash = "abc"
        "#;
        let meta: MetaFile = toml::from_str(toml).unwrap();
        assert_eq!(meta.side, "both");
        assert_eq!(meta.download.url.as_deref(), Some("https://x/mod.jar"));
    }

    #[test]
    fn parse_modrinth_update() {
        let toml = r#"
            name = "Mod"
            filename = "mod.jar"
            [download]
            hash-format = "sha512"
            hash = "abc"
            mode = "metadata:curseforge"
            [update.modrinth]
            mod-id = "AANobbMI"
            version = "xyz"
        "#;
        let meta: MetaFile = toml::from_str(toml).unwrap();
        let update = meta.update.expect("update present");
        let mr = update.modrinth.expect("modrinth present");
        assert_eq!(mr.mod_id, "AANobbMI");
        assert_eq!(mr.version, "xyz");
        assert_eq!(meta.download.mode.as_deref(), Some("metadata:curseforge"));
        assert!(update.curseforge.is_none());
    }

    #[test]
    fn parse_curseforge_update() {
        let toml = r#"
            name = "Mod"
            filename = "mod.jar"
            [download]
            hash-format = "sha256"
            hash = "abc"
            [update.curseforge]
            project-id = 238222
            file-id = 4912345
        "#;
        let meta: MetaFile = toml::from_str(toml).unwrap();
        let cf = meta.update.unwrap().curseforge.unwrap();
        assert_eq!(cf.project_id, 238222);
        assert_eq!(cf.file_id, 4912345);
    }

    #[test]
    fn versions_all_optional() {
        let versions: Versions = toml::from_str("").unwrap();
        assert!(versions.minecraft.is_none());
        assert!(versions.neoforge.is_none());
        assert!(versions.forge.is_none());
        assert!(versions.fabric.is_none());
        assert!(versions.quilt.is_none());
        assert!(versions.unsup.is_none());
    }

    #[test]
    fn mod_option_defaults() {
        let opt: ModOption = toml::from_str("").unwrap();
        assert!(!opt.optional);
        assert!(!opt.default);
        assert!(opt.description.is_none());
    }
}
