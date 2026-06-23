use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PackwizShare {
    pub pack_url: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub unsup: bool,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    #[serde(default, alias = "unsup_public_key")]
    pub signing_key: Option<String>,
    #[serde(default)]
    pub news_url: Option<String>,
    #[serde(default)]
    pub playercount_url: Option<String>,
    #[serde(default)]
    pub min_memory_mb: Option<u32>,
    #[serde(default)]
    pub max_memory_mb: Option<u32>,
    #[serde(default)]
    pub jvm_args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInstallMeta {
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub news_url: Option<String>,
    #[serde(default)]
    pub playercount_url: Option<String>,
    #[serde(default)]
    pub min_memory_mb: Option<u32>,
    #[serde(default)]
    pub max_memory_mb: Option<u32>,
    #[serde(default)]
    pub jvm_args: Option<Vec<String>>,
}

impl PackwizShare {
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let bytes = std::fs::read(path).map_err(|e| CoreError::io(path, e))?;
        let share: PackwizShare = serde_json::from_slice(&bytes)
            .map_err(|e| CoreError::serde(path.display().to_string(), e))?;
        share.validated()
    }

    pub fn from_query_pairs<I, K, V>(pairs: I) -> Result<Self>
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<str>,
        V: AsRef<str>,
    {
        let mut share = PackwizShare::default();
        for (k, v) in pairs {
            let v = v.as_ref().to_string();
            match k.as_ref() {
                "pack_url" => share.pack_url = v,
                "name" => share.name = Some(v),
                "description" => share.description = Some(v),
                "unsup" => share.unsup = matches!(v.as_str(), "true" | "1" | "yes"),
                "icon" => share.icon = Some(v),
                "banner" => share.banner = Some(v),
                "signing_key" | "unsup_public_key" => share.signing_key = Some(v),
                "news_url" => share.news_url = Some(v),
                "playercount_url" => share.playercount_url = Some(v),
                "min_memory_mb" => share.min_memory_mb = v.parse().ok(),
                "max_memory_mb" | "ram" => share.max_memory_mb = v.parse().ok(),
                "jvm_args" => {
                    let args: Vec<String> =
                        v.split_whitespace().map(|s| s.to_string()).collect();
                    if !args.is_empty() {
                        share.jvm_args = Some(args);
                    }
                }
                _ => {}
            }
        }
        share.validated()
    }

    fn validated(self) -> Result<Self> {
        if self.pack_url.trim().is_empty() {
            return Err(CoreError::Modpack(
                "packwiz share is missing pack_url".to_string(),
            ));
        }
        Ok(self)
    }

    pub fn install_meta(&self) -> PackInstallMeta {
        PackInstallMeta {
            icon: self.icon.clone(),
            banner: self.banner.clone(),
            description: self.description.clone(),
            news_url: self.news_url.clone(),
            playercount_url: self.playercount_url.clone(),
            min_memory_mb: self.min_memory_mb,
            max_memory_mb: self.max_memory_mb,
            jvm_args: self.jvm_args.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_share() {
        let json = r#"{
            "pack_url": "https://example.com/pack.toml",
            "name": "My SMP",
            "description": "A cozy server pack",
            "unsup": true,
            "icon": "https://example.com/icon.png",
            "signing_key": "abc123",
            "news_url": "https://example.com/news.json",
            "min_memory_mb": 2048,
            "max_memory_mb": 6144,
            "jvm_args": ["-XX:+UseG1GC", "-Dfoo=bar"]
        }"#;
        let share: PackwizShare = serde_json::from_str(json).unwrap();
        assert_eq!(share.pack_url, "https://example.com/pack.toml");
        assert_eq!(share.description.as_deref(), Some("A cozy server pack"));
        assert_eq!(share.max_memory_mb, Some(6144));
        assert_eq!(share.jvm_args.as_deref().unwrap().len(), 2);
        assert!(share.unsup);
    }

    #[test]
    fn applies_defaults_with_only_url() {
        let share: PackwizShare =
            serde_json::from_str(r#"{ "pack_url": "https://x/pack.toml" }"#).unwrap();
        assert!(!share.unsup);
        assert!(share.name.is_none());
        assert!(share.max_memory_mb.is_none());
        assert!(share.jvm_args.is_none());
    }

    #[test]
    fn accepts_unsup_public_key_alias() {
        let share: PackwizShare =
            serde_json::from_str(r#"{ "pack_url": "https://x/pack.toml", "unsup_public_key": "k" }"#)
                .unwrap();
        assert_eq!(share.signing_key.as_deref(), Some("k"));
    }

    #[test]
    fn parses_deep_link_query_pairs() {
        let pairs = vec![
            ("pack_url", "https://x/pack.toml"),
            ("name", "Cool Pack"),
            ("unsup", "true"),
            ("max_memory_mb", "4096"),
            ("jvm_args", "-XX:+UseG1GC -Dfoo=bar"),
            ("description", "hello"),
        ];
        let share = PackwizShare::from_query_pairs(pairs).unwrap();
        assert_eq!(share.pack_url, "https://x/pack.toml");
        assert_eq!(share.name.as_deref(), Some("Cool Pack"));
        assert!(share.unsup);
        assert_eq!(share.max_memory_mb, Some(4096));
        assert_eq!(share.jvm_args.as_deref().unwrap().len(), 2);
        assert_eq!(share.description.as_deref(), Some("hello"));
    }

    #[test]
    fn deep_link_requires_pack_url() {
        let pairs = vec![("name", "x")];
        assert!(PackwizShare::from_query_pairs(pairs).is_err());
    }
}
