use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Clone)]
pub struct FlavorChoiceDef {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FlavorGroupDef {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub side: String,
    pub choices: Vec<FlavorChoiceDef>,
}

#[derive(Serialize)]
struct UnsupOut {
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    flavor_groups: BTreeMap<String, GroupOut>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    metafile: BTreeMap<String, MetafileOut>,
}

#[derive(Serialize)]
struct GroupOut {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    side: String,
    choices: Vec<ChoiceOut>,
}

#[derive(Serialize)]
struct ChoiceOut {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

#[derive(Serialize)]
struct MetafileOut {
    flavors: Vec<String>,
}

fn clean(opt: &Option<String>) -> Option<String> {
    opt.as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn render_unsup_toml(
    groups: &[FlavorGroupDef],
    metafile_flavors: &BTreeMap<String, Vec<String>>,
) -> String {
    let mut flavor_groups = BTreeMap::new();
    for g in groups {
        let side = match g.side.trim() {
            "client" => "client",
            "server" => "server",
            _ => "both",
        }
        .to_string();
        let choices = g
            .choices
            .iter()
            .map(|c| ChoiceOut {
                id: c.id.clone(),
                name: if c.name.trim().is_empty() {
                    c.id.clone()
                } else {
                    c.name.clone()
                },
                description: clean(&c.description),
            })
            .collect();
        flavor_groups.insert(
            g.id.clone(),
            GroupOut {
                name: if g.name.trim().is_empty() {
                    g.id.clone()
                } else {
                    g.name.clone()
                },
                description: clean(&g.description),
                side,
                choices,
            },
        );
    }

    let metafile = metafile_flavors
        .iter()
        .filter(|(_, f)| !f.is_empty())
        .map(|(k, f)| {
            (
                k.clone(),
                MetafileOut {
                    flavors: f.clone(),
                },
            )
        })
        .collect();

    let out = UnsupOut {
        flavor_groups,
        metafile,
    };
    toml::to_string(&out).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::unsup::{Choices, UnsupToml};

    fn sample_groups() -> Vec<FlavorGroupDef> {
        vec![
            FlavorGroupDef {
                id: "rendering_mod".to_string(),
                name: "Rendering Mod".to_string(),
                description: Some("Pick one".to_string()),
                side: "client".to_string(),
                choices: vec![
                    FlavorChoiceDef {
                        id: "no_rendering".to_string(),
                        name: "None".to_string(),
                        description: None,
                    },
                    FlavorChoiceDef {
                        id: "sodium".to_string(),
                        name: "Sodium".to_string(),
                        description: Some("Fast".to_string()),
                    },
                    FlavorChoiceDef {
                        id: "iris".to_string(),
                        name: "Iris".to_string(),
                        description: None,
                    },
                ],
            },
            FlavorGroupDef {
                id: "hard_mode".to_string(),
                name: String::new(),
                description: None,
                side: "both".to_string(),
                choices: vec![
                    FlavorChoiceDef {
                        id: "hard_mode_off".to_string(),
                        name: "Off".to_string(),
                        description: None,
                    },
                    FlavorChoiceDef {
                        id: "hard_mode_on".to_string(),
                        name: "On".to_string(),
                        description: None,
                    },
                ],
            },
        ]
    }

    fn sample_owners() -> BTreeMap<String, Vec<String>> {
        let mut m = BTreeMap::new();
        m.insert(
            "/mods/sodium.pw.toml".to_string(),
            vec!["sodium".to_string(), "iris".to_string()],
        );
        m.insert(
            "/mods/iris.pw.toml".to_string(),
            vec!["iris".to_string()],
        );
        m
    }

    #[test]
    fn renders_and_reparses_with_import_model() {
        let text = render_unsup_toml(&sample_groups(), &sample_owners());
        let parsed: UnsupToml = toml::from_str(&text).unwrap();

        let rendering = &parsed.flavor_groups["rendering_mod"];
        assert_eq!(rendering.name.as_deref(), Some("Rendering Mod"));
        assert_eq!(rendering.side.as_deref(), Some("client"));
        match &rendering.choices {
            Choices::Detailed(c) => {
                assert_eq!(c.len(), 3);
                assert_eq!(c[1].id, "sodium");
                assert_eq!(c[1].description.as_deref(), Some("Fast"));
            }
            other => panic!("expected detailed choices, got {other:?}"),
        }

        // empty group name falls back to the id
        assert_eq!(parsed.flavor_groups["hard_mode"].name.as_deref(), Some("hard_mode"));

        // exact-path metafile ownership, multi-choice membership
        let sodium = parsed.metafile["/mods/sodium.pw.toml"]
            .flavors
            .clone()
            .unwrap()
            .into_vec();
        assert_eq!(sodium, vec!["sodium", "iris"]);
    }

    #[test]
    fn empty_groups_and_owners_render_empty() {
        let text = render_unsup_toml(&[], &BTreeMap::new());
        assert!(text.trim().is_empty(), "got: {text:?}");
    }

    #[test]
    fn description_with_newlines_and_quotes_roundtrips() {
        let groups = vec![FlavorGroupDef {
            id: "g".to_string(),
            name: "G".to_string(),
            description: Some("Line one\nLine \"two\"".to_string()),
            side: "both".to_string(),
            choices: vec![FlavorChoiceDef {
                id: "a".to_string(),
                name: "A".to_string(),
                description: None,
            }],
        }];
        let text = render_unsup_toml(&groups, &BTreeMap::new());
        let parsed: UnsupToml = toml::from_str(&text).unwrap();
        assert_eq!(
            parsed.flavor_groups["g"].description.as_deref(),
            Some("Line one\nLine \"two\"")
        );
    }
}
