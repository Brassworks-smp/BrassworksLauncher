
use std::collections::HashMap;

use crate::maven::Gav;

use crate::base;


#[derive(serde::Deserialize, Debug, Clone)]
pub struct ModernInstallProfile {
    pub minecraft: String,
    pub path: Option<Gav>,
    pub json: String,
    #[serde(default)]
    pub libraries: Vec<InstallLibrary>,
    #[serde(default)]
    pub processors: Vec<InstallProcessor>,
    #[serde(deserialize_with = "crate::serde::deserialize_or_empty_seq")]
    pub data: HashMap<String, InstallDataEntry>,
}

#[derive(serde::Deserialize, Debug, Clone)]
pub struct InstallLibrary {
    pub name: Gav,
    pub downloads: InstallLibraryDownloads,
}

#[derive(serde::Deserialize, Debug, Clone)]
pub struct InstallLibraryDownloads {
    pub artifact: base::serde::VersionLibraryDownload,
}

#[derive(serde::Deserialize, Debug, Clone)]
pub struct InstallProcessor {
    pub jar: Gav,
    #[serde(default)]
    pub sides: Option<Vec<InstallSide>>,
    #[serde(default)]
    pub classpath: Vec<Gav>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub outputs: HashMap<String, String>,
}

#[derive(serde::Deserialize, Debug, Clone)]
pub struct InstallDataEntry {
    pub client: String,
    pub server: String,
}

impl InstallDataEntry {

    pub fn get(&self, side: InstallSide) -> &str {
        match side {
            InstallSide::Client => &self.client,
            InstallSide::Server => &self.server,
        }
    }

}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LegacyInstallProfile {
    pub install: LegacyInstall,
    pub version_info: Box<base::serde::VersionMetadata>,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LegacyInstall {
    pub path: Gav,
    pub file_path: String,
}

#[derive(serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum InstallSide {
    Client,
    Server,
}

impl InstallSide {

    pub fn as_str(self) -> &'static str {
        match self {
            InstallSide::Client => "client",
            InstallSide::Server => "server",
        }
    }

}
