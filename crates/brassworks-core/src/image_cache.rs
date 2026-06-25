use std::path::{Path, PathBuf};
use std::time::Duration;

use packwiz::sha1_hex;

const TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_BYTES: u64 = 10 * 1024 * 1024;

fn is_remote(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn ext_for(value: &str) -> &str {
    let path = value.split(['?', '#']).next().unwrap_or(value);
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext.to_ascii_lowercase().as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpg",
        "gif" => "gif",
        "webp" => "webp",
        "bmp" => "bmp",
        "ico" => "ico",
        "svg" => "svg",
        _ => "img",
    }
}

fn cache_path(dir: &Path, value: &str) -> PathBuf {
    let key = sha1_hex(value.as_bytes());
    dir.join(format!("{key}.{}", ext_for(value)))
}

fn is_fresh(path: &Path) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|m| m.elapsed().ok())
        .map(|age| age < TTL)
        .unwrap_or(false)
}

fn client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("BrassworksLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .ok()
}

fn fetch(value: &str) -> Option<Vec<u8>> {
    if is_remote(value) {
        let resp = client()?.get(value).send().ok()?;
        if !resp.status().is_success() {
            return None;
        }
        if resp.content_length().is_some_and(|len| len > MAX_BYTES) {
            return None;
        }
        let bytes = resp.bytes().ok()?;
        if bytes.len() as u64 > MAX_BYTES {
            return None;
        }
        Some(bytes.to_vec())
    } else {
        let meta = std::fs::metadata(value).ok()?;
        if meta.len() > MAX_BYTES {
            return None;
        }
        std::fs::read(value).ok()
    }
}

pub fn download(url: &str) -> Option<Vec<u8>> {
    if is_remote(url) {
        fetch(url)
    } else {
        None
    }
}

pub fn cache_image(dir: &Path, value: &str) -> Option<PathBuf> {
    let path = cache_path(dir, value);
    if is_fresh(&path) {
        return Some(path);
    }
    let bytes = fetch(value)?;
    if bytes.is_empty() {
        return None;
    }
    std::fs::create_dir_all(dir).ok()?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &bytes).ok()?;
    std::fs::rename(&tmp, &path).ok()?;
    Some(path)
}

pub fn cached_image(dir: &Path, value: &str) -> Option<PathBuf> {
    let path = cache_path(dir, value);
    path.exists().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ext_handles_query_and_unknown() {
        assert_eq!(ext_for("https://x.test/a/icon.PNG?v=2"), "png");
        assert_eq!(ext_for("https://x.test/a/b.jpeg#frag"), "jpg");
        assert_eq!(ext_for("https://x.test/no-extension"), "img");
    }

    #[test]
    fn cached_image_reports_presence() {
        let dir = std::env::temp_dir().join(format!("bw-img-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let value = "https://example.test/banner.png";
        assert!(cached_image(&dir, value).is_none());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(cache_path(&dir, value), b"data").unwrap();
        assert!(cached_image(&dir, value).is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
