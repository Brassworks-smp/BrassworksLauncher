
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JavaKind {
    System,
    Bundled,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInstall {
    pub path: String,
    pub major: Option<u32>,
    pub version: Option<String>,
    pub kind: JavaKind,
    pub label: String,
}

pub fn major_for_minecraft(mc_version: &str) -> u32 {
    let mut parts = mc_version.split('.');
    let first = parts.next().unwrap_or("1");
    if first != "1" {
        return 21;
    }
    let minor: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    match minor {
        v if v >= 21 => 21,
        20 | 19 | 18 => 17,
        17 => 16,
        _ => 8,
    }
}


pub fn provisionable_major(required: u32) -> u32 {
    match required {
        16 => 17,
        other => other,
    }
}

pub fn ensure_runtime(jvm_dir: &Path, major: u32) -> Result<PathBuf, String> {
    let major = provisionable_major(major);

    if let Some(found) = list_runtimes(jvm_dir)
        .into_iter()
        .find(|r| r.major == Some(major))
    {
        return Ok(PathBuf::from(found.path));
    }

    let (os, ext) = adoptium_os();
    let primary = adoptium_arch().ok_or("unsupported CPU architecture")?;
    let mut archs = vec![primary];
    if primary != "x64" {
        archs.push("x64");
    }

    let dest_dir = jvm_dir.join(format!("temurin-{major}"));
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let client = reqwest::blocking::Client::builder()
        .user_agent("BrassworksLauncher")
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let mut bytes = None;
    let mut last_err = String::new();
    for arch in &archs {
        let url = format!(
            "https://api.adoptium.net/v3/binary/latest/{major}/ga/{os}/{arch}/jre/hotspot/normal/eclipse"
        );
        match client.get(&url).send() {
            Ok(resp) if resp.status().is_success() => match resp.bytes() {
                Ok(b) => {
                    bytes = Some(b);
                    break;
                }
                Err(e) => last_err = e.to_string(),
            },
            Ok(resp) => last_err = format!("Adoptium {url} -> {}", resp.status()),
            Err(e) => last_err = e.to_string(),
        }
    }
    let bytes = bytes.ok_or(last_err)?;

    if ext == "zip" {
        extract_zip(&bytes, &dest_dir)?;
    } else {
        extract_tar_gz(&bytes, &dest_dir)?;
    }

    find_java_exe(&dest_dir).ok_or_else(|| "java executable not found after extraction".to_string())
}

fn adoptium_os() -> (&'static str, &'static str) {
    if cfg!(target_os = "windows") {
        ("windows", "zip")
    } else if cfg!(target_os = "macos") {
        ("mac", "tar.gz")
    } else {
        ("linux", "tar.gz")
    }
}

fn adoptium_arch() -> Option<&'static str> {
    Some(match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        "x86" => "x86",
        _ => return None,
    })
}

fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = file.enclosed_name() else {
            continue;
        };
        let out = dest.join(name);
        if file.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut f).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn extract_tar_gz(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let decoder = flate2::read::GzDecoder::new(std::io::Cursor::new(bytes));
    let mut archive = tar::Archive::new(decoder);
    archive.set_preserve_permissions(true);
    archive.unpack(dest).map_err(|e| e.to_string())
}

pub fn delete_runtime(jvm_dir: &Path, exe_path: &Path) -> Result<(), String> {
    let mut cur = exe_path;
    while let Some(parent) = cur.parent() {
        if parent == jvm_dir {
            return std::fs::remove_dir_all(cur).map_err(|e| e.to_string());
        }
        cur = parent;
    }
    Err("not a managed runtime".to_string())
}

fn exec_name() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

fn parse_version(output: &str) -> (Option<u32>, Option<String>) {
    for line in output.lines() {
        if let Some(start) = line.find('"') {
            if let Some(end) = line[start + 1..].find('"') {
                let raw = &line[start + 1..start + 1 + end];
                let major = parse_major(raw);
                return (major, Some(raw.to_string()));
            }
        }
    }
    (None, None)
}

fn parse_major(raw: &str) -> Option<u32> {
    let raw = raw.trim();
    if let Some(rest) = raw.strip_prefix("1.") {
        rest.split(['.', '_']).next()?.parse().ok()
    } else {
        raw.split(['.', '+', '-', '_']).next()?.parse().ok()
    }
}

fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn probe(java_exe: &Path) -> Option<(Option<u32>, Option<String>)> {
    let mut cmd = Command::new(java_exe);
    cmd.arg("-version");
    let out = no_window(&mut cmd).output().ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    let parsed = parse_version(&text);
    if parsed.0.is_none() && parsed.1.is_none() {
        let text = String::from_utf8_lossy(&out.stdout);
        let p = parse_version(&text);
        if p.0.is_some() || p.1.is_some() {
            return Some(p);
        }
    }
    Some(parsed)
}

pub fn detect_system() -> Option<JavaInstall> {
    let candidate = std::env::var_os("JAVA_HOME")
        .map(|home| PathBuf::from(home).join("bin").join(exec_name()))
        .filter(|p| p.is_file())
        .or_else(which_java)?;
    let (major, version) = probe(&candidate).unwrap_or((None, None));
    Some(JavaInstall {
        label: label_for("System", major),
        path: candidate.to_string_lossy().to_string(),
        major,
        version,
        kind: JavaKind::System,
    })
}

fn which_java() -> Option<PathBuf> {
    let exe = exec_name();
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|candidate| candidate.is_file())
}

pub fn list_runtimes(jvm_dir: &Path) -> Vec<JavaInstall> {
    let mut out = Vec::new();
    let Ok(read) = std::fs::read_dir(jvm_dir) else {
        return out;
    };
    for entry in read.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        if let Some(exe) = find_java_exe(&dir) {
            let (major, version) = probe(&exe).unwrap_or((None, None));
            out.push(JavaInstall {
                label: label_for("Bundled", major),
                path: exe.to_string_lossy().to_string(),
                major,
                version,
                kind: JavaKind::Bundled,
            });
        }
    }
    out.sort_by(|a, b| b.major.cmp(&a.major));
    out
}

fn find_java_exe(root: &Path) -> Option<PathBuf> {
    fn walk(dir: &Path, depth: u32) -> Option<PathBuf> {
        let direct = dir.join("bin").join(exec_name());
        if direct.is_file() {
            return Some(direct);
        }
        if depth == 0 {
            return None;
        }
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Some(found) = walk(&p, depth - 1) {
                    return Some(found);
                }
            }
        }
        None
    }
    walk(root, 4)
}

fn label_for(prefix: &str, major: Option<u32>) -> String {
    match major {
        Some(m) => format!("{prefix} Java {m}"),
        None => format!("{prefix} Java"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn major_mapping() {
        assert_eq!(major_for_minecraft("1.21.1"), 21);
        assert_eq!(major_for_minecraft("1.20.4"), 17);
        assert_eq!(major_for_minecraft("1.16.5"), 8);
    }

    #[test]
    fn version_parsing() {
        assert_eq!(parse_major("21.0.3"), Some(21));
        assert_eq!(parse_major("1.8.0_392"), Some(8));
        assert_eq!(parse_major("17"), Some(17));
    }

    #[test]
    fn java16_substitutes_to_17() {
        // Adoptium has no Temurin 16 JRE; MC 1.17 (Java 16) runs on Java 17.
        assert_eq!(provisionable_major(16), 17);
        assert_eq!(provisionable_major(8), 8);
        assert_eq!(provisionable_major(17), 17);
        assert_eq!(provisionable_major(21), 21);
    }
}

#[cfg(test)]
mod java_more {
    use super::*;

    #[test]
    fn major_for_minecraft_modern() {
        assert_eq!(major_for_minecraft("1.21.4"), 21);
        assert_eq!(major_for_minecraft("1.21"), 21);
        assert_eq!(major_for_minecraft("1.22.0"), 21);
    }

    #[test]
    fn major_for_minecraft_seventeen_era() {
        assert_eq!(major_for_minecraft("1.20.4"), 17);
        assert_eq!(major_for_minecraft("1.19.2"), 17);
        assert_eq!(major_for_minecraft("1.18"), 17);
    }

    #[test]
    fn major_for_minecraft_sixteen_and_eight() {
        assert_eq!(major_for_minecraft("1.17.1"), 16);
        assert_eq!(major_for_minecraft("1.16.5"), 8);
        assert_eq!(major_for_minecraft("1.15.2"), 8);
        assert_eq!(major_for_minecraft("1.8.9"), 8);
        assert_eq!(major_for_minecraft("1.7.10"), 8);
    }

    #[test]
    fn major_for_minecraft_non_one_major() {
        assert_eq!(major_for_minecraft("2.0"), 21);
        assert_eq!(major_for_minecraft("garbage"), 21);
    }

    #[test]
    fn major_for_minecraft_bare_one() {
        assert_eq!(major_for_minecraft("1"), 8);
    }

    #[test]
    fn provisionable_major_passthrough() {
        assert_eq!(provisionable_major(8), 8);
        assert_eq!(provisionable_major(11), 11);
        assert_eq!(provisionable_major(17), 17);
        assert_eq!(provisionable_major(21), 21);
        assert_eq!(provisionable_major(16), 17);
    }

    #[test]
    fn parse_major_modern() {
        assert_eq!(parse_major("21.0.3"), Some(21));
        assert_eq!(parse_major("17.0.10"), Some(17));
        assert_eq!(parse_major("11.0.2+9"), Some(11));
        assert_eq!(parse_major("17"), Some(17));
    }

    #[test]
    fn parse_major_legacy_one_dot() {
        assert_eq!(parse_major("1.8.0_392"), Some(8));
        assert_eq!(parse_major("1.7.0"), Some(7));
    }

    #[test]
    fn parse_major_trimmed() {
        assert_eq!(parse_major("   21.0.1   "), Some(21));
    }

    #[test]
    fn parse_major_rejects_garbage() {
        assert_eq!(parse_major("garbage"), None);
        assert_eq!(parse_major(""), None);
        assert_eq!(parse_major("v17"), None);
    }

    #[test]
    fn parse_version_extracts_quoted() {
        let out = "openjdk version \"17.0.2\" 2022-01-18\nOpenJDK Runtime Environment";
        let (major, version) = parse_version(out);
        assert_eq!(major, Some(17));
        assert_eq!(version.as_deref(), Some("17.0.2"));
    }

    #[test]
    fn parse_version_legacy() {
        let out = "java version \"1.8.0_392\"";
        let (major, version) = parse_version(out);
        assert_eq!(major, Some(8));
        assert_eq!(version.as_deref(), Some("1.8.0_392"));
    }

    #[test]
    fn parse_version_without_quotes() {
        let (major, version) = parse_version("no version line here");
        assert_eq!(major, None);
        assert_eq!(version, None);
    }

    #[test]
    fn label_for_with_and_without_major() {
        assert_eq!(label_for("System", Some(17)), "System Java 17");
        assert_eq!(label_for("Bundled", Some(21)), "Bundled Java 21");
        assert_eq!(label_for("System", None), "System Java");
    }

    #[test]
    fn find_java_exe_direct() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let exe = bin.join(exec_name());
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(find_java_exe(dir.path()), Some(exe));
    }

    #[test]
    fn find_java_exe_nested() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("temurin-21").join("Contents").join("Home").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let exe = bin.join(exec_name());
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(find_java_exe(dir.path()), Some(exe));
    }

    #[test]
    fn find_java_exe_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(find_java_exe(dir.path()), None);
    }

    #[test]
    fn list_runtimes_empty_for_missing_dir() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        assert!(list_runtimes(&missing).is_empty());
    }

    #[test]
    fn list_runtimes_finds_installed() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("temurin-21").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(exec_name()), b"").unwrap();
        let found = list_runtimes(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, JavaKind::Bundled);
        assert!(found[0].path.ends_with(exec_name()));
    }

    #[test]
    fn delete_runtime_removes_managed_dir() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = dir.path().join("temurin-21");
        let bin = runtime.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let exe = bin.join(exec_name());
        std::fs::write(&exe, b"").unwrap();
        delete_runtime(dir.path(), &exe).unwrap();
        assert!(!runtime.exists());
    }

    #[test]
    fn delete_runtime_rejects_outside() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("elsewhere").join("java");
        std::fs::create_dir_all(outside.parent().unwrap()).unwrap();
        std::fs::write(&outside, b"").unwrap();
        let jvm = dir.path().join("jvm");
        std::fs::create_dir_all(&jvm).unwrap();
        assert!(delete_runtime(&jvm, &outside).is_err());
    }

    #[test]
    fn java_kind_equality() {
        assert_eq!(JavaKind::System, JavaKind::System);
        assert_ne!(JavaKind::System, JavaKind::Bundled);
        assert_ne!(JavaKind::Bundled, JavaKind::Custom);
    }

    #[test]
    fn parse_version_picks_first_quoted() {
        let out = "Picked up JAVA_TOOL_OPTIONS\nopenjdk version \"21.0.1\" 2023-10-17";
        let (major, version) = parse_version(out);
        assert_eq!(major, Some(21));
        assert_eq!(version.as_deref(), Some("21.0.1"));
    }

    #[test]
    fn parse_major_handles_plus_build() {
        assert_eq!(parse_major("17.0.9+9"), Some(17));
        assert_eq!(parse_major("21+35"), Some(21));
    }
}
