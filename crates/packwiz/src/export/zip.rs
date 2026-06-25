use std::io::Write;

use crate::{PackwizError, Result};

pub fn build_zip(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = zip::write::SimpleFileOptions::default();
        for (path, bytes) in entries {
            writer
                .start_file(path.as_str(), opts)
                .map_err(|e| PackwizError::Other(format!("zip entry {path}: {e}")))?;
            writer
                .write_all(bytes)
                .map_err(|e| PackwizError::io(path.clone(), e))?;
        }
        writer
            .finish()
            .map_err(|e| PackwizError::Other(format!("zip finish: {e}")))?;
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn read_entry(zip_bytes: &[u8], name: &str) -> Option<Vec<u8>> {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).ok()?;
        let mut file = archive.by_name(name).ok()?;
        let mut out = Vec::new();
        file.read_to_end(&mut out).ok()?;
        Some(out)
    }

    #[test]
    fn entries_roundtrip() {
        let entries = vec![
            ("pack.toml".to_string(), b"name = 'x'".to_vec()),
            ("mods/a.jar".to_string(), vec![1, 2, 3]),
        ];
        let zip_bytes = build_zip(&entries).unwrap();
        assert_eq!(read_entry(&zip_bytes, "pack.toml").unwrap(), b"name = 'x'");
        assert_eq!(read_entry(&zip_bytes, "mods/a.jar").unwrap(), vec![1, 2, 3]);
        assert!(read_entry(&zip_bytes, "missing").is_none());
    }
}
