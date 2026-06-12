use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize)]
pub struct UnsupToml {
    #[serde(default)]
    pub flavor_groups: BTreeMap<String, RawFlavorGroup>,
            #[serde(default)]
    pub metafile: BTreeMap<String, RawMetafile>,
    #[serde(default)]
    pub features: Features,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Features {
                #[serde(default)]
    pub metafiles_zip: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawFlavorGroup {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
        #[serde(default)]
    pub side: Option<String>,
    #[serde(default)]
    pub choices: Choices,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Choices {
    Detailed(Vec<RawChoice>),
    Shorthand(Vec<String>),
}

impl Default for Choices {
    fn default() -> Self {
        Choices::Shorthand(Vec::new())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawChoice {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawMetafile {
    #[serde(default)]
    pub flavors: Option<StringOrVec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum StringOrVec {
    One(String),
    Many(Vec<String>),
}

impl StringOrVec {
    pub fn into_vec(self) -> Vec<String> {
        match self {
            StringOrVec::One(s) => vec![s],
            StringOrVec::Many(v) => v,
        }
    }
}


#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FlavorGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
        pub side: String,
    pub choices: Vec<FlavorChoice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FlavorChoice {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
            pub default: bool,
}

impl FlavorGroup {
        pub fn is_boolean(&self) -> bool {
        if self.choices.len() != 2 {
            return false;
        }
        let on = format!("{}_on", self.id);
        let off = format!("{}_off", self.id);
        let a = &self.choices[0].id;
        let b = &self.choices[1].id;
        (*a == on && *b == off) || (*a == off && *b == on)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_detailed_choices() {
        let t: UnsupToml = toml::from_str(
            r#"
            [flavor_groups.rendering]
            name = "Rendering"
            [[flavor_groups.rendering.choices]]
            id = "sodium"
            name = "Sodium"
            description = "Fast"
            [[flavor_groups.rendering.choices]]
            id = "iris"
        "#,
        )
        .unwrap();
        let g = &t.flavor_groups["rendering"];
        match &g.choices {
            Choices::Detailed(c) => {
                assert_eq!(c.len(), 2);
                assert_eq!(c[0].id, "sodium");
                assert_eq!(c[0].name.as_deref(), Some("Sodium"));
                assert_eq!(c[1].id, "iris");
                assert_eq!(c[1].name, None);
            }
            other => panic!("expected detailed choices, got {other:?}"),
        }
    }

    #[test]
    fn parses_shorthand_and_string_or_vec() {
        let t: UnsupToml = toml::from_str(
            r#"
            [flavor_groups.hard_mode]
            choices = ["hard_mode_off", "hard_mode_on"]
            [metafile.one]
            flavors = "solo"
            [metafile.two]
            flavors = ["a", "b"]
        "#,
        )
        .unwrap();
        match &t.flavor_groups["hard_mode"].choices {
            Choices::Shorthand(ids) => assert_eq!(ids, &["hard_mode_off", "hard_mode_on"]),
            other => panic!("expected shorthand, got {other:?}"),
        }
        assert_eq!(t.metafile["one"].flavors.clone().unwrap().into_vec(), vec!["solo"]);
        assert_eq!(t.metafile["two"].flavors.clone().unwrap().into_vec(), vec!["a", "b"]);
    }

    #[test]
    fn is_boolean_detects_on_off_pairs() {
        let group = |a: &str, b: &str| FlavorGroup {
            id: "x".into(),
            name: "X".into(),
            description: None,
            side: "both".into(),
            choices: vec![choice(a), choice(b)],
        };
        assert!(group("x_on", "x_off").is_boolean());
        assert!(group("x_off", "x_on").is_boolean(), "order-independent");
        assert!(!group("x_on", "x_maybe").is_boolean());
        assert!(!FlavorGroup {
            id: "x".into(),
            name: "X".into(),
            description: None,
            side: "both".into(),
            choices: vec![choice("x_on"), choice("x_off"), choice("x_extra")],
        }
        .is_boolean());
    }

    fn choice(id: &str) -> FlavorChoice {
        FlavorChoice {
            id: id.into(),
            name: id.into(),
            description: None,
            default: false,
        }
    }
}
