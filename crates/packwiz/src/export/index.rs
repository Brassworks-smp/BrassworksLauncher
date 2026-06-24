use serde::Serialize;

use crate::{sha256_hex, PackwizError, Result};

#[derive(Default)]
pub struct IndexBuilder {
    rows: Vec<IndexRow>,
}

struct IndexRow {
    file: String,
    hash: String,
    metafile: bool,
}

#[derive(Serialize)]
struct IndexToml {
    #[serde(rename = "hash-format")]
    hash_format: String,
    files: Vec<FileEntry>,
}

#[derive(Serialize)]
struct FileEntry {
    file: String,
    hash: String,
    #[serde(skip_serializing_if = "is_false")]
    metafile: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl IndexBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_metafile(&mut self, path: impl Into<String>, bytes: &[u8]) {
        self.rows.push(IndexRow {
            file: path.into(),
            hash: sha256_hex(bytes),
            metafile: true,
        });
    }

    pub fn add_file(&mut self, path: impl Into<String>, bytes: &[u8]) {
        self.rows.push(IndexRow {
            file: path.into(),
            hash: sha256_hex(bytes),
            metafile: false,
        });
    }

    pub fn render(&self) -> Result<String> {
        let mut rows: Vec<&IndexRow> = self.rows.iter().collect();
        rows.sort_by(|a, b| a.file.cmp(&b.file));
        let index = IndexToml {
            hash_format: "sha256".to_string(),
            files: rows
                .into_iter()
                .map(|r| FileEntry {
                    file: r.file.clone(),
                    hash: r.hash.clone(),
                    metafile: r.metafile,
                })
                .collect(),
        };
        toml::to_string(&index)
            .map_err(|e| PackwizError::Other(format!("serialize index.toml: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Index;

    #[test]
    fn rows_sorted_by_path() {
        let mut b = IndexBuilder::new();
        b.add_file("config/z.toml", b"z");
        b.add_metafile("mods/a.pw.toml", b"a");
        let index: Index = toml::from_str(&b.render().unwrap()).unwrap();
        assert_eq!(index.files[0].file, "config/z.toml");
        assert_eq!(index.files[1].file, "mods/a.pw.toml");
    }

    #[test]
    fn metafile_flag_only_on_metafiles() {
        let mut b = IndexBuilder::new();
        b.add_metafile("mods/a.pw.toml", b"a");
        b.add_file("config/b.toml", b"b");
        let index: Index = toml::from_str(&b.render().unwrap()).unwrap();
        let a = index.files.iter().find(|f| f.file == "mods/a.pw.toml").unwrap();
        let bb = index.files.iter().find(|f| f.file == "config/b.toml").unwrap();
        assert!(a.metafile);
        assert!(!bb.metafile);
    }

    #[test]
    fn hashes_are_sha256_of_bytes() {
        let mut b = IndexBuilder::new();
        b.add_file("config/b.toml", b"hello");
        let index: Index = toml::from_str(&b.render().unwrap()).unwrap();
        assert_eq!(index.hash_format, "sha256");
        assert_eq!(index.files[0].hash, sha256_hex(b"hello"));
    }

    #[test]
    fn render_is_deterministic() {
        let mut a = IndexBuilder::new();
        a.add_file("b.toml", b"1");
        a.add_metafile("a.pw.toml", b"2");
        let mut b = IndexBuilder::new();
        b.add_metafile("a.pw.toml", b"2");
        b.add_file("b.toml", b"1");
        assert_eq!(a.render().unwrap(), b.render().unwrap());
    }
}
