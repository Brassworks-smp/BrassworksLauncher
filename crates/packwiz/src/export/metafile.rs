use serde::Serialize;

use super::ExportMod;
use crate::{PackwizError, Result};

#[derive(Debug, Clone)]
pub enum ModSource {
    Modrinth {
        project_id: String,
        version_id: String,
        url: String,
        sha512: String,
    },
    Curseforge {
        project_id: i64,
        file_id: i64,
        sha1: String,
    },
    Embed,
}

#[derive(Debug, Clone)]
pub struct OptionMeta {
    pub default: bool,
    pub description: String,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Serialize)]
struct MetaToml {
    name: String,
    filename: String,
    side: String,
    download: DownloadToml,
    update: UpdateToml,
    #[serde(skip_serializing_if = "Option::is_none")]
    option: Option<OptionToml>,
}

#[derive(Serialize)]
struct OptionToml {
    optional: bool,
    #[serde(skip_serializing_if = "is_false")]
    default: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    description: String,
}

#[derive(Serialize)]
struct DownloadToml {
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(rename = "hash-format")]
    hash_format: String,
    hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
}

#[derive(Serialize)]
struct UpdateToml {
    #[serde(skip_serializing_if = "Option::is_none")]
    modrinth: Option<ModrinthUpdate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    curseforge: Option<CurseforgeUpdate>,
}

#[derive(Serialize)]
struct ModrinthUpdate {
    #[serde(rename = "mod-id")]
    mod_id: String,
    version: String,
}

#[derive(Serialize)]
struct CurseforgeUpdate {
    #[serde(rename = "project-id")]
    project_id: i64,
    #[serde(rename = "file-id")]
    file_id: i64,
}

pub fn render_metafile(m: &ExportMod) -> Result<String> {
    let (download, update) = match &m.source {
        ModSource::Modrinth {
            project_id,
            version_id,
            url,
            sha512,
        } => (
            DownloadToml {
                url: Some(url.clone()),
                hash_format: "sha512".to_string(),
                hash: sha512.clone(),
                mode: None,
            },
            UpdateToml {
                modrinth: Some(ModrinthUpdate {
                    mod_id: project_id.clone(),
                    version: version_id.clone(),
                }),
                curseforge: None,
            },
        ),
        ModSource::Curseforge {
            project_id,
            file_id,
            sha1,
        } => (
            DownloadToml {
                url: None,
                hash_format: "sha1".to_string(),
                hash: sha1.clone(),
                mode: Some("metadata:curseforge".to_string()),
            },
            UpdateToml {
                modrinth: None,
                curseforge: Some(CurseforgeUpdate {
                    project_id: *project_id,
                    file_id: *file_id,
                }),
            },
        ),
        ModSource::Embed => {
            return Err(PackwizError::Other(
                "embedded mods do not have a metafile".to_string(),
            ))
        }
    };
    let option = m.optional.as_ref().map(|o| OptionToml {
        optional: true,
        default: o.default,
        description: o.description.clone(),
    });
    let meta = MetaToml {
        name: m.name.clone(),
        filename: m.filename.clone(),
        side: m.side.clone(),
        download,
        update,
        option,
    };
    toml::to_string(&meta).map_err(|e| PackwizError::Other(format!("serialize metafile: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MetaFile;

    fn modrinth_mod() -> ExportMod {
        ExportMod {
            category: "mods".to_string(),
            name: "Just Enough Items".to_string(),
            filename: "jei-1.21.1.jar".to_string(),
            side: "both".to_string(),
            bytes: Vec::new(),
            source: ModSource::Modrinth {
                project_id: "u6dRKJwZ".to_string(),
                version_id: "abc123".to_string(),
                url: "https://cdn.modrinth.com/data/u6dRKJwZ/jei.jar".to_string(),
                sha512: "f".repeat(128),
            },
            optional: None,
            flavors: Vec::new(),
        }
    }

    fn curseforge_mod() -> ExportMod {
        ExportMod {
            category: "mods".to_string(),
            name: "Some CF Mod".to_string(),
            filename: "cfmod.jar".to_string(),
            side: "client".to_string(),
            bytes: Vec::new(),
            source: ModSource::Curseforge {
                project_id: 238222,
                file_id: 4912345,
                sha1: "a".repeat(40),
            },
            optional: None,
            flavors: Vec::new(),
        }
    }

    #[test]
    fn optional_metafile_emits_option_table() {
        let mut m = modrinth_mod();
        m.optional = Some(OptionMeta {
            default: false,
            description: "Adds shaders".to_string(),
        });
        let meta: MetaFile = toml::from_str(&render_metafile(&m).unwrap()).unwrap();
        let opt = meta.option.expect("has [option]");
        assert!(opt.optional);
        assert!(!opt.default);
        assert_eq!(opt.description.as_deref(), Some("Adds shaders"));
    }

    #[test]
    fn non_optional_metafile_has_no_option_table() {
        let meta: MetaFile = toml::from_str(&render_metafile(&modrinth_mod()).unwrap()).unwrap();
        assert!(meta.option.is_none());
    }

    #[test]
    fn modrinth_metafile_has_url_and_update() {
        let text = render_metafile(&modrinth_mod()).unwrap();
        let meta: MetaFile = toml::from_str(&text).unwrap();
        assert_eq!(meta.name, "Just Enough Items");
        assert_eq!(meta.filename, "jei-1.21.1.jar");
        assert_eq!(meta.side, "both");
        assert_eq!(meta.download.hash_format, "sha512");
        assert_eq!(
            meta.download.url.as_deref(),
            Some("https://cdn.modrinth.com/data/u6dRKJwZ/jei.jar")
        );
        assert!(meta.download.mode.is_none());
        let mr = meta.update.unwrap().modrinth.unwrap();
        assert_eq!(mr.mod_id, "u6dRKJwZ");
        assert_eq!(mr.version, "abc123");
    }

    #[test]
    fn curseforge_metafile_has_metadata_mode_no_url() {
        let text = render_metafile(&curseforge_mod()).unwrap();
        let meta: MetaFile = toml::from_str(&text).unwrap();
        assert_eq!(meta.side, "client");
        assert!(meta.download.url.is_none());
        assert_eq!(meta.download.hash_format, "sha1");
        assert_eq!(meta.download.mode.as_deref(), Some("metadata:curseforge"));
        let cf = meta.update.unwrap().curseforge.unwrap();
        assert_eq!(cf.project_id, 238222);
        assert_eq!(cf.file_id, 4912345);
    }

    #[test]
    fn embed_mod_has_no_metafile() {
        let mut m = modrinth_mod();
        m.source = ModSource::Embed;
        assert!(render_metafile(&m).is_err());
    }

    #[test]
    fn special_characters_in_name_are_escaped() {
        let mut m = modrinth_mod();
        m.name = "Quotes \" and \\ backslash".to_string();
        let meta: MetaFile = toml::from_str(&render_metafile(&m).unwrap()).unwrap();
        assert_eq!(meta.name, "Quotes \" and \\ backslash");
    }
}
