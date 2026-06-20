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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccountSkins {
    #[serde(default)]
    pub skins: Vec<SavedSkin>,
    #[serde(default)]
    pub selected: Option<String>,
}

impl AccountSkins {
    pub fn normalize(&mut self) -> bool {
        let mut changed = false;
        let mut seen: Vec<String> = Vec::with_capacity(self.skins.len());
        for s in &mut self.skins {
            let base = {
                let t = s.name.trim();
                if t.is_empty() { "Skin" } else { t }
            }
            .to_string();
            let mut candidate = base.clone();
            let mut n = 2;
            while seen.iter().any(|x| x.eq_ignore_ascii_case(&candidate)) {
                candidate = format!("{base} {n}");
                n += 1;
            }
            if candidate != s.name {
                s.name = candidate.clone();
                changed = true;
            }
            seen.push(candidate);
        }
        if let Some(sel) = &self.selected {
            if !self.skins.iter().any(|s| &s.id == sel) {
                self.selected = None;
                changed = true;
            }
        }
        changed
    }
}

pub fn unique_name(skins: &[SavedSkin], desired: &str, exclude: Option<&str>) -> String {
    let base = {
        let t = desired.trim();
        if t.is_empty() { "Skin" } else { t }
    };
    let taken = |candidate: &str| {
        skins
            .iter()
            .any(|s| exclude != Some(s.id.as_str()) && s.name.eq_ignore_ascii_case(candidate))
    };
    if !taken(base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base} {n}");
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
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

fn https(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        url.to_string()
    }
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
    let skin_url = active
        .map(|s| s.url.clone())
        .filter(|u| !u.is_empty())
        .map(|u| https(&u));
    let capes = p
        .capes
        .into_iter()
        .map(|c| Cape {
            active: c.state == "ACTIVE",
            name: if c.alias.is_empty() { c.id.clone() } else { c.alias },
            id: c.id,
            url: https(&c.url),
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
        }
    }

    #[test]
    fn normalize_dedupes_names_and_clears_dangling_selection() {
        let mut acct = AccountSkins {
            skins: vec![saved("1"), saved("2"), saved("3")],
            selected: Some("missing".to_string()),
        };
        assert!(acct.normalize());
        assert_eq!(acct.skins[0].name, "Old");
        assert_eq!(acct.skins[1].name, "Old 2");
        assert_eq!(acct.skins[2].name, "Old 3");
        assert_eq!(acct.selected, None);
    }

    #[test]
    fn unique_name_excludes_self_on_rename() {
        let mut a = saved("1");
        a.name = "Alpha".to_string();
        let mut b = saved("2");
        b.name = "Beta".to_string();
        let skins = vec![a, b];
        assert_eq!(unique_name(&skins, "Alpha", Some("1")), "Alpha");
        assert_eq!(unique_name(&skins, "Beta", Some("1")), "Beta 2");
        assert_eq!(unique_name(&skins, "Alpha", None), "Alpha 2");
    }

    #[test]
    fn account_mut_migrates_legacy_global_skins_once() {
        let mut lib = SkinLibrary {
            accounts: std::collections::HashMap::new(),
            skins: vec![saved("1"), saved("2")],
        };
        let a = lib.account_mut("acc-a");
        assert_eq!(a.skins.len(), 2);
        assert!(lib.skins.is_empty(), "legacy list should be drained");
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

#[cfg(test)]
mod skins_more {
    use super::*;

    fn skin(id: &str, name: &str) -> SavedSkin {
        SavedSkin {
            id: id.to_string(),
            name: name.to_string(),
            file: format!("{id}.png"),
            model: "classic".to_string(),
            cape_id: None,
        }
    }

    #[test]
    fn https_upgrades_http() {
        assert_eq!(https("http://textures.example/x.png"), "https://textures.example/x.png");
    }

    #[test]
    fn https_leaves_secure_and_other_schemes() {
        assert_eq!(https("https://already.secure/x"), "https://already.secure/x");
        assert_eq!(https("data:image/png;base64,AAA"), "data:image/png;base64,AAA");
        assert_eq!(https(""), "");
    }

    #[test]
    fn unique_name_empty_uses_default() {
        assert_eq!(unique_name(&[], "", None), "Skin");
        assert_eq!(unique_name(&[], "   ", None), "Skin");
    }

    #[test]
    fn unique_name_free_name_kept() {
        let skins = vec![skin("a", "Knight")];
        assert_eq!(unique_name(&skins, "Wizard", None), "Wizard");
    }

    #[test]
    fn unique_name_collision_appends_number() {
        let skins = vec![skin("a", "Knight"), skin("b", "Knight 2")];
        assert_eq!(unique_name(&skins, "Knight", None), "Knight 3");
    }

    #[test]
    fn unique_name_is_case_insensitive() {
        let skins = vec![skin("a", "Knight")];
        assert_eq!(unique_name(&skins, "knight", None), "knight 2");
    }

    #[test]
    fn unique_name_excludes_self() {
        let skins = vec![skin("a", "Knight")];
        assert_eq!(unique_name(&skins, "Knight", Some("a")), "Knight");
    }

    #[test]
    fn unique_name_trims_desired() {
        let skins = vec![skin("a", "Hero")];
        assert_eq!(unique_name(&skins, "  Hero  ", None), "Hero 2");
    }
}
