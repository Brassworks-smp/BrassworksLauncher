use serde::Serialize;

use crate::{PackwizError, Result};

pub const PACK_FORMAT: &str = "packwiz:1.1.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Loader {
    NeoForge,
    Forge,
    Fabric,
    Quilt,
}

impl Loader {
    pub fn pack_toml_key(self) -> &'static str {
        match self {
            Loader::NeoForge => "neoforge",
            Loader::Forge => "forge",
            Loader::Fabric => "fabric",
            Loader::Quilt => "quilt",
        }
    }

    pub fn from_str_loose(s: &str) -> Option<Loader> {
        match s.trim().to_ascii_lowercase().replace('_', "").as_str() {
            "neoforge" => Some(Loader::NeoForge),
            "forge" => Some(Loader::Forge),
            "fabric" => Some(Loader::Fabric),
            "quilt" => Some(Loader::Quilt),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PackMeta {
    pub name: String,
    pub author: String,
    pub version: String,
    pub mc_version: String,
    pub loader: Option<Loader>,
    pub loader_version: Option<String>,
}

#[derive(Serialize)]
struct PackToml {
    name: String,
    author: String,
    version: String,
    #[serde(rename = "pack-format")]
    pack_format: String,
    index: IndexRef,
    versions: VersionsToml,
}

#[derive(Serialize)]
struct IndexRef {
    file: String,
    #[serde(rename = "hash-format")]
    hash_format: String,
    hash: String,
}

#[derive(Serialize, Default)]
struct VersionsToml {
    minecraft: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    neoforge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    forge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fabric: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quilt: Option<String>,
}

pub fn render_pack_toml(meta: &PackMeta, index_hash: &str) -> Result<String> {
    let mut versions = VersionsToml {
        minecraft: meta.mc_version.clone(),
        ..Default::default()
    };
    if let Some(loader) = meta.loader {
        let value = meta.loader_version.clone().unwrap_or_default();
        match loader {
            Loader::NeoForge => versions.neoforge = Some(value),
            Loader::Forge => versions.forge = Some(value),
            Loader::Fabric => versions.fabric = Some(value),
            Loader::Quilt => versions.quilt = Some(value),
        }
    }
    let pack = PackToml {
        name: meta.name.clone(),
        author: meta.author.clone(),
        version: meta.version.clone(),
        pack_format: PACK_FORMAT.to_string(),
        index: IndexRef {
            file: "index.toml".to_string(),
            hash_format: "sha256".to_string(),
            hash: index_hash.to_string(),
        },
        versions,
    };
    toml::to_string(&pack).map_err(|e| PackwizError::Other(format!("serialize pack.toml: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Pack;

    fn meta() -> PackMeta {
        PackMeta {
            name: "Cool Pack".to_string(),
            author: "swzo".to_string(),
            version: "1.2.3".to_string(),
            mc_version: "1.21.1".to_string(),
            loader: Some(Loader::NeoForge),
            loader_version: Some("21.1.0".to_string()),
        }
    }

    #[test]
    fn loader_keys() {
        assert_eq!(Loader::NeoForge.pack_toml_key(), "neoforge");
        assert_eq!(Loader::Forge.pack_toml_key(), "forge");
        assert_eq!(Loader::Fabric.pack_toml_key(), "fabric");
        assert_eq!(Loader::Quilt.pack_toml_key(), "quilt");
    }

    #[test]
    fn from_str_loose_handles_underscores_and_case() {
        assert_eq!(Loader::from_str_loose("NeoForge"), Some(Loader::NeoForge));
        assert_eq!(Loader::from_str_loose("neo_forge"), Some(Loader::NeoForge));
        assert_eq!(Loader::from_str_loose("FABRIC"), Some(Loader::Fabric));
        assert_eq!(Loader::from_str_loose("vanilla"), None);
    }

    #[test]
    fn renders_and_roundtrips() {
        let text = render_pack_toml(&meta(), "deadbeef").unwrap();
        let pack: Pack = toml::from_str(&text).unwrap();
        assert_eq!(pack.name, "Cool Pack");
        assert_eq!(pack.author, "swzo");
        assert_eq!(pack.version, "1.2.3");
        assert_eq!(pack.pack_format, PACK_FORMAT);
        assert_eq!(pack.index.file, "index.toml");
        assert_eq!(pack.index.hash_format, "sha256");
        assert_eq!(pack.index.hash, "deadbeef");
        assert_eq!(pack.versions.minecraft.as_deref(), Some("1.21.1"));
        assert_eq!(pack.versions.neoforge.as_deref(), Some("21.1.0"));
        assert!(pack.versions.fabric.is_none());
    }

    #[test]
    fn renders_each_loader_key() {
        for (loader, check) in [
            (Loader::Forge, "forge"),
            (Loader::Fabric, "fabric"),
            (Loader::Quilt, "quilt"),
        ] {
            let mut m = meta();
            m.loader = Some(loader);
            m.loader_version = Some("9.9".to_string());
            let text = render_pack_toml(&m, "abc").unwrap();
            assert!(text.contains(&format!("{check} = \"9.9\"")), "{text}");
        }
    }

    #[test]
    fn no_loader_omits_loader_keys() {
        let mut m = meta();
        m.loader = None;
        m.loader_version = None;
        let pack: Pack = toml::from_str(&render_pack_toml(&m, "abc").unwrap()).unwrap();
        assert!(pack.versions.neoforge.is_none());
        assert!(pack.versions.forge.is_none());
        assert_eq!(pack.versions.minecraft.as_deref(), Some("1.21.1"));
    }
}
