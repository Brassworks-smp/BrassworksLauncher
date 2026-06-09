
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

use chrono::{DateTime, FixedOffset};

use crate::serde::{HexString, RegexString};
use crate::maven::Gav;



#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionMetadata {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<VersionType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<DateTimeChill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_time: Option<DateTimeChill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inherits_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_launcher_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub java_version: Option<VersionJavaVersion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_index: Option<VersionAssetIndex>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assets: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compliance_level: Option<u32>,
    #[serde(default)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub downloads: HashMap<String, Download>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub libraries: Vec<VersionLibrary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_class: Option<String>,
    #[serde(rename = "minecraftArguments")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_arguments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<VersionArguments>,
    #[serde(default)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub logging: HashMap<String, VersionLogging>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Copy, Clone, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum VersionType {
    Release,
    Snapshot,
    OldBeta,
    OldAlpha,
}

impl VersionType {

    pub fn as_str(&self) -> &'static str {
        match self {
            VersionType::Release => "release",
            VersionType::Snapshot => "snapshot",
            VersionType::OldBeta => "old_beta",
            VersionType::OldAlpha => "old_alpha",
        }
    }

}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionJavaVersion {
    pub component: Option<String>,
    pub major_version: u32,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionAssetIndex {
    pub id: String,
    pub total_size: u32,
    #[serde(flatten)]
    pub download: Download,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionLibrary {
    pub name: Gav,
    #[serde(default)]
    #[serde(skip_serializing_if = "VersionLibraryDownloads::is_empty")]
    pub downloads: VersionLibraryDownloads,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub natives: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<Vec<Rule>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionLibraryDownloads {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact: Option<VersionLibraryDownload>,
    #[serde(default)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub classifiers: HashMap<String, VersionLibraryDownload>,
}

impl VersionLibraryDownloads {
    fn is_empty(&self) -> bool {
        self.artifact.is_none() && self.classifiers.is_empty()
    }
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionLibraryDownload {
    pub path: Option<PathBuf>,
    #[serde(flatten)]
    pub download: Download,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionArguments {
    #[serde(default)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub game: Vec<VersionArgument>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub jvm: Vec<VersionArgument>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(untagged)]
pub enum VersionArgument {
    Raw(String),
    Conditional(VersionConditionalArgument),
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionConditionalArgument {
    pub value: SingleOrVec<String>,
    pub rules: Option<Vec<Rule>>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionLogging {
    #[serde(default)]
    pub r#type: VersionLoggingType,
    pub argument: String,
    pub file: VersionLoggingFile,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VersionLoggingType {
    #[default]
    #[serde(rename = "log4j2-xml")]
    Log4j2Xml,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionLoggingFile {
    pub id: String,
    #[serde(flatten)]
    pub download: Download,
}



#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct AssetIndex {
    #[serde(default)]
    pub map_to_resources: bool,
    #[serde(default)]
    pub r#virtual: bool,
    pub objects: HashMap<String, AssetObject>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct AssetObject {
    pub size: u32,
    pub hash: HexString<20>,
}


#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(transparent)]
pub struct JvmMetaManifest {
    pub platforms: HashMap<String, JvmMetaManifestPlatform>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(transparent)]
pub struct JvmMetaManifestPlatform {
    pub distributions: HashMap<String, JvmMetaManifestDistribution>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(transparent)]
pub struct JvmMetaManifestDistribution {
    pub variants: Vec<JvmMetaManifestVariant>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct JvmMetaManifestVariant {
    pub availability: JvmMetaManifestAvailability,
    pub manifest: Download,
    pub version: JvmMetaManifestVersion,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct JvmMetaManifestAvailability {
    pub group: u32,
    pub progress: u8,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct JvmMetaManifestVersion {
    pub name: String,
    pub released: DateTime<FixedOffset>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct JvmManifest {
    pub files: HashMap<String, JvmManifestFile>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "lowercase", tag = "type")] 
pub enum JvmManifestFile {
    Directory,
    File {
        #[serde(default)]
        executable: bool,
        downloads: JvmManifestFileDownloads,
    },
    Link {
        target: String,
    },
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct JvmManifestFileDownloads {
    pub raw: Download,
    pub lzma: Option<Download>,
}


#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub action: RuleAction,
    #[serde(default)]
    pub os: RuleOs,
    #[serde(default)]
    pub features: HashMap<String, bool>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleOs {
    pub name: Option<String>,
    pub arch: Option<String>,
    pub version: Option<RegexString>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuleAction {
    Allow,
    Disallow,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct Download {
    pub url: String,
    pub size: Option<u32>,
    pub sha1: Option<HexString<20>>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(untagged)]
pub enum SingleOrVec<T> {
    Single(T),
    Vec(Vec<T>)
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DateTimeChill(pub DateTime<FixedOffset>);

impl<'de> serde::Deserialize<'de> for DateTimeChill {

    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        
        use chrono::format::ParseErrorKind;

        struct Visitor;
        impl serde::de::Visitor<'_> for Visitor {

            type Value = DateTimeChill;
            
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("an RFC 3339 formatted date and time string")
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {

                let err;
                let mut buf;

                match DateTime::parse_from_rfc3339(v) {
                    Ok(date) => return Ok(DateTimeChill(date)),
                    Err(e) if e.kind() == ParseErrorKind::TooShort => {
                        err = e;
                        buf = v.to_string();
                        buf.push('Z');
                    }
                    Err(e) if e.kind() == ParseErrorKind::Invalid => {
                        if let Some(index) = v.rfind(&['+', '-']) {
                            if v.len() - index == 5 && v[v.len() - 4..].is_ascii() {
                                err = e;
                                buf = v.to_string();
                                buf.insert(v.len() - 2, ':');
                            } else {
                                return Err(E::custom(e));
                            }
                        } else {
                            return Err(E::custom(e));
                        }
                    }
                    Err(e) => return Err(E::custom(e)),
                };

                match DateTime::parse_from_rfc3339(&buf) {
                    Ok(date) => Ok(DateTimeChill(date)),
                    Err(_) => Err(E::custom(err)), 
                }

            }
            
        }

        deserializer.deserialize_str(Visitor)
        
    }

}

impl serde::Serialize for DateTimeChill {

    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.0.serialize(serializer)
    }

}
