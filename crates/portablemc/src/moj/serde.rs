
use chrono::{DateTime, FixedOffset};

use crate::base;


#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MojangManifest {
    pub latest: MojangManifestLatest,
    pub versions: Vec<MojangManifestVersion>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct MojangManifestLatest {
    pub release: String,
    pub snapshot: String,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MojangManifestVersion {
    pub id: String,
    pub r#type: base::serde::VersionType,
    pub time: DateTime<FixedOffset>,
    pub release_time: DateTime<FixedOffset>,
    #[serde(flatten)]
    pub download: base::serde::Download,
    pub compliance_level: Option<u32>,
}
