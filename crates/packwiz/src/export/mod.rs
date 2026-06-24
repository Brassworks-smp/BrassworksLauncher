mod index;
mod metafile;
mod pack;
mod zip;

pub use index::IndexBuilder;
pub use metafile::{ModSource, OptionMeta};
pub use pack::{render_pack_toml, Loader, PackMeta, PACK_FORMAT};

use std::collections::HashSet;

use crate::{sha256_hex, Result};

#[derive(Debug, Clone)]
pub struct ExportMod {
    pub category: String,
    pub name: String,
    pub filename: String,
    pub side: String,
    pub bytes: Vec<u8>,
    pub source: ModSource,
    pub optional: Option<OptionMeta>,
}

#[derive(Debug, Clone)]
pub struct ExportFile {
    pub rel_path: String,
    pub bytes: Vec<u8>,
}

pub fn build_packwiz_zip(
    meta: &PackMeta,
    mods: &[ExportMod],
    files: &[ExportFile],
    icon: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let mut index = IndexBuilder::new();
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    let mut used_slugs: HashSet<String> = HashSet::new();
    let mut seen: HashSet<String> = HashSet::new();

    for m in mods {
        match m.source {
            ModSource::Embed => {
                let path = format!("{}/{}", m.category, m.filename);
                if !seen.insert(path.clone()) {
                    continue;
                }
                index.add_file(path.clone(), &m.bytes);
                entries.push((path, m.bytes.clone()));
            }
            _ => {
                let slug = unique_slug(&m.filename, &mut used_slugs);
                let path = format!("{}/{}.pw.toml", m.category, slug);
                if !seen.insert(path.clone()) {
                    continue;
                }
                let text = metafile::render_metafile(m)?;
                let bytes = text.into_bytes();
                index.add_metafile(path.clone(), &bytes);
                entries.push((path, bytes));
            }
        }
    }

    for f in files {
        if !seen.insert(f.rel_path.clone()) {
            continue;
        }
        index.add_file(f.rel_path.clone(), &f.bytes);
        entries.push((f.rel_path.clone(), f.bytes.clone()));
    }

    let index_toml = index.render()?;
    let index_hash = sha256_hex(index_toml.as_bytes());
    let pack_toml = render_pack_toml(meta, &index_hash)?;

    let mut zip_entries: Vec<(String, Vec<u8>)> = Vec::new();
    zip_entries.push(("pack.toml".to_string(), pack_toml.into_bytes()));
    zip_entries.push(("index.toml".to_string(), index_toml.into_bytes()));
    if let Some(icon) = icon {
        zip_entries.push(("icon.png".to_string(), icon.to_vec()));
    }
    zip_entries.extend(entries);
    zip::build_zip(&zip_entries)
}

fn unique_slug(filename: &str, used: &mut HashSet<String>) -> String {
    let stem = filename
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(filename);
    let mut base: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    while base.contains("--") {
        base = base.replace("--", "-");
    }
    let base = base.trim_matches('-').to_string();
    let base = if base.is_empty() {
        "mod".to_string()
    } else {
        base
    };
    if used.insert(base.clone()) {
        return base;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if used.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{sha256_hex, Index, Pack};
    use std::io::Read;

    fn read_entry(zip_bytes: &[u8], name: &str) -> Option<Vec<u8>> {
        let mut archive = ::zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).ok()?;
        let mut file = archive.by_name(name).ok()?;
        let mut out = Vec::new();
        file.read_to_end(&mut out).ok()?;
        Some(out)
    }

    fn entry_names(zip_bytes: &[u8]) -> Vec<String> {
        let mut archive = ::zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).unwrap();
        (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect()
    }

    fn meta() -> PackMeta {
        PackMeta {
            name: "My Pack".to_string(),
            author: "swzo".to_string(),
            version: "1.0.0".to_string(),
            mc_version: "1.21.1".to_string(),
            loader: Some(Loader::NeoForge),
            loader_version: Some("21.1.0".to_string()),
        }
    }

    fn sample_mods() -> Vec<ExportMod> {
        vec![
            ExportMod {
                category: "mods".to_string(),
                name: "Modrinth Mod".to_string(),
                filename: "mr.jar".to_string(),
                side: "both".to_string(),
                bytes: b"MRJAR".to_vec(),
                source: ModSource::Modrinth {
                    project_id: "AABBCC".to_string(),
                    version_id: "v1".to_string(),
                    url: "https://cdn.modrinth.com/data/AABBCC/mr.jar".to_string(),
                    sha512: "e".repeat(128),
                },
                optional: None,
            },
            ExportMod {
                category: "mods".to_string(),
                name: "CF Mod".to_string(),
                filename: "cf.jar".to_string(),
                side: "both".to_string(),
                bytes: b"CFJAR".to_vec(),
                source: ModSource::Curseforge {
                    project_id: 111,
                    file_id: 222,
                    sha1: "a".repeat(40),
                },
                optional: None,
            },
            ExportMod {
                category: "mods".to_string(),
                name: "Blocked CF Mod".to_string(),
                filename: "blocked.jar".to_string(),
                side: "both".to_string(),
                bytes: b"BLOCKEDJAR".to_vec(),
                source: ModSource::Embed,
                optional: None,
            },
        ]
    }

    fn sample_files() -> Vec<ExportFile> {
        vec![ExportFile {
            rel_path: "config/foo.toml".to_string(),
            bytes: b"a = 1".to_vec(),
        }]
    }

    #[test]
    fn zip_has_expected_layout() {
        let zip = build_packwiz_zip(&meta(), &sample_mods(), &sample_files(), Some(b"PNGDATA"))
            .unwrap();
        let names = entry_names(&zip);
        assert!(names.contains(&"pack.toml".to_string()));
        assert!(names.contains(&"index.toml".to_string()));
        assert!(names.contains(&"icon.png".to_string()));
        assert!(names.contains(&"mods/mr.pw.toml".to_string()));
        assert!(names.contains(&"mods/cf.pw.toml".to_string()));
        assert!(names.contains(&"mods/blocked.jar".to_string()));
        assert!(names.contains(&"config/foo.toml".to_string()));
        assert_eq!(read_entry(&zip, "icon.png").unwrap(), b"PNGDATA");
        assert_eq!(read_entry(&zip, "mods/blocked.jar").unwrap(), b"BLOCKEDJAR");
    }

    #[test]
    fn blocked_mod_has_no_metafile() {
        let zip =
            build_packwiz_zip(&meta(), &sample_mods(), &sample_files(), None).unwrap();
        let names = entry_names(&zip);
        assert!(!names.iter().any(|n| n == "mods/blocked.pw.toml"));
    }

    #[test]
    fn pack_toml_index_hash_matches_index_bytes() {
        let zip =
            build_packwiz_zip(&meta(), &sample_mods(), &sample_files(), None).unwrap();
        let pack_bytes = read_entry(&zip, "pack.toml").unwrap();
        let index_bytes = read_entry(&zip, "index.toml").unwrap();
        let pack: Pack = toml::from_str(&String::from_utf8(pack_bytes).unwrap()).unwrap();
        assert_eq!(pack.index.hash, sha256_hex(&index_bytes));
    }

    #[test]
    fn every_listed_file_is_present_with_correct_hash() {
        let zip =
            build_packwiz_zip(&meta(), &sample_mods(), &sample_files(), Some(b"i")).unwrap();
        let index_bytes = read_entry(&zip, "index.toml").unwrap();
        let index: Index = toml::from_str(&String::from_utf8(index_bytes).unwrap()).unwrap();
        assert!(!index.files.is_empty());
        for f in &index.files {
            let bytes = read_entry(&zip, &f.file)
                .unwrap_or_else(|| panic!("missing zip entry {}", f.file));
            assert_eq!(f.hash, sha256_hex(&bytes), "hash for {}", f.file);
        }
    }

    #[test]
    fn icon_is_not_indexed() {
        let zip =
            build_packwiz_zip(&meta(), &sample_mods(), &sample_files(), Some(b"i")).unwrap();
        let index_bytes = read_entry(&zip, "index.toml").unwrap();
        let index: Index = toml::from_str(&String::from_utf8(index_bytes).unwrap()).unwrap();
        assert!(!index.files.iter().any(|f| f.file == "icon.png"));
    }

    #[test]
    fn duplicate_paths_are_deduped_not_errored() {
        let dup = ExportMod {
            category: "resourcepacks".to_string(),
            name: "Pack".to_string(),
            filename: "pack.zip".to_string(),
            side: "both".to_string(),
            bytes: b"PACK".to_vec(),
            source: ModSource::Embed,
            optional: None,
        };
        let files = vec![ExportFile {
            rel_path: "resourcepacks/pack.zip".to_string(),
            bytes: b"PACK".to_vec(),
        }];
        let zip =
            build_packwiz_zip(&meta(), &[dup.clone(), dup], &files, None).unwrap();
        let mut archive =
            ::zip::ZipArchive::new(std::io::Cursor::new(&zip)).unwrap();
        let count = (0..archive.len())
            .filter(|i| archive.by_index(*i).unwrap().name() == "resourcepacks/pack.zip")
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn duplicate_filenames_get_unique_slugs() {
        let mut used = HashSet::new();
        let a = unique_slug("Cool Mod.jar", &mut used);
        let b = unique_slug("Cool Mod.jar", &mut used);
        assert_eq!(a, "cool-mod");
        assert_eq!(b, "cool-mod-2");
    }

    #[test]
    fn modrinth_metafile_roundtrips_from_zip() {
        let zip =
            build_packwiz_zip(&meta(), &sample_mods(), &sample_files(), None).unwrap();
        let bytes = read_entry(&zip, "mods/mr.pw.toml").unwrap();
        let meta: crate::MetaFile =
            toml::from_str(&String::from_utf8(bytes).unwrap()).unwrap();
        assert_eq!(meta.filename, "mr.jar");
        assert_eq!(meta.download.hash_format, "sha512");
    }
}
