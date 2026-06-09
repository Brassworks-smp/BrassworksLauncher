
use serde::{Deserialize, Serialize};

const FEATURED_JSON: &str = include_str!("../featured.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeaturedPack {
    pub id: String,
    pub name: String,
    pub pack_url: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    #[serde(default)]
    pub news_url: Option<String>,
    #[serde(default)]
    pub playercount_url: Option<String>,
    #[serde(default = "default_true")]
    pub locked_default: bool,
    pub mc_version: String,
    pub loader: String,
    #[serde(default)]
    pub loader_version: String,
}

fn default_true() -> bool {
    true
}

pub fn featured_packs() -> Vec<FeaturedPack> {
    serde_json::from_str(FEATURED_JSON).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_featured_parses() {
        let packs = featured_packs();
        assert!(packs.iter().any(|f| f.id == "brassworks"));
        let bw = packs.iter().find(|f| f.id == "brassworks").unwrap();
        assert!(bw.pack_url.contains("pack.toml"));
    }
}
