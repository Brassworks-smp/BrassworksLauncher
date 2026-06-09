
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

fn get_text(url: &str) -> Result<String> {
    let resp = client()?
        .get(url)
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CoreError::Remote(format!("{url} -> {}", resp.status())));
    }
    resp.text().map_err(|e| CoreError::Remote(e.to_string()))
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
        LoaderKind::Fabric => fabric_like("https://meta.fabricmc.net/v2/versions/loader"),
        LoaderKind::Quilt => fabric_like("https://meta.quiltmc.org/v3/versions/loader"),
        LoaderKind::NeoForge => neoforge_versions(mc),
        LoaderKind::Forge => forge_versions(mc),
    }
}

#[derive(Deserialize)]
struct FabricLoader {
    version: String,
    #[serde(default)]
    stable: bool,
}

fn fabric_like(url: &str) -> Result<Vec<LoaderVersionInfo>> {
    let loaders: Vec<FabricLoader> = get_json(url)?;
    Ok(loaders
        .into_iter()
        .map(|l| LoaderVersionInfo {
            version: l.version,
            stable: l.stable,
        })
        .collect())
}

fn maven_versions(xml: &str) -> Vec<String> {
    xml.split("<version>")
        .skip(1)
        .filter_map(|chunk| chunk.split("</version>").next())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect()
}

fn neoforge_prefix(mc: &str) -> Option<String> {
    let rest = mc.strip_prefix("1.")?;
    let mut parts = rest.split('.');
    let major = parts.next()?;
    let minor = parts.next().unwrap_or("0");
    Some(format!("{major}.{minor}."))
}

fn neoforge_versions(mc: &str) -> Result<Vec<LoaderVersionInfo>> {
    let xml = get_text(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
    )?;
    let prefix = neoforge_prefix(mc);
    let mut out: Vec<LoaderVersionInfo> = maven_versions(&xml)
        .into_iter()
        .filter(|v| prefix.as_deref().map(|p| v.starts_with(p)).unwrap_or(true))
        .map(|v| LoaderVersionInfo {
            stable: !v.contains("beta"),
            version: v,
        })
        .collect();
    out.reverse(); 
    Ok(out)
}

fn forge_versions(mc: &str) -> Result<Vec<LoaderVersionInfo>> {
    let xml = get_text(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
    )?;
    let needle = format!("{mc}-");
    let mut out: Vec<LoaderVersionInfo> = maven_versions(&xml)
        .into_iter()
        .filter(|v| v.starts_with(&needle))
        .map(|v| LoaderVersionInfo {
            version: v.split_once('-').map(|(_, b)| b.to_string()).unwrap_or(v),
            stable: true,
        })
        .collect();
    out.reverse();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neoforge_prefix_mapping() {
        assert_eq!(neoforge_prefix("1.21.1").as_deref(), Some("21.1."));
        assert_eq!(neoforge_prefix("1.21").as_deref(), Some("21.0."));
        assert_eq!(neoforge_prefix("1.20.1").as_deref(), Some("20.1."));
    }

    #[test]
    fn parses_maven_versions() {
        let xml = "<metadata><versioning><versions>\
            <version>1.0</version><version>2.0</version></versions></versioning></metadata>";
        assert_eq!(
            maven_versions(xml),
            vec!["1.0".to_string(), "2.0".to_string()]
        );
    }
}
