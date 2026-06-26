use portablemc::forge::{self, Loader as ForgeLoader};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::instance::LoaderKind;

const UA: &str = "BrassworksLauncher";

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| CoreError::Remote(e.to_string()))
}

fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T> {
    let resp = client()?
        .get(url)
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CoreError::Remote(format!("{url} -> {}", resp.status())));
    }
    resp.json::<T>()
        .map_err(|e| CoreError::Remote(format!("decode {url}: {e}")))
}


#[derive(Debug, Clone, Serialize)]
pub struct McVersion {
    pub id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoaderVersionInfo {
    pub version: String,
    pub stable: bool,
}

#[derive(Deserialize)]
struct MojManifest {
    versions: Vec<MojVersion>,
}

#[derive(Deserialize)]
struct MojVersion {
    id: String,
    #[serde(rename = "type")]
    kind: String,
}

pub fn minecraft_versions(include_snapshots: bool) -> Result<Vec<McVersion>> {
    let manifest: MojManifest =
        get_json("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")?;
    Ok(manifest
        .versions
        .into_iter()
        .filter(|v| include_snapshots || v.kind == "release")
        .map(|v| McVersion {
            id: v.id,
            kind: v.kind,
        })
        .collect())
}

pub fn loader_versions(loader: LoaderKind, mc: &str) -> Result<Vec<LoaderVersionInfo>> {
    match loader {
        LoaderKind::Vanilla => Ok(Vec::new()),
        LoaderKind::Fabric => fabric_for_game("https://meta.fabricmc.net/v2/versions/loader", mc),
        LoaderKind::Quilt => fabric_for_game("https://meta.quiltmc.org/v3/versions/loader", mc),
        LoaderKind::NeoForge => forge_like_versions(ForgeLoader::NeoForge, mc),
        LoaderKind::Forge => forge_like_versions(ForgeLoader::Forge, mc),
    }
}

pub fn latest_stable_version(loader: LoaderKind, mc: &str) -> Option<String> {
    if matches!(loader, LoaderKind::Vanilla) {
        return None;
    }
    let list = loader_versions(loader, mc).ok()?;
    list.iter()
        .find(|v| v.stable)
        .or_else(|| list.first())
        .map(|v| v.version.clone())
}

pub fn supported_loaders(mc: &str) -> Vec<String> {
    let mut out = vec!["vanilla".to_string()];
    for (name, kind) in [
        ("fabric", LoaderKind::Fabric),
        ("quilt", LoaderKind::Quilt),
        ("forge", LoaderKind::Forge),
        ("neoforge", LoaderKind::NeoForge),
    ] {
        if loader_versions(kind, mc)
            .map(|v| !v.is_empty())
            .unwrap_or(false)
        {
            out.push(name.to_string());
        }
    }
    out
}

#[derive(Deserialize)]
struct FabricLoader {
    version: String,
    #[serde(default)]
    stable: bool,
}

#[derive(Deserialize)]
struct FabricGameEntry {
    loader: FabricLoader,
    #[serde(default)]
    intermediary: Option<serde_json::Value>,
}

impl FabricGameEntry {
    fn installable(&self) -> bool {
        matches!(&self.intermediary, Some(v) if !v.is_null())
    }
}

fn encode_version(mc: &str) -> String {
    mc.chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            c => c.to_string(),
        })
        .collect()
}

fn fabric_for_game(base: &str, mc: &str) -> Result<Vec<LoaderVersionInfo>> {
    if mc.trim().is_empty() {
        return Ok(Vec::new());
    }
    let url = format!("{base}/{}", encode_version(mc));
                let entries: Vec<FabricGameEntry> = match get_json(&url) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };
    Ok(entries
        .into_iter()
        .filter(FabricGameEntry::installable)
        .map(|e| LoaderVersionInfo {
            version: e.loader.version,
            stable: e.loader.stable,
        })
        .collect())
}

fn forge_like_versions(loader: ForgeLoader, mc: &str) -> Result<Vec<LoaderVersionInfo>> {
    let repo = forge::Repo::request(loader)
        .map_err(|e| CoreError::Remote(format!("forge repo: {e:?}")))?;
    let neoforge = matches!(loader, ForgeLoader::NeoForge);

    let mut out: Vec<LoaderVersionInfo> = repo
        .iter()
        .filter(|v| v.game_version() == mc)
        .map(|v| {
            let name = v.name();
                                    let version = if neoforge {
                name.to_string()
            } else {
                name.split_once('-')
                    .map(|(_, b)| b.to_string())
                    .unwrap_or_else(|| name.to_string())
            };
            LoaderVersionInfo {
                version,
                stable: v.is_stable(),
            }
        })
        .collect();
    out.reverse();     Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_spaces_in_version() {
        assert_eq!(encode_version("1.21.1"), "1.21.1");
        assert_eq!(encode_version("1.14.2 Pre-Release 4"), "1.14.2%20Pre-Release%204");
    }

            #[test]
    #[ignore = "live network"]
    fn loader_detection_is_robust_across_eras() {
        let has = |loader, mc: &str| loader_versions(loader, mc).map(|v| !v.is_empty()).unwrap_or(false);

                assert!(has(LoaderKind::Forge, "1.20.1"), "forge 1.20.1");
        assert!(has(LoaderKind::NeoForge, "1.20.1"), "neoforge 1.20.1 (legacy fork)");
        assert!(has(LoaderKind::NeoForge, "1.21.1"), "neoforge 1.21.1");
        assert!(has(LoaderKind::Forge, "1.12.2"), "forge 1.12.2");
        assert!(has(LoaderKind::Fabric, "1.16.5"), "fabric 1.16.5");
        assert!(has(LoaderKind::Quilt, "1.18.2"), "quilt 1.18.2");

                        assert!(!has(LoaderKind::NeoForge, "1.16.5"), "neoforge predates 1.16");
        assert!(!has(LoaderKind::NeoForge, "1.15.2"), "neoforge predates 1.15");

                        for v in ["19w34a", "20w06a", "1.16-rc1", "1.15.2-pre1", "b1.7.3", "a1.2.6", "c0.30_01c", "rd-132211"] {
            assert!(!has(LoaderKind::Forge, v), "forge must be empty for {v}");
            assert!(!has(LoaderKind::NeoForge, v), "neoforge must be empty for {v}");
        }

                assert!(!has(LoaderKind::Fabric, "b1.7.3"), "fabric must be empty for beta");
        assert!(!has(LoaderKind::Fabric, "a1.2.6"), "fabric must be empty for alpha");

                for loader in [LoaderKind::Fabric, LoaderKind::Quilt, LoaderKind::Forge, LoaderKind::NeoForge] {
            assert!(!has(loader, "9.9.9-not-real"), "nothing supports a fake version");
        }
    }

    #[test]
    #[ignore = "live network"]
    fn supported_loaders_snapshot() {
                let s = supported_loaders("20w14a");
        assert!(s.contains(&"vanilla".to_string()));
        assert!(!s.contains(&"forge".to_string()), "forge has no 20w14a build");
        assert!(!s.contains(&"neoforge".to_string()), "neoforge has no 20w14a build");

                assert_eq!(supported_loaders("b1.7.3"), vec!["vanilla".to_string()]);
    }

    #[test]
    fn fabric_entry_needs_intermediary() {
                let with: FabricGameEntry = serde_json::from_value(serde_json::json!({
            "loader": { "version": "0.16.0", "stable": true },
            "intermediary": { "version": "1.21.1" },
        }))
        .unwrap();
        assert!(with.installable());

                        let without: FabricGameEntry = serde_json::from_value(serde_json::json!({
            "loader": { "version": "0.16.0", "stable": true },
        }))
        .unwrap();
        assert!(!without.installable());
    }
}
