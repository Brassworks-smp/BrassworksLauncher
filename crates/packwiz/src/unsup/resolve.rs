use std::collections::{HashMap, HashSet};

use crate::model::{MetaFile, Pack};

use super::model::{Choices, FlavorChoice, FlavorGroup, UnsupToml};

pub fn detect(pack: &Pack) -> Option<&str> {
    pack.versions.unsup.as_deref().filter(|v| !v.trim().is_empty())
}

#[derive(Debug, Clone)]
pub struct MetafileRef {
    pub path: String,
        pub display_name: String,
    pub optional: bool,
    pub option_default: bool,
    pub option_description: Option<String>,
        pub side: String,
}

impl MetafileRef {
        pub fn new(path: impl Into<String>, meta: &MetaFile) -> Self {
        let opt = meta.option.as_ref();
        Self {
            path: path.into(),
            display_name: meta.name.clone(),
            optional: opt.map(|o| o.optional).unwrap_or(false),
            option_default: opt.map(|o| o.default).unwrap_or(false),
            option_description: opt
                .and_then(|o| o.description.clone())
                .filter(|d| !d.trim().is_empty()),
            side: normalize_side(&meta.side),
        }
    }

        pub fn name(&self) -> &str {
        metafile_name(&self.path)
    }
}

#[derive(Debug, Clone, Default)]
pub struct Resolution {
            pub groups: Vec<FlavorGroup>,
            pub metafile_flavors: HashMap<String, Vec<String>>,
}

fn normalize_side(side: &str) -> String {
    match side {
        "client" => "client",
        "server" => "server",
        _ => "both",
    }
    .to_string()
}

fn client_eligible(side: &str) -> bool {
    side != "server"
}

pub fn resolve(unsup: &UnsupToml, metafiles: &[MetafileRef]) -> Resolution {
        let mut owned: HashMap<String, Vec<String>> = HashMap::new();
    for (key, raw) in &unsup.metafile {
        if let Some(flavors) = raw.flavors.clone() {
            owned.insert(key.clone(), flavors.into_vec());
        }
    }

    let mut groups: Vec<FlavorGroup> = Vec::new();

        for (id, raw) in &unsup.flavor_groups {
        let side = raw.side.as_deref().map(normalize_side).unwrap_or_else(|| "both".to_string());
        if !client_eligible(&side) {
            continue;
        }
        let name = raw.name.clone().unwrap_or_else(|| id.clone());
        let choices: Vec<FlavorChoice> = match &raw.choices {
            Choices::Detailed(list) => list
                .iter()
                .map(|c| FlavorChoice {
                    id: c.id.clone(),
                    name: c.name.clone().unwrap_or_else(|| c.id.clone()),
                    description: c.description.clone().filter(|d| !d.trim().is_empty()),
                    default: false,
                })
                .collect(),
            Choices::Shorthand(ids) => ids
                .iter()
                .map(|s| FlavorChoice {
                    id: s.clone(),
                    name: s.clone(),
                    description: None,
                    default: false,
                })
                .collect(),
        };
        groups.push(FlavorGroup {
            id: id.clone(),
            name,
            description: raw.description.clone().filter(|d| !d.trim().is_empty()),
            side,
            choices,
        });
    }

        for mf in metafiles {
        let name = mf.name();
        if !mf.optional || owned.contains_key(name) {
            continue;
        }
        if !client_eligible(&mf.side) {
            continue;
        }
        let on_id = format!("{name}_on");
        let off_id = format!("{name}_off");
        groups.push(FlavorGroup {
            id: name.to_string(),
            name: mf.display_name.clone(),
            description: mf.option_description.clone(),
            side: mf.side.clone(),
            choices: vec![
                FlavorChoice {
                    id: on_id.clone(),
                    name: "On".to_string(),
                    description: None,
                    default: mf.option_default,
                },
                FlavorChoice {
                    id: off_id,
                    name: "Off".to_string(),
                    description: None,
                    default: !mf.option_default,
                },
            ],
        });
        owned.insert(name.to_string(), vec![on_id]);
    }

        let mut metafile_flavors: HashMap<String, Vec<String>> = HashMap::new();
    for mf in metafiles {
        let mut flavors: Vec<String> = Vec::new();
        if let Some(by_path) = owned.get(&format!("/{}", mf.path)) {
            flavors.extend(by_path.iter().cloned());
        }
        if let Some(by_name) = owned.get(mf.name()) {
            flavors.extend(by_name.iter().cloned());
        }
        metafile_flavors.insert(mf.path.clone(), flavors);
    }

    Resolution {
        groups,
        metafile_flavors,
    }
}

pub fn keep_metafile(flavors: &[String], selected: &HashSet<String>) -> bool {
    flavors.is_empty() || flavors.iter().any(|f| selected.contains(f))
}

pub fn metafile_flavors_one(unsup: &UnsupToml, path: &str, optional: bool) -> Vec<String> {
    let name = metafile_name(path);
    let by_path = unsup
        .metafile
        .get(&format!("/{path}"))
        .and_then(|m| m.flavors.clone())
        .map(|f| f.into_vec());
    let by_name = unsup
        .metafile
        .get(name)
        .and_then(|m| m.flavors.clone())
        .map(|f| f.into_vec());

    let mut out = Vec::new();
    if let Some(p) = by_path {
        out.extend(p);
    }
    let has_name = by_name.is_some();
    if let Some(n) = by_name {
        out.extend(n);
    }
    if optional && !has_name {
        out.push(format!("{name}_on"));
    }
    out
}

fn metafile_name(path: &str) -> &str {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.strip_suffix(".pw.toml").unwrap_or(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mf(path: &str, optional: bool, default: bool, side: &str) -> MetafileRef {
        MetafileRef {
            path: path.to_string(),
            display_name: path.rsplit('/').next().unwrap().to_string(),
            optional,
            option_default: default,
            option_description: None,
            side: side.to_string(),
        }
    }

    const UNSUP: &str = r#"
        [flavor_groups.rendering_mod]
        name = "Rendering Mod"
        side = "client"
        [[flavor_groups.rendering_mod.choices]]
        id = "no_rendering_mods"
        name = "None"
        [[flavor_groups.rendering_mod.choices]]
        id = "sodium"
        name = "Sodium"
        [[flavor_groups.rendering_mod.choices]]
        id = "iris"
        name = "Iris"

        [flavor_groups.hard_mode]
        name = "Hard Mode"
        side = "both"
        choices = ["hard_mode_off", "hard_mode_on"]

        [flavor_groups.server_only]
        name = "Server Thing"
        side = "server"
        choices = ["a", "b"]

        [metafile.sodium]
        flavors = ["iris", "sodium"]
        [metafile."/mods/special.pw.toml"]
        flavors = "special_flavor"
    "#;

    #[test]
    fn detect_keys_on_versions_unsup() {
        let with = r#"
            name = "T"
            [versions]
            unsup = "1.1.6"
            [index]
            file = "index.toml"
        "#;
        let without = r#"
            name = "T"
            [versions]
            minecraft = "1.20.1"
            [index]
            file = "index.toml"
        "#;
        assert_eq!(detect(&toml::from_str(with).unwrap()), Some("1.1.6"));
        assert_eq!(detect(&toml::from_str(without).unwrap()), None);
    }

    #[test]
    fn resolves_groups_and_metafile_flavors() {
        let unsup: UnsupToml = toml::from_str(UNSUP).unwrap();
        let metafiles = vec![
            mf("mods/sodium.pw.toml", false, false, "both"),
            mf("mods/special.pw.toml", false, false, "both"),
            mf("mods/optional_thing.pw.toml", true, false, "both"),
            mf("mods/required.pw.toml", false, false, "both"),
                        mf("mods/server_mod.pw.toml", true, false, "server"),
        ];
        let res = resolve(&unsup, &metafiles);

        let ids: Vec<&str> = res.groups.iter().map(|g| g.id.as_str()).collect();
                assert_eq!(ids, vec!["hard_mode", "rendering_mod", "optional_thing"]);

        let hard = res.groups.iter().find(|g| g.id == "hard_mode").unwrap();
        assert!(hard.is_boolean());
        let rendering = res.groups.iter().find(|g| g.id == "rendering_mod").unwrap();
        assert_eq!(rendering.choices.len(), 3);
        assert!(!rendering.is_boolean());

        let synth = res.groups.iter().find(|g| g.id == "optional_thing").unwrap();
        assert!(synth.is_boolean());
        assert_eq!(synth.choices[0].id, "optional_thing_on");
        assert!(!synth.choices[0].default, "default=false → On not preselected");
        assert!(synth.choices[1].default, "Off preselected");

        assert_eq!(res.metafile_flavors["mods/sodium.pw.toml"], vec!["iris", "sodium"]);
        assert_eq!(res.metafile_flavors["mods/special.pw.toml"], vec!["special_flavor"]);
        assert_eq!(res.metafile_flavors["mods/optional_thing.pw.toml"], vec!["optional_thing_on"]);
        assert!(res.metafile_flavors["mods/required.pw.toml"].is_empty());
    }

    #[test]
    fn synthetic_default_on_when_option_default() {
        let unsup = UnsupToml::default();
        let metafiles = vec![mf("mods/extras.pw.toml", true, true, "both")];
        let res = resolve(&unsup, &metafiles);
        let g = &res.groups[0];
        assert_eq!(g.id, "extras");
        assert!(g.choices[0].default, "On preselected when [option].default = true");
        assert!(!g.choices[1].default);
    }

    #[test]
    fn explicit_flavor_suppresses_synthetic_group() {
                        let unsup: UnsupToml = toml::from_str(
            r#"
            [metafile.sodium]
            flavors = "rendering"
        "#,
        )
        .unwrap();
        let metafiles = vec![mf("mods/sodium.pw.toml", true, false, "both")];
        let res = resolve(&unsup, &metafiles);
        assert!(res.groups.is_empty(), "no synthetic group for explicitly-flavored mod");
        assert_eq!(res.metafile_flavors["mods/sodium.pw.toml"], vec!["rendering"]);
    }

    #[test]
    fn metafile_flavors_one_matches_resolve() {
        let unsup: UnsupToml = toml::from_str(UNSUP).unwrap();
                assert_eq!(
            metafile_flavors_one(&unsup, "mods/sodium.pw.toml", false),
            vec!["iris", "sodium"]
        );
                assert_eq!(
            metafile_flavors_one(&unsup, "mods/special.pw.toml", false),
            vec!["special_flavor"]
        );
                assert_eq!(
            metafile_flavors_one(&unsup, "mods/optional_thing.pw.toml", true),
            vec!["optional_thing_on"]
        );
                assert!(metafile_flavors_one(&unsup, "mods/required.pw.toml", false).is_empty());
    }

    #[test]
    fn keep_metafile_intersection() {
        let selected: HashSet<String> = ["sodium".to_string(), "hard_mode_on".to_string()].into();
        assert!(keep_metafile(&[], &selected), "unconditional kept");
        assert!(keep_metafile(&["iris".into(), "sodium".into()], &selected));
        assert!(!keep_metafile(&["iris".into(), "canvas".into()], &selected));
    }

            #[test]
    #[ignore = "network: fetches a real unsup.toml from github.com"]
    fn parses_real_blanketcon_pack() {
        let url = "https://raw.githubusercontent.com/ModFest/blanketcon-25/HEAD/pack/unsup.toml";
        let text = reqwest::blocking::get(url).unwrap().text().unwrap();
        let unsup: UnsupToml = toml::from_str(&text).unwrap();

                assert!(unsup.flavor_groups.contains_key("axiom"));
        assert!(unsup.flavor_groups.contains_key("worldedit"));

                let metafiles = vec![
            mf("mods/axiom-client.pw.toml", false, false, "client"),
            mf("mods/worldedit-client.pw.toml", false, false, "client"),
            mf("mods/worldeditcui.pw.toml", false, false, "client"),
        ];
        let res = resolve(&unsup, &metafiles);
        assert!(res.groups.len() >= 2);
        assert_eq!(res.metafile_flavors["mods/axiom-client.pw.toml"], vec!["axiom_accept"]);

        let pick_accept: HashSet<String> = ["axiom_accept".to_string()].into();
        assert!(keep_metafile(&res.metafile_flavors["mods/axiom-client.pw.toml"], &pick_accept));
        let pick_decline: HashSet<String> = ["axiom_decline".to_string()].into();
        assert!(!keep_metafile(&res.metafile_flavors["mods/axiom-client.pw.toml"], &pick_decline));
    }

    #[test]
    fn metafile_ref_name_strips_suffix() {
        let meta: crate::model::MetaFile = toml::from_str(
            r#"
            name = "Sodium"
            filename = "sodium.jar"
            side = "client"
            [download]
            url = "https://x/sodium.jar"
            hash-format = "sha256"
            hash = "abc"
            [option]
            optional = true
            default = true
            description = "Fast"
        "#,
        )
        .unwrap();
        let r = MetafileRef::new("mods/sodium.pw.toml", &meta);
        assert_eq!(r.name(), "sodium");
        assert!(r.optional && r.option_default);
        assert_eq!(r.side, "client");
        assert_eq!(r.option_description.as_deref(), Some("Fast"));
    }
}
