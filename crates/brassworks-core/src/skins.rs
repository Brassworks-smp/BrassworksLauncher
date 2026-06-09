
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};

const PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";
const UA: &str = "BrassworksLauncher";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkinProfile {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub skin_url: Option<String>,
    pub model: String, 
    pub capes: Vec<Cape>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cape {
    pub id: String,
    pub name: String,
    pub url: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSkin {
    pub id: String,
    pub name: String,
    pub file: String,
    pub model: String,
    #[serde(default)]
    pub cape_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccountSkins {
    #[serde(default)]
    pub skins: Vec<SavedSkin>,
    #[serde(default)]
    pub selected: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkinLibrary {
    #[serde(default)]
    pub accounts: std::collections::HashMap<String, AccountSkins>,
    #[serde(default)]
    pub skins: Vec<SavedSkin>,
}

impl SkinLibrary {
    pub fn account_mut(&mut self, account_id: &str) -> &mut AccountSkins {
        let entry = self.accounts.entry(account_id.to_string()).or_default();
        if !self.skins.is_empty() {
            entry.skins.append(&mut self.skins);
        }
        entry
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkinLibraryView {
    pub skins: Vec<SavedSkin>,
    pub selected: Option<String>,
}

#[derive(Deserialize)]
struct ApiProfile {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    skins: Vec<ApiSkin>,
    #[serde(default)]
    capes: Vec<ApiCape>,
}

#[derive(Deserialize)]
struct ApiSkin {
    #[serde(default)]
    state: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    variant: String,
}

#[derive(Deserialize)]
struct ApiCape {
    id: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    alias: String,
}

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| CoreError::Remote(e.to_string()))
}

fn status_err(status: reqwest::StatusCode) -> CoreError {
    if status.as_u16() == 401 || status.as_u16() == 403 {
        CoreError::Unauthorized
    } else {
        CoreError::Remote(format!("minecraft services -> {status}"))
    }
}

fn ok(resp: reqwest::blocking::Response) -> Result<()> {
    let status = resp.status();
    if status.is_success() {
        Ok(())
    } else {
        Err(status_err(status))
    }
}

pub fn get_profile(token: &str) -> Result<SkinProfile> {
    let resp = client()?
        .get(PROFILE_URL)
        .bearer_auth(token)
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(status_err(resp.status()));
    }
    let p: ApiProfile = resp
        .json()
        .map_err(|e| CoreError::Remote(format!("decode profile: {e}")))?;
    Ok(map_profile(p))
}

fn map_profile(p: ApiProfile) -> SkinProfile {
    let active = p.skins.iter().find(|s| s.state == "ACTIVE").or(p.skins.first());
    let model = active
        .map(|s| {
            if s.variant.eq_ignore_ascii_case("slim") {
                "slim"
            } else {
                "classic"
            }
        })
        .unwrap_or("classic")
        .to_string();
    let skin_url = active.map(|s| s.url.clone()).filter(|u| !u.is_empty());
    let capes = p
        .capes
        .into_iter()
        .map(|c| Cape {
            active: c.state == "ACTIVE",
            name: if c.alias.is_empty() { c.id.clone() } else { c.alias },
            id: c.id,
            url: c.url,
        })
        .collect();

    SkinProfile {
        id: p.id,
        name: p.name,
        skin_url,
        model,
        capes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "id": "0123456789abcdef0123456789abcdef",
        "name": "Notch",
        "skins": [
            { "id": "a", "state": "INACTIVE", "url": "https://tex/inactive", "variant": "CLASSIC" },
            { "id": "b", "state": "ACTIVE", "url": "https://tex/active", "variant": "SLIM" }
        ],
        "capes": [
            { "id": "c1", "state": "INACTIVE", "url": "https://cape/1", "alias": "Migrator" },
            { "id": "c2", "state": "ACTIVE", "url": "https://cape/2", "alias": "" }
        ]
    }"#;

    fn parse(json: &str) -> SkinProfile {
        map_profile(serde_json::from_str(json).expect("valid profile json"))
    }

    #[test]
    fn marks_active_cape_and_falls_back_to_id_for_name() {
        let p = parse(SAMPLE);
        assert_eq!(p.capes.len(), 2);
        let active: Vec<_> = p.capes.iter().filter(|c| c.active).collect();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "c2");
        assert_eq!(active[0].name, "c2");
        assert_eq!(p.capes[0].name, "Migrator");
    }

    #[test]
    fn defaults_to_classic_when_no_skins() {
        let p = parse(r#"{ "id": "x", "name": "Steve", "skins": [], "capes": [] }"#);
        assert_eq!(p.model, "classic");
        assert!(p.skin_url.is_none());
        assert!(p.capes.is_empty());
    }

    fn saved(id: &str) -> SavedSkin {
        SavedSkin {
            id: id.to_string(),
            name: "Old".to_string(),
            file: format!("/skins/{id}.png"),
            model: "classic".to_string(),
            cape_id: None,
            source: None,
        }
    }

    #[test]
    fn account_mut_migrates_legacy_global_skins_once() {
        let mut lib = SkinLibrary {
            accounts: std::collections::HashMap::new(),
            skins: vec![saved("1"), saved("2")],
        };
        // First account to be touched inherits the legacy global skins.
        let a = lib.account_mut("acc-a");
        assert_eq!(a.skins.len(), 2);
        assert!(lib.skins.is_empty(), "legacy list should be drained");
        // A different account does not get a second copy.
        let b = lib.account_mut("acc-b");
        assert!(b.skins.is_empty());
    }

    #[test]
    fn empty_active_skin_url_is_treated_as_absent() {
        let p = parse(
            r#"{ "id": "x", "name": "Steve",
                "skins": [{ "id": "a", "state": "ACTIVE", "url": "", "variant": "CLASSIC" }],
                "capes": [] }"#,
        );
        assert!(p.skin_url.is_none());
        assert_eq!(p.model, "classic");
    }
}

pub fn download_texture(url: &str) -> Result<Vec<u8>> {
    let resp = client()?
        .get(url)
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CoreError::Remote(format!("texture -> {}", resp.status())));
    }
    Ok(resp
        .bytes()
        .map_err(|e| CoreError::Remote(e.to_string()))?
        .to_vec())
}

pub fn upload_skin(token: &str, bytes: Vec<u8>, model: &str) -> Result<()> {
    let variant = if model == "slim" { "slim" } else { "classic" };
    let part = reqwest::blocking::multipart::Part::bytes(bytes)
        .file_name("skin.png")
        .mime_str("image/png")
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    let form = reqwest::blocking::multipart::Form::new()
        .text("variant", variant.to_string())
        .part("file", part);
    let resp = client()?
        .post(format!("{PROFILE_URL}/skins"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    ok(resp)
}

pub fn set_cape(token: &str, cape_id: Option<&str>) -> Result<()> {
    let url = format!("{PROFILE_URL}/capes/active");
    let c = client()?;
    let resp = match cape_id {
        Some(id) => c
            .put(&url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "capeId": id }))
            .send(),
        None => c.delete(&url).bearer_auth(token).send(),
    }
    .map_err(|e| CoreError::Remote(e.to_string()))?;
    ok(resp)
}
