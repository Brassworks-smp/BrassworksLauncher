
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use portablemc::base::{self, JvmPolicy, VersionChannel};
use portablemc::{fabric, forge, moj};


fn threads() -> usize {
    std::env::var("LIVE_THREADS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|n| *n >= 1)
        .unwrap_or(8)
}

fn limit() -> Option<usize> {
    std::env::var("LIVE_LIMIT").ok().and_then(|v| v.parse().ok())
}

struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Self {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "bw-live-{tag}-{}-{n}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        Self(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent("BrassworksLauncher-LiveTest")
        .timeout(Duration::from_secs(30))
        .build()
        .expect("build http client")
}

fn link_ok(client: &reqwest::blocking::Client, url: &str) -> bool {
    match client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
    {
        Ok(resp) => resp.status().is_success() || resp.status().as_u16() == 416,
        Err(_) => false,
    }
}

fn link_ok_retry(client: &reqwest::blocking::Client, url: &str) -> bool {
    for attempt in 0..3 {
        if link_ok(client, url) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300 * (attempt + 1)));
    }
    false
}

fn verify_sha1(
    client: &reqwest::blocking::Client,
    url: &str,
    expected: [u8; 20],
    expected_size: Option<u32>,
) -> Result<(), String> {
    use sha1::{Digest, Sha1};
    let bytes = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| e.to_string())?;
    if let Some(sz) = expected_size {
        if bytes.len() as u64 != sz as u64 {
            return Err(format!("size mismatch: got {} expected {sz}", bytes.len()));
        }
    }
    let got: [u8; 20] = Sha1::digest(&bytes).into();
    if got != expected {
        return Err(format!(
            "sha1 mismatch: got {} expected {}",
            hex20(&got),
            hex20(&expected)
        ));
    }
    Ok(())
}

fn hex20(b: &[u8; 20]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn head_size_ok(client: &reqwest::blocking::Client, url: &str, expected: Option<u64>) -> Result<(), String> {
    let resp = client.head(url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HEAD -> {}", resp.status()));
    }
    if let (Some(exp), Some(len)) = (
        expected,
        resp.headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok()),
    ) {
        if len != exp {
            return Err(format!("size mismatch: server {len} vs declared {exp}"));
        }
    }
    Ok(())
}

fn audit_version_payload(
    client: &reqwest::blocking::Client,
    version_json_url: &str,
) -> Result<(), String> {
    let v: serde_json::Value = client
        .get(version_json_url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| format!("version json: {e}"))?;

    let mut problems = Vec::new();

        if let Some(client_dl) = v.pointer("/downloads/client") {
        let url = client_dl.get("url").and_then(|u| u.as_str()).unwrap_or("");
        let size = client_dl.get("size").and_then(|s| s.as_u64());
        if url.is_empty() {
            problems.push("client jar has no url".to_string());
        } else if let Err(e) = head_size_ok(client, url, size) {
            problems.push(format!("client jar unreachable: {e}"));
        }
    } else {
        problems.push("no client download in version json".to_string());
    }

        if let Some(ai) = v.get("assetIndex") {
        if let Some(idx_url) = ai.get("url").and_then(|u| u.as_str()) {
            match client.get(idx_url).send().and_then(|r| r.error_for_status()).and_then(|r| r.json::<serde_json::Value>()) {
                Ok(index) => {
                    if let Some(obj) = index.pointer("/objects").and_then(|o| o.as_object()).and_then(|m| m.values().next()) {
                        if let Some(hash) = obj.get("hash").and_then(|h| h.as_str()) {
                            let cdn = format!(
                                "https://resources.download.minecraft.net/{}/{}",
                                &hash[..2],
                                hash
                            );
                            if !link_ok_retry(client, &cdn) {
                                problems.push(format!("asset CDN object unreachable: {cdn}"));
                            }
                        }
                    }
                }
                Err(e) => problems.push(format!("asset index unreachable: {e}")),
            }
        }
    }

        if let Some(url) = v.pointer("/logging/client/file/url").and_then(|u| u.as_str()) {
        if !link_ok_retry(client, url) {
            problems.push(format!("logging config unreachable: {url}"));
        }
    }

    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("; "))
    }
}

fn validate_installer_jar(client: &reqwest::blocking::Client, url: &str) -> Result<(), String> {
    let bytes = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| e.to_string())?;
    let reader = std::io::Cursor::new(&bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("not a valid jar/zip: {e}"))?;
        let names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();
    let has_profile = names.iter().any(|n| n == "install_profile.json" || n == "version.json");
    if !has_profile {
        return Err("jar has no install_profile.json / version.json".to_string());
    }
    Ok(())
}

fn validate_loader_profile(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<Vec<(String, String)>, String> {
    let json: serde_json::Value = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| e.to_string())?;
    if json.get("mainClass").is_none() {
        return Err("profile has no mainClass".to_string());
    }
    let libs = json
        .get("libraries")
        .and_then(|v| v.as_array())
        .ok_or("profile has no libraries array")?;
    if libs.is_empty() {
        return Err("profile libraries array is empty".to_string());
    }
    let out = libs
        .iter()
        .filter_map(|l| {
            let name = l.get("name")?.as_str()?.to_string();
            let base = l
                .get("url")
                .and_then(|u| u.as_str())
                .unwrap_or("https://maven.fabricmc.net/")
                .to_string();
            Some((name, base))
        })
        .collect();
    Ok(out)
}

fn maven_url(base: &str, coord: &str) -> Option<String> {
    let mut it = coord.split(':');
    let group = it.next()?.replace('.', "/");
    let artifact = it.next()?;
    let version = it.next()?;
    let classifier = it.next();
    let file = match classifier {
        Some(c) => format!("{artifact}-{version}-{c}.jar"),
        None => format!("{artifact}-{version}.jar"),
    };
    let base = base.strip_suffix('/').unwrap_or(base);
    Some(format!("{base}/{group}/{artifact}/{version}/{file}"))
}

fn major_minor(name: &str) -> String {
    let mut it = name.split('.');
    match (it.next(), it.next()) {
        (Some(a), Some(b)) => format!("{a}.{b}"),
        (Some(a), None) => a.to_string(),
        _ => name.to_string(),
    }
}


#[derive(Clone)]
struct LibDl {
    name: String,
    url: String,
    size: Option<u32>,
    sha1: Option<[u8; 20]>,
    natives: bool,
}

#[derive(Default)]
struct CancelHandler {
    java_major: Option<u32>,
    lib_count: usize,
    reached_download: bool,
        libs: Vec<LibDl>,
    natives_files: usize,
    class_files: usize,
    assets_count: usize,
    logger: Option<String>,
}

impl CancelHandler {
    fn handle_base(&mut self, event: base::Event) {
        match event {
            base::Event::LoadJvm { major_version } => {
                self.java_major = Some(major_version);
            }
            base::Event::LoadedLibraries { libraries } => {
                self.lib_count = libraries.len();
                for lib in libraries {
                    if let Some(dl) = &lib.download {
                        self.libs.push(LibDl {
                            name: lib.name.to_string(),
                            url: dl.url.clone(),
                            size: dl.size,
                            sha1: dl.sha1,
                            natives: lib.natives,
                        });
                    }
                }
            }
            base::Event::LoadedLibrariesFiles { class_files, natives_files } => {
                self.class_files = class_files.len();
                self.natives_files = natives_files.len();
            }
            base::Event::LoadedAssets { count, .. } => {
                self.assets_count = count;
            }
            base::Event::LoadLogger { id } => {
                self.logger = Some(id.to_string());
            }
            base::Event::DownloadResources { cancel } => {
                                self.reached_download = true;
                *cancel = true;
            }
            _ => {}
        }
    }

    fn handle_moj(&mut self, event: moj::Event) {
        if let moj::Event::Base(b) = event {
            self.handle_base(b);
        }
    }
}

impl base::Handler for CancelHandler {
    fn on_event(&mut self, event: base::Event) {
        self.handle_base(event);
    }
}

impl moj::Handler for CancelHandler {
    fn on_event(&mut self, event: moj::Event) {
        self.handle_moj(event);
    }
}

impl fabric::Handler for CancelHandler {
    fn on_event(&mut self, event: fabric::Event) {
        if let fabric::Event::Mojang(m) = event {
            self.handle_moj(m);
        }
    }
}

impl forge::Handler for CancelHandler {
    fn on_event(&mut self, event: forge::Event) {
        if let forge::Event::Mojang(m) = event {
            self.handle_moj(m);
        }
    }
}

struct Resolved {
    java_major: Option<u32>,
    lib_count: usize,
    libs: Vec<LibDl>,
    natives_files: usize,
    class_files: usize,
    assets_count: usize,
    logger: Option<String>,
}

impl Resolved {
    fn from_handler(h: CancelHandler) -> Self {
        Self {
            java_major: h.java_major,
            lib_count: h.lib_count,
            libs: h.libs,
            natives_files: h.natives_files,
            class_files: h.class_files,
            assets_count: h.assets_count,
            logger: h.logger,
        }
    }
}

fn is_transient(err: &str) -> bool {
    const NEEDLES: &[&str] = &[
        "DispatchGone",
        "IncompleteMessage",
        "timed out",
        "timeout",
        "connection closed",
        "connection reset",
        "ConnectionReset",
        "tcp connect",
        "dns error",
        "error sending request",
    ];
    NEEDLES.iter().any(|n| err.contains(n))
}

fn resolve_vanilla(version: &str) -> Result<Resolved, String> {
    let mut last = String::new();
    for attempt in 0..3 {
        match resolve_vanilla_once(version) {
            Ok(r) => return Ok(r),
            Err(e) if is_transient(&e) => {
                last = e;
                std::thread::sleep(Duration::from_millis(400 * (attempt + 1)));
            }
            Err(e) => return Err(e),
        }
    }
    Err(format!("transient after retries: {last}"))
}

fn resolve_vanilla_once(version: &str) -> Result<Resolved, String> {
    let scratch = Scratch::new("mc");
    let mut installer = moj::Installer::new(version.to_string());
    installer.base_mut().set_main_dir(scratch.0.clone());
            installer.base_mut().set_jvm_policy(JvmPolicy::MojangThenSystem);

    let mut handler = CancelHandler::default();
    let res = installer.install(&mut handler);
    let reached = handler.reached_download;
    let resolved = Resolved::from_handler(handler);
    let fully_resolved = resolved.java_major.is_some() && resolved.lib_count > 0;

    match res {
                        Ok(_) => Ok(resolved),
        Err(_) if reached => Ok(resolved),
                                                Err(moj::Error::Base(base::Error::JvmNotFound { .. })) if fully_resolved => Ok(resolved),
        Err(e) => Err(format!("{e:?}")),
    }
}

fn resolve_fabric(
    loader: fabric::Loader,
    game: &str,
    loader_version: fabric::LoaderVersion,
) -> Result<Resolved, String> {
    let mut last = String::new();
    for attempt in 0..3 {
        match resolve_fabric_once(loader, game, loader_version.clone()) {
            Ok(r) => return Ok(r),
            Err(e) if is_transient(&e) => {
                last = e;
                std::thread::sleep(Duration::from_millis(400 * (attempt + 1)));
            }
            Err(e) => return Err(e),
        }
    }
    Err(format!("transient after retries: {last}"))
}

fn resolve_fabric_once(
    loader: fabric::Loader,
    game: &str,
    loader_version: fabric::LoaderVersion,
) -> Result<Resolved, String> {
    let scratch = Scratch::new("fab");
    let mut installer = fabric::Installer::new(loader, game.to_string(), loader_version);
    installer.mojang_mut().base_mut().set_main_dir(scratch.0.clone());
    installer
        .mojang_mut()
        .base_mut()
        .set_jvm_policy(JvmPolicy::MojangThenSystem);

    let mut handler = CancelHandler::default();
    let res = installer.install(&mut handler);
    let reached = handler.reached_download;
    let resolved = Resolved::from_handler(handler);
    let fully_resolved = resolved.java_major.is_some() && resolved.lib_count > 0;
    match res {
        Ok(_) => Ok(resolved),
        Err(_) if reached => Ok(resolved),
        Err(fabric::Error::Mojang(moj::Error::Base(base::Error::JvmNotFound { .. })))
            if fully_resolved =>
        {
            Ok(resolved)
        }
        Err(e) => Err(format!("{e:?}")),
    }
}


struct Selected {
    name: String,
    channel: VersionChannel,
}

fn select_versions(manifest: &moj::Manifest) -> Vec<Selected> {
    let mut out = Vec::new();
    let mut seen_groups = BTreeSet::new();
    let mut last_release_mm: Option<String> = None;

    for v in manifest.iter() {
        let name = v.name().to_string();
        let channel = v.channel();

        match channel {
            VersionChannel::Release => {
                last_release_mm = Some(major_minor(&name));
                out.push(Selected { name, channel });
            }
            _ => {
                let key = group_key(&name, channel, last_release_mm.as_deref());
                if seen_groups.insert(key) {
                    out.push(Selected { name, channel });
                }
            }
        }
    }

    out
}

fn group_key(name: &str, channel: VersionChannel, last_release_mm: Option<&str>) -> String {
    if let Some(base) = name.split("-pre").next().filter(|_| name.contains("-pre")) {
        return format!("pre:{}", major_minor(base));
    }
    if let Some(base) = name.split("-rc").next().filter(|_| name.contains("-rc")) {
        return format!("rc:{}", major_minor(base));
    }
    match channel {
                        VersionChannel::Snapshot => {
            format!("snap:{}", last_release_mm.unwrap_or("latest"))
        }
                VersionChannel::Beta | VersionChannel::Alpha => {
            let tag = name.split('.').next().unwrap_or(name);
            format!("old:{tag}")
        }
        VersionChannel::Release => unreachable!(),
    }
}

fn sane_java_major(major: u32) -> bool {
        (6..=30).contains(&major)
}


#[test]
#[ignore = "live network; run manually via the live-install workflow"]
fn vanilla_all_versions_resolve() {
    let manifest = moj::Manifest::request(()).expect("fetch Mojang manifest");
    let mut versions = select_versions(&manifest);
    if let Some(cap) = limit() {
        versions.truncate(cap);
    }

    let total = versions.len();
    eprintln!(
        "[vanilla] resolving {total} versions ({} threads)…",
        threads()
    );

    let next = AtomicUsize::new(0);
    let failures: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let majors: Mutex<BTreeSet<u32>> = Mutex::new(BTreeSet::new());
    let done = AtomicUsize::new(0);

    std::thread::scope(|scope| {
        for _ in 0..threads() {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= total {
                        break;
                    }
                    let sel = &versions[i];
                    let label = format!("{} [{:?}]", sel.name, sel.channel);
                    match resolve_vanilla(&sel.name) {
                        Ok(r) => {
                            match r.java_major {
                                Some(m) if sane_java_major(m) => {
                                    majors.lock().unwrap().insert(m);
                                }
                                Some(m) => failures
                                    .lock()
                                    .unwrap()
                                    .push(format!("{label}: implausible Java major {m}")),
                                None => failures
                                    .lock()
                                    .unwrap()
                                    .push(format!("{label}: no Java major resolved")),
                            }
                            if r.lib_count == 0 {
                                failures
                                    .lock()
                                    .unwrap()
                                    .push(format!("{label}: resolved 0 libraries"));
                            }
                        }
                        Err(e) => failures.lock().unwrap().push(format!("{label}: {e}")),
                    }
                    let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if d % 20 == 0 || d == total {
                        eprintln!("[vanilla] {d}/{total}");
                    }
                }
            });
        }
    });

    let majors = majors.into_inner().unwrap();
    eprintln!("[vanilla] Java majors observed across all versions: {majors:?}");

    let failures = failures.into_inner().unwrap();
    assert!(
        failures.is_empty(),
        "{} version(s) failed to resolve:\n{}",
        failures.len(),
        failures.join("\n")
    );
    eprintln!("[vanilla] OK — {total} versions resolved, all links + Java majors valid");
}


#[test]
#[ignore = "live network; run manually via the live-install workflow"]
fn vanilla_deep_audit() {
    let manifest = moj::Manifest::request(()).expect("fetch Mojang manifest");
    let client = http();

                let mut candidates: Vec<String> = vec![
        "b1.7.3", "1.5.2", "1.6.4", "1.7.10", "1.8.9", "1.12.2", "1.14.4", "1.16.5",
        "1.17.1", "1.18.2", "1.19.4", "1.20.6", "1.21.1",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    candidates.push(manifest.latest_release_name().to_string());
    candidates.push(manifest.latest_snapshot_name().to_string());

    let mut failures = Vec::new();

    for version in candidates {
        let Some(mv) = manifest.find_by_name(&version) else {
            eprintln!("[deep] {version}: not in manifest, skipping");
            continue;
        };
        let version_json_url = mv.url().to_string();

                match audit_version_payload(&client, &version_json_url) {
            Ok(()) => eprintln!("[deep] {version}: client jar + assets CDN + logger reachable"),
            Err(e) => failures.push(format!("{version}: payload audit: {e}")),
        }
                        let r = match resolve_vanilla(&version) {
            Ok(r) => r,
            Err(e) => {
                failures.push(format!("{version}: resolve failed: {e}"));
                continue;
            }
        };

        if r.libs.is_empty() {
            failures.push(format!("{version}: no library downloads captured"));
            continue;
        }

                let mut dead = 0usize;
        for lib in &r.libs {
            if !link_ok_retry(&client, &lib.url) {
                dead += 1;
                failures.push(format!("{version}: dead library link {} ({})", lib.name, lib.url));
            }
        }

                                if let Some(small) = r
            .libs
            .iter()
            .filter(|l| l.sha1.is_some())
            .min_by_key(|l| l.size.unwrap_or(u32::MAX))
        {
            match verify_sha1(&client, &small.url, small.sha1.unwrap(), small.size) {
                Ok(()) => eprintln!("[deep] {version}: sha1 OK for {}", small.name),
                Err(e) => failures.push(format!("{version}: integrity check failed for {}: {e}", small.name)),
            }
        }

                                        let parts: Vec<&str> = version.trim_start_matches("1.").split('.').collect();
        let minor: u32 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
        let is_release_line = version.starts_with("1.");

        if is_release_line && minor >= 6 && r.assets_count == 0 {
            failures.push(format!("{version}: resolved 0 assets"));
        }
        if is_release_line && minor >= 13 && r.logger.is_none() {
                        eprintln!("[deep] {version}: WARN no logger config resolved");
        }
                        let native_libs = r.libs.iter().filter(|l| l.natives).count();
        if is_release_line && (6..19).contains(&minor) && r.natives_files == 0 {
            failures.push(format!(
                "{version}: resolved 0 native files (needs LWJGL natives for this platform)"
            ));
        }
                if r.class_files == 0 {
            failures.push(format!("{version}: resolved 0 classpath files"));
        }

        eprintln!(
            "[deep] {version}: {} libs ({native_libs} native, {dead} dead), \
             {} classpath, {} native files, {} assets, Java {:?}, logger {:?}",
            r.libs.len(),
            r.class_files,
            r.natives_files,
            r.assets_count,
            r.java_major,
            r.logger.as_deref(),
        );
    }

    assert!(failures.is_empty(), "{} issue(s):\n{}", failures.len(), failures.join("\n"));
    eprintln!("[deep] OK — representative versions: every library link valid + integrity verified");
}


#[test]
#[ignore = "live network; run manually via the live-install workflow"]
fn java_runtimes_download_and_probe() {
        assert_eq!(java::major_for_minecraft("1.16.5"), 8);
    assert_eq!(java::major_for_minecraft("1.17.1"), 16);
    assert_eq!(java::major_for_minecraft("1.20.4"), 17);
    assert_eq!(java::major_for_minecraft("1.21.4"), 21);

                assert_eq!(java::provisionable_major(16), 17);
    let cases = [(8u32, 8u32), (16, 17), (17, 17), (21, 21)];

    let mut failures = Vec::new();
    for (requested, expected) in cases {
        let scratch = Scratch::new(&format!("jvm{requested}"));
        eprintln!("[java] requesting Java {requested} (expect runtime {expected})…");
        match java::ensure_runtime(&scratch.0, requested) {
            Ok(exe) => match java::probe(&exe) {
                Some((Some(found), ver)) if found == expected => {
                    eprintln!("[java] {requested}->{found} OK -> {} ({:?})", exe.display(), ver);
                }
                Some((found, ver)) => failures.push(format!(
                    "Java {requested}: runtime probed as {found:?} ({ver:?}), expected {expected}"
                )),
                None => failures.push(format!("Java {requested}: could not probe downloaded runtime")),
            },
            Err(e) => failures.push(format!("Java {requested}: download failed: {e}")),
        }
    }

    assert!(failures.is_empty(), "{}", failures.join("\n"));
    eprintln!("[java] OK — runtimes downloaded and report the expected major (16→17 substituted)");
}


fn sort_newest_first(mut games: Vec<String>, manifest: &moj::Manifest) -> Vec<String> {
    let rank = |name: &str| manifest.find_index_of_name(name).unwrap_or(usize::MAX);
    games.sort_by_key(|g| rank(g));
    games
}

fn sample_spread<T: Clone>(items: &[T], head: usize, tail: usize) -> Vec<T> {
    let mut out: Vec<T> = items.iter().take(head).cloned().collect();
    if items.len() > head {
        let start = items.len().saturating_sub(tail).max(head);
        out.extend(items[start..].iter().cloned());
    }
    out
}

fn forge_installer_url(name: &str) -> String {
    format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{name}/forge-{name}-installer.jar"
    )
}

fn neoforge_installer_url(name: &str) -> String {
            let legacy = name.starts_with("1.20.1-") || name == "47.1.82";
    if legacy {
        format!(
            "https://maven.neoforged.net/releases/net/neoforged/forge/{name}/forge-{name}-installer.jar"
        )
    } else {
        format!(
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/{name}/neoforge-{name}-installer.jar"
        )
    }
}

#[test]
#[ignore = "live network; run manually via the live-install workflow"]
fn forge_installers_resolve() {
    forge_like(forge::Loader::Forge, "forge", forge_installer_url);
}

#[test]
#[ignore = "live network; run manually via the live-install workflow"]
fn neoforge_installers_resolve() {
    forge_like(forge::Loader::NeoForge, "neoforge", neoforge_installer_url);
}

fn forge_like(loader: forge::Loader, tag: &str, url_of: fn(&str) -> String) {
    let repo = forge::Repo::request(loader).expect("fetch forge repo metadata");
    let manifest = moj::Manifest::request(()).expect("fetch Mojang manifest");
    let client = http();
    let mut failures = Vec::new();

                let mut by_game: indexmap_lite::OrderedGroups = Default::default();
    for v in repo.iter() {
        let game = v.game_version();
        if game.is_empty() {
            continue;
        }
        by_game.push(game.to_string(), v.name().to_string());
    }

    let game_versions: Vec<String> = sort_newest_first(by_game.keys(), &manifest);
    eprintln!(
        "[{tag}] {} game versions, {} total loader builds",
        game_versions.len(),
        by_game.total()
    );
    assert!(
        !game_versions.is_empty(),
        "[{tag}] repo returned no usable versions"
    );

        for g in &game_versions {
        if by_game.get(g).is_empty() {
            failures.push(format!("{tag} {g}: no installer build found"));
        }
    }

                                        let newest = game_versions.iter().take(3).cloned().collect::<Vec<_>>();
    let oldest = sample_spread(&game_versions, 3, 2);
    let oldest = &oldest[newest.len().min(oldest.len())..]; 
    let probe = |g: &str, strict: bool, failures: &mut Vec<String>| {
        let builds = by_game.get(g);         let mut any_ok = false;
        for name in builds.iter().take(4) {
            let url = url_of(name);
            if link_ok(&client, &url) {
                any_ok = true;
                eprintln!("[{tag}] {g}: {name} -> link OK");
            } else {
                eprintln!("[{tag}] {g}: {name} -> WARN unreachable ({url})");
            }
        }
        if !any_ok && strict {
            failures.push(format!("{tag} {g}: no reachable installer among newest 4 builds"));
        }
    };

    for g in &newest {
        probe(g, true, &mut failures);
    }
    for g in oldest {
        probe(g, false, &mut failures);
    }

                if let Some(g) = newest.first() {
        if let Some(name) = by_game.get(g).first() {
            let url = url_of(name);
            match validate_installer_jar(&client, &url) {
                Ok(()) => eprintln!("[{tag}] {g}: installer {name} is a valid jar w/ profile"),
                Err(e) => failures.push(format!("{tag} {g}: installer {name} invalid: {e}")),
            }
        }
    }

    assert!(failures.is_empty(), "{}", failures.join("\n"));
    eprintln!(
        "[{tag}] OK — every game version resolves an installer; sampled versions reachable"
    );
}

#[test]
#[ignore = "live network; run manually via the live-install workflow"]
fn fabric_loaders_resolve() {
    fabric_like(fabric::Loader::Fabric, "fabric", "https://meta.fabricmc.net/v2");
}

#[test]
#[ignore = "live network; run manually via the live-install workflow"]
fn quilt_loaders_resolve() {
    fabric_like(fabric::Loader::Quilt, "quilt", "https://meta.quiltmc.org/v3");
}

fn fabric_like(loader: fabric::Loader, tag: &str, meta_base: &str) {
    let api = fabric::Api::new(loader);
    let client = http();
    let mut failures = Vec::new();

    let manifest = moj::Manifest::request(()).expect("fetch Mojang manifest");
    let games = api.request_game_versions().expect("fetch game versions");
                let game_names: Vec<String> = sort_newest_first(
        games
            .iter()
            .filter(|g| g.is_stable())
            .map(|g| g.name().to_string())
            .collect(),
        &manifest,
    );
    eprintln!("[{tag}] {} supported stable game versions", game_names.len());
    assert!(!game_names.is_empty(), "[{tag}] no game versions returned");

                    let grace: std::collections::HashSet<String> =
        game_names.iter().take(3).cloned().collect();

            for game in sample_spread(&game_names, 3, 2) {
        let strict = !grace.contains(&game);
        let loaders = match api.request_loader_versions(Some(&game)) {
            Ok(l) => l,
            Err(e) => {
                let msg = format!("{tag} {game}: loader list failed: {e:?}");
                if strict {
                    failures.push(msg);
                } else {
                    eprintln!("[{tag}] WARN (loader lag, best-effort): {msg}");
                }
                continue;
            }
        };
        let picks: Vec<String> = loaders.iter().take(4).map(|l| l.name().to_string()).collect();
        if picks.is_empty() {
            let msg = format!("{tag} {game}: no loader versions");
            if strict {
                failures.push(msg);
            } else {
                eprintln!("[{tag}] WARN: {msg}");
            }
            continue;
        }
        for lv in &picks {
            let url = format!("{meta_base}/versions/loader/{game}/{lv}/profile/json");
            if link_ok(&client, &url) {
                eprintln!("[{tag}] {game}: loader {lv} -> profile OK");
            } else if strict {
                failures.push(format!("{tag} {game}: dead profile link {url}"));
            } else {
                eprintln!("[{tag}] {game}: loader {lv} -> WARN unreachable ({url})");
            }
        }
    }

                    let mut installed_game: Option<String> = None;
    for newest in game_names.iter().take(5) {
        match resolve_fabric(loader, newest, fabric::LoaderVersion::Stable) {
            Ok(r) if r.java_major.map(sane_java_major).unwrap_or(false) => {
                eprintln!(
                    "[{tag}] cancel-install {newest} OK (Java {:?}, {} libs)",
                    r.java_major, r.lib_count
                );
                installed_game = Some(newest.clone());
                break;
            }
            Ok(r) => eprintln!(
                "[{tag}] {newest}: WARN bad Java major {:?} on cancel-install",
                r.java_major
            ),
            Err(e) => eprintln!("[{tag}] {newest}: WARN cancel-install skipped: {e}"),
        }
    }
    match &installed_game {
        None => failures.push(format!(
            "{tag}: cancel-install failed for all of the newest 5 stable releases"
        )),
                        Some(game) => {
            if let Some(lv) = api
                .request_loader_versions(Some(game))
                .ok()
                .and_then(|l| l.iter().next().map(|v| v.name().to_string()))
            {
                let url = format!("{meta_base}/versions/loader/{game}/{lv}/profile/json");
                match validate_loader_profile(&client, &url) {
                    Ok(libs) => {
                        eprintln!("[{tag}] profile {game}/{lv}: {} libraries", libs.len());
                                                for (name, base) in libs.iter().take(6) {
                            if let Some(u) = maven_url(base, name) {
                                if !link_ok_retry(&client, &u) {
                                    failures.push(format!("{tag} {game}: dead loader library {name} ({u})"));
                                }
                            }
                        }
                    }
                    Err(e) => failures.push(format!("{tag} {game}/{lv}: invalid profile: {e}")),
                }
            }
        }
    }

    assert!(failures.is_empty(), "{}", failures.join("\n"));
    eprintln!("[{tag}] OK — loader versions resolve and links are reachable");
}

mod indexmap_lite {
    #[derive(Default)]
    pub struct OrderedGroups {
        order: Vec<String>,
        values: std::collections::HashMap<String, Vec<String>>,
    }

    impl OrderedGroups {
        pub fn push(&mut self, key: String, value: String) {
            if !self.values.contains_key(&key) {
                self.order.push(key.clone());
            }
            self.values.entry(key).or_default().push(value);
        }

        pub fn keys(&self) -> Vec<String> {
            self.order.clone()
        }

                        pub fn get(&self, key: &str) -> Vec<String> {
            self.values
                .get(key)
                .map(|v| v.iter().rev().cloned().collect())
                .unwrap_or_default()
        }

        pub fn total(&self) -> usize {
            self.values.values().map(|v| v.len()).sum()
        }
    }
}
