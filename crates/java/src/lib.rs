
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
    let _ = parts.next(); 
    let minor: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    match minor {
        v if v >= 21 => 21,
        20 | 19 | 18 => 17,
        17 => 16,
        _ => 8,
    }
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

pub fn probe(java_exe: &Path) -> Option<(Option<u32>, Option<String>)> {
    let out = Command::new(java_exe).arg("-version").output().ok()?;
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
    let prog = if cfg!(windows) { "where" } else { "which" };
    let out = Command::new(prog).arg("java").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout);
    let first = line.lines().next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(PathBuf::from(first))
    }
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
}
