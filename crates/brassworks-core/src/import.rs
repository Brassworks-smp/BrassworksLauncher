use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ImportCandidate {
    pub source: String, 
    pub key: String,    
    pub name: String,
    pub minecraft: String,
    pub loader: String, 
    pub loader_version: Option<String>,
    pub group: Option<String>, 
    pub icon: Option<String>,  
    pub path: String,          
    pub notes: Option<String>,
    pub pack_provider: Option<String>,
    pub pack_id: Option<String>,
    pub pack_version: Option<String>,
}

pub fn prism_base() -> Option<PathBuf> {
    let dir = dirs::data_dir()?.join("PrismLauncher");
    dir.is_dir().then_some(dir)
}

pub fn modrinth_base() -> Option<PathBuf> {
    let data = dirs::data_dir()?;
    for name in ["ModrinthApp", "com.modrinth.theseus"] {
        let dir = data.join(name);
        if dir.is_dir() {
            return Some(dir);
        }
    }
    None
}

pub fn scan() -> Vec<ImportCandidate> {
    let mut out = Vec::new();
    if let Some(base) = prism_base() {
        out.extend(scan_prism(&base));
    }
    if let Some(base) = modrinth_base() {
        out.extend(scan_modrinth(&base));
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn game_dir_for(c: &ImportCandidate) -> PathBuf {
    let p = PathBuf::from(&c.path);
    if c.source != "prism" {
        return p;
    }
    let dot = p.join(".minecraft");
    if dot.is_dir() {
        return dot;
    }
    let plain = p.join("minecraft");
    if plain.is_dir() {
        return plain;
    }
    dot
}

pub fn prism_mod_items(game_dir: &Path) -> Vec<serde_json::Value> {
    let index = game_dir.join("mods").join(".index");
    let mut items = Vec::new();
    let Ok(entries) = std::fs::read_dir(&index) else {
        return items;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Some(item) = parse_mod_index(&text) {
                items.push(item);
            }
        }
    }
    items
}

fn parse_mod_index(text: &str) -> Option<serde_json::Value> {
    let mut section = String::new();
    let mut filename = None;
    let mut name = None;
    let mut cf_project = None;
    let mut cf_file = None;
    let mut mr_id = None;
    let mut mr_version = None;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            section = line.trim_matches(|c| c == '[' || c == ']').to_string();
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let k = k.trim();
        let v = v.trim().trim_matches(['\'', '"']).trim().to_string();
        match (section.as_str(), k) {
            ("", "filename") => filename = Some(v),
            ("", "name") => name = Some(v),
            ("update.curseforge", "project-id") => cf_project = v.parse::<i64>().ok(),
            ("update.curseforge", "file-id") => cf_file = v.parse::<i64>().ok(),
            ("update.modrinth", "mod-id") => mr_id = Some(v),
            ("update.modrinth", "version") => mr_version = Some(v),
            _ => {}
        }
    }
    let filename = filename?;
    let name = name.unwrap_or_else(|| filename.clone());
    let source = if cf_project.is_some() {
        "curseforge"
    } else if mr_id.is_some() {
        "modrinth"
    } else {
        return None;
    };
    Some(serde_json::json!({
        "name": name,
        "filename": filename,
        "path": format!("mods/{filename}"),
        "category": "mod",
        "source": source,
        "curseforge_id": cf_project,
        "curseforge_file": cf_file,
        "modrinth_id": mr_id,
        "modrinth_version": mr_version,
        "version": serde_json::Value::Null,
    }))
}

pub fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if matches!(
            name.to_string_lossy().as_ref(),
            "logs" | "crash-reports" | ".DS_Store"
        ) {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if from.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

pub fn icon_data_uri(path: &str) -> Option<String> {
    let p = Path::new(path);
    let bytes = std::fs::read(p).ok()?;
        if bytes.is_empty() || bytes.len() > 300_000 {
        return None;
    }
    let mime = match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/png",
    };
    Some(format!("data:{mime};base64,{}", base64_encode(&bytes)))
}

fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}


fn scan_prism(base: &Path) -> Vec<ImportCandidate> {
    let instances_dir = base.join("instances");
    let groups = prism_groups(&instances_dir);
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&instances_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        let cfg = dir.join("instance.cfg");
        let mmc = dir.join("mmc-pack.json");
        if !cfg.is_file() || !mmc.is_file() {
            continue;
        }
        let key = entry.file_name().to_string_lossy().to_string();
        let general = parse_ini_section(&std::fs::read_to_string(&cfg).unwrap_or_default());
        let name = general
            .iter()
            .find(|(k, _)| k == "name")
            .map(|(_, v)| v.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| key.clone());
        let notes = general
            .iter()
            .find(|(k, _)| k == "notes")
            .map(|(_, v)| v.clone())
            .filter(|s| !s.is_empty());
        let icon_key = general
            .iter()
            .find(|(k, _)| k == "iconKey")
            .map(|(_, v)| v.clone());
        let icon = icon_key
            .and_then(|k| resolve_prism_icon(base, &dir, &k))
            .and_then(|p| icon_data_uri(&p));

        let (minecraft, loader, loader_version) =
            parse_mmc_pack(&std::fs::read_to_string(&mmc).unwrap_or_default());

        let (pack_provider, pack_id, pack_version) = prism_managed_pack(&general);

        out.push(ImportCandidate {
            source: "prism".into(),
            key: key.clone(),
            name,
            minecraft,
            loader,
            loader_version,
            group: groups.get(&key).cloned(),
            icon,
            path: dir.to_string_lossy().to_string(),
            notes,
            pack_provider,
            pack_id,
            pack_version,
        });
    }
    out
}

fn prism_groups(instances_dir: &Path) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let text = match std::fs::read_to_string(instances_dir.join("instgroups.json")) {
        Ok(t) => t,
        Err(_) => return map,
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return map;
    };
    if let Some(groups) = json.get("groups").and_then(|g| g.as_object()) {
        for (name, body) in groups {
            if let Some(arr) = body.get("instances").and_then(|i| i.as_array()) {
                for inst in arr.iter().filter_map(|v| v.as_str()) {
                    map.insert(inst.to_string(), name.clone());
                }
            }
        }
    }
    map
}

fn prism_managed_pack(
    general: &[(String, String)],
) -> (Option<String>, Option<String>, Option<String>) {
    let get = |key: &str| {
        general
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .filter(|s| !s.is_empty())
    };
    let managed = general
        .iter()
        .any(|(k, v)| k == "ManagedPack" && v == "true");
    if !managed {
        return (None, None, None);
    }
    let provider = match get("ManagedPackType").as_deref() {
        Some("flame") => "curseforge",
        Some("modrinth") => "modrinth",
        _ => return (None, None, None),
    };
    match (get("ManagedPackID"), get("ManagedPackVersionID")) {
        (Some(id), Some(ver)) => (Some(provider.to_string()), Some(id), Some(ver)),
        _ => (None, None, None),
    }
}

fn resolve_prism_icon(base: &Path, instance_dir: &Path, key: &str) -> Option<String> {
        if key.is_empty() || key == "default" {
        return None;
    }
    let exts = ["png", "jpg", "jpeg", "webp"];
    for dir in [base.join("icons"), instance_dir.to_path_buf()] {
        for ext in exts {
            let p = dir.join(format!("{key}.{ext}"));
            if p.is_file() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn parse_mmc_pack(text: &str) -> (String, String, Option<String>) {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else {
        return ("1.21.1".into(), "vanilla".into(), None);
    };
    let components = json
        .get("components")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();
    let find = |uid: &str| {
        components
            .iter()
            .find(|c| c.get("uid").and_then(|u| u.as_str()) == Some(uid))
            .and_then(|c| c.get("version").and_then(|v| v.as_str()))
            .map(String::from)
    };
    let minecraft = find("net.minecraft").unwrap_or_else(|| "1.21.1".into());
    let (loader, version) = if let Some(v) = find("net.neoforged") {
        ("neoforge", Some(v))
    } else if let Some(v) = find("net.minecraftforge") {
        ("forge", Some(v))
    } else if let Some(v) = find("net.fabricmc.fabric-loader") {
        ("fabric", Some(v))
    } else if let Some(v) = find("org.quiltmc.quilt-loader") {
        ("quilt", Some(v))
    } else {
        ("vanilla", None)
    };
    (minecraft, loader.to_string(), version)
}

fn parse_ini_section(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut in_general = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_general = line.eq_ignore_ascii_case("[General]");
            continue;
        }
        if !in_general {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            out.push((k.trim().to_string(), v.trim().trim_matches('"').to_string()));
        }
    }
    out
}


fn scan_modrinth(base: &Path) -> Vec<ImportCandidate> {
    let db = base.join("app.db");
    if !db.is_file() {
        return Vec::new();
    }
    let conn = match rusqlite::Connection::open_with_flags(
        &db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
                let mut stmt = match conn.prepare(
        "SELECT path, name, icon_path, game_version, mod_loader, mod_loader_version, json(groups), \
                linked_project_id, linked_version_id FROM profiles",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,                     row.get::<_, String>(1)?,                     row.get::<_, Option<String>>(2)?,             row.get::<_, String>(3)?,                     row.get::<_, String>(4)?,                     row.get::<_, Option<String>>(5)?,             row.get::<_, Option<String>>(6)?,             row.get::<_, Option<String>>(7)?,             row.get::<_, Option<String>>(8)?,         ))
    });
    let Ok(rows) = rows else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for row in rows.flatten() {
        let (
            path,
            name,
            icon_path,
            game_version,
            mod_loader,
            mod_loader_version,
            groups,
            linked_project_id,
            linked_version_id,
        ) = row;
                        let (pack_provider, pack_id, pack_version) = match (
            linked_project_id.filter(|s| !s.is_empty()),
            linked_version_id.filter(|s| !s.is_empty()),
        ) {
            (Some(pid), Some(vid)) => (Some("modrinth".to_string()), Some(pid), Some(vid)),
            _ => (None, None, None),
        };
        let group = groups
            .as_deref()
            .and_then(|g| serde_json::from_str::<Vec<String>>(g).ok())
            .and_then(|v| v.into_iter().next())
            .filter(|s| !s.is_empty());
        let icon = icon_path
            .filter(|p| !p.is_empty())
            .and_then(|p| resolve_modrinth_icon(base, &path, &p))
            .and_then(|p| icon_data_uri(&p));
        out.push(ImportCandidate {
            source: "modrinth".into(),
            key: path.clone(),
            name,
            minecraft: game_version,
            loader: mod_loader.to_lowercase(),
            loader_version: mod_loader_version.filter(|s| !s.is_empty()),
            group,
            icon,
            path: base.join("profiles").join(&path).to_string_lossy().to_string(),
            notes: None,
            pack_provider,
            pack_id,
            pack_version,
        });
    }
    out
}

fn resolve_modrinth_icon(base: &Path, profile_path: &str, icon_path: &str) -> Option<String> {
    let raw = Path::new(icon_path);
    if raw.is_absolute() {
        return raw.is_file().then(|| icon_path.to_string());
    }
    for candidate in [
        base.join(icon_path),
        base.join("profiles").join(profile_path).join(icon_path),
    ] {
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

pub fn modrinth_mod_items(c: &ImportCandidate) -> Vec<serde_json::Value> {
            let Some(base) = Path::new(&c.path).parent().and_then(|p| p.parent()) else {
        return Vec::new();
    };
    let db = base.join("app.db");
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        &db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) else {
        return Vec::new();
    };

    let titles = modrinth_project_titles(&conn);

    let mut stmt = match conn.prepare(
        "SELECT json_extract(fh.data, '$.path'), \
                json_extract(f.data, '$.project_id'), \
                json_extract(f.data, '$.version_id') \
         FROM cache fh \
         JOIN cache f ON f.data_type = 'file' \
                     AND f.id = json_extract(fh.data, '$.hash') \
         WHERE fh.data_type = 'file_hash'",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,             row.get::<_, Option<String>>(1)?,             row.get::<_, Option<String>>(2)?,         ))
    });
    let Ok(rows) = rows else {
        return Vec::new();
    };

    let prefix = format!("{}/", c.key);
    let mut items = Vec::new();
    for (path, project_id, version_id) in rows.flatten() {
        let (Some(path), Some(project_id)) = (path, project_id) else {
            continue;
        };
        if project_id.is_empty() {
            continue;
        }
        let Some(rel) = path.strip_prefix(&prefix) else {
            continue;
        };
        let folder = rel.split('/').next().unwrap_or("");
        if !matches!(folder, "mods" | "resourcepacks" | "shaderpacks") {
            continue;
        }
        let filename = rel.rsplit('/').next().unwrap_or(rel).to_string();
        let name = titles
            .get(&project_id)
            .cloned()
            .unwrap_or_else(|| filename.clone());
        items.push(serde_json::json!({
            "name": name,
            "filename": filename,
            "path": rel,
            "category": folder,
            "source": "modrinth",
            "curseforge_id": serde_json::Value::Null,
            "curseforge_file": serde_json::Value::Null,
            "modrinth_id": project_id,
            "modrinth_version": version_id.filter(|s| !s.is_empty()),
            "version": serde_json::Value::Null,
        }));
    }
    items
}

fn modrinth_project_titles(
    conn: &rusqlite::Connection,
) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let Ok(mut stmt) = conn
        .prepare("SELECT id, json_extract(data, '$.title') FROM cache WHERE data_type = 'project'")
    else {
        return map;
    };
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    });
    if let Ok(rows) = rows {
        for (id, title) in rows.flatten() {
            if let Some(title) = title.filter(|s| !s.is_empty()) {
                map.insert(id, title);
            }
        }
    }
    map
}
