use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use brassworks_core::{
    AccountStore, ContentVersion, DatapackInfo, FilterOptions, InstallResult, InstalledMod,
    Instance, LaunchProgress, LauncherSettings, LoaderKind, LoaderVersion, LoaderVersionInfo,
    LogUpload, McVersion, MicrosoftCode, ModInfo, ModpackStatus, NewsItem, PackSource, PlayerCount,
    ProjectDetail, SavedSkin, SearchFilters, SearchHit, ServerEntry, ServerStatus, SkinLibraryView,
    SkinProfile, PackInstallMeta, PackwizShare, WorldBackup, WorldInfo,
};
use brassworks_core::packs::SyncProgress;
use brassworks_core::progress::LaunchStage;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::auth_window::{open_ms_login_window, MS_LOGIN_LABEL};
use crate::state::{err, AppState, CmdResult, ExitInfo};


#[tauri::command]
pub(crate) fn get_instances(state: State<AppState>) -> CmdResult<Vec<Instance>> {
    state.launcher.instances().list().map_err(err)
}

#[tauri::command]
pub(crate) fn get_instance(state: State<AppState>, id: String) -> CmdResult<Instance> {
    state.launcher.instances().get(&id).map_err(err)
}

#[tauri::command]
pub(crate) fn update_instance(state: State<AppState>, instance: Instance) -> CmdResult<()> {
    state.launcher.instances().update(&instance).map_err(err)
}

#[tauri::command]
pub(crate) fn import_instance_branding(
    state: State<AppState>,
    instance_id: String,
    kind: String,
    src_path: String,
) -> CmdResult<String> {
    state
        .launcher
        .instances()
        .import_branding(&instance_id, &kind, std::path::Path::new(&src_path))
        .map_err(err)
}


#[tauri::command]
pub(crate) fn get_settings(state: State<AppState>) -> CmdResult<LauncherSettings> {
    state.launcher.settings().map_err(err)
}

#[tauri::command]
pub(crate) fn save_settings(state: State<AppState>, settings: LauncherSettings) -> CmdResult<()> {
    let was_on = state.launcher.settings().map(|s| s.discord_rpc).unwrap_or(true);
    state.launcher.save_settings(&settings).map_err(err)?;
            if was_on != settings.discord_rpc {
        let discord = state.discord.clone();
        if settings.discord_rpc {
            let in_game = state.running.lock().map(|r| !r.is_empty()).unwrap_or(false);
            if !in_game {
                std::thread::spawn(move || discord.set_idle());
            }
        } else {
            std::thread::spawn(move || discord.clear());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn default_settings() -> LauncherSettings {
    LauncherSettings::default()
}

#[tauri::command]
pub(crate) fn featured_packs() -> Vec<brassworks_core::FeaturedPack> {
    brassworks_core::featured_packs()
}


#[tauri::command]
pub(crate) fn get_accounts(state: State<AppState>) -> CmdResult<AccountStore> {
    state.launcher.accounts().map_err(err)
}

#[tauri::command]
pub(crate) fn select_account(state: State<AppState>, id: String) -> CmdResult<AccountStore> {
    state.launcher.select_account(&id).map_err(err)
}

#[tauri::command]
pub(crate) fn remove_account(state: State<AppState>, id: String) -> CmdResult<AccountStore> {
    state.launcher.remove_account(&id).map_err(err)
}

#[tauri::command]
pub(crate) fn add_offline_account(
    state: State<AppState>,
    username: String,
) -> CmdResult<AccountStore> {
    state.launcher.add_offline_account(username).map_err(err)
}

#[tauri::command]
pub(crate) async fn account_status(
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<brassworks_core::AccountStatus> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.account_status(&id)))
        .await
        .map_err(err)?
}

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum AuthEvent {
    Code(MicrosoftCode),
    Done { store: AccountStore },
    Error { message: String },
}

#[tauri::command]
pub(crate) fn clear_ms_login_cookies(app: AppHandle) -> CmdResult<()> {
    crate::auth_window::clear_ms_login_cookies(&app).map_err(err)
}

#[tauri::command]
pub(crate) fn start_microsoft_login(app: AppHandle, state: State<AppState>) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    std::thread::spawn(move || {
        let code_app = app.clone();
        let result = launcher.microsoft_login(|code| {
            let verification_uri = code.verification_uri.clone();
            let user_code = code.user_code.clone();
            let win_app = code_app.clone();
            let _ = code_app.run_on_main_thread(move || {
                open_ms_login_window(&win_app, verification_uri, user_code)
            });
            let _ = code_app.emit("auth://microsoft", AuthEvent::Code(code));
        });

        if let Some(win) = app.get_webview_window(MS_LOGIN_LABEL) {
            let _ = win.close();
        }

        match result {
            Ok(_) => {
                let store = launcher.accounts().unwrap_or_default();
                let _ = app.emit("auth://microsoft", AuthEvent::Done { store });
            }
            Err(e) => {
                let _ = app.emit(
                    "auth://microsoft",
                    AuthEvent::Error {
                        message: e.to_string(),
                    },
                );
            }
        }
    });
    Ok(())
}


#[tauri::command]
pub(crate) fn get_running(state: State<AppState>) -> Vec<String> {
    state
        .running
        .lock()
        .map(|set| set.iter().cloned().collect())
        .unwrap_or_default()
}

#[tauri::command]
pub(crate) fn launch(
    app: AppHandle,
    state: State<AppState>,
    instance_id: String,
    quick_play: Option<brassworks_core::QuickPlay>,
) -> CmdResult<()> {
    {
        let mut running = state.running.lock().map_err(|_| "state poisoned")?;
        if running.contains(&instance_id) {
            return Err(format!("'{instance_id}' is already running"));
        }
        running.insert(instance_id.clone());
    }

    let launcher = state.launcher.clone();
    let running = state.running.clone();
    let children = state.children.clone();
    let cancel_flag = state.arm_cancel(&instance_id);
    let cancels = state.cancels.clone();
    let discord = state.discord.clone();
    let id = instance_id;

    std::thread::spawn(move || {
        let settings = launcher.settings().unwrap_or_default();
        let inst = launcher.instances().get(&id).ok();
        let pre_cmd = inst
            .as_ref()
            .and_then(|i| i.pre_launch_command.clone())
            .filter(|c| !c.trim().is_empty())
            .or_else(|| {
                settings
                    .pre_launch_command
                    .clone()
                    .filter(|c| !c.trim().is_empty())
            });
        let post_cmd = inst
            .as_ref()
            .and_then(|i| i.post_exit_command.clone())
            .filter(|c| !c.trim().is_empty())
            .or_else(|| {
                settings
                    .post_exit_command
                    .clone()
                    .filter(|c| !c.trim().is_empty())
            });
        if let Some(cmd) = pre_cmd.as_deref() {
            run_shell(cmd);
        }

        let progress_app = app.clone();
        let mut sink = move |p: LaunchProgress| {
            let _ = progress_app.emit("launch://progress", &p);
        };
        let cancel = {
            let flag = cancel_flag.clone();
            move || flag.load(Ordering::Relaxed)
        };

        let exit = match launcher.launch(&id, quick_play, &cancel, &mut sink) {
            Ok(child) => {
                if let Ok(mut map) = children.lock() {
                    map.insert(id.clone(), child);
                }
                let _ = app.emit("launch://started", &id);
                if settings.discord_rpc {
                    let (pack_name, icon, link) = match inst.as_ref() {
                        Some(i) => (i.name.clone(), i.icon.clone(), modpack_link(i)),
                        None => ("Minecraft".to_string(), None, None),
                    };
                    discord.set_playing(&pack_name, icon.as_deref(), link.as_deref());
                }
                let started_at = Instant::now();

                let code = loop {
                    std::thread::sleep(Duration::from_millis(400));
                    let mut map = match children.lock() {
                        Ok(map) => map,
                        Err(_) => break None,
                    };
                    match map.get_mut(&id) {
                        Some(child) => match child.try_wait() {
                            Ok(Some(status)) => {
                                map.remove(&id);
                                break status.code();
                            }
                            Ok(None) => continue,
                            Err(_) => {
                                map.remove(&id);
                                break None;
                            }
                        },
                        None => break None, 
                    }
                };

                let secs = started_at.elapsed().as_secs();
                if secs > 0 && settings.record_playtime {
                    let _ = launcher.add_playtime(&id, secs);
                }

                ExitInfo {
                    instance_id: id.clone(),
                    code,
                    error: None,
                    cancelled: false,
                }
            }
            Err(e) if e.is_cancelled() => ExitInfo {
                instance_id: id.clone(),
                code: None,
                error: None,
                cancelled: true,
            },
            Err(e) => ExitInfo {
                instance_id: id.clone(),
                code: None,
                error: Some(e.to_string()),
                cancelled: false,
            },
        };

        if let Ok(mut map) = children.lock() {
            map.remove(&id);
        }
        if let Ok(mut set) = running.lock() {
            set.remove(&id);
        }
        if let Ok(mut map) = cancels.lock() {
            map.remove(&id);
        }
        if settings.discord_rpc {
            discord.set_idle();
        }
        if let Some(cmd) = post_cmd.as_deref() {
            run_shell(cmd);
        }
        let _ = app.emit("launch://exited", &exit);
    });

    Ok(())
}

#[tauri::command]
pub(crate) fn stop(state: State<AppState>, instance_id: String) -> CmdResult<()> {
    let mut map = state.children.lock().map_err(|_| "state poisoned")?;
    if let Some(child) = map.get_mut(&instance_id) {
        child.kill().map_err(err)?;
    }
    Ok(())
}


#[derive(Clone, Serialize)]
struct ModpackDone {
    instance_id: String,
    error: Option<String>,
    cancelled: bool,
}

enum ModpackOp {
    Sync,
    Repair,
    Reinstall,
    SyncShared,
}

fn spawn_modpack_op(app: AppHandle, state: &AppState, id: String, op: ModpackOp) {
    let launcher = state.launcher.clone();
    let cancel_flag = state.arm_cancel(&id);
    let cancels = state.cancels.clone();
    std::thread::spawn(move || {
        let progress_app = app.clone();
        let mut sink = move |p: LaunchProgress| {
            let _ = progress_app.emit("modpack://progress", &p);
        };
        let cancel = {
            let flag = cancel_flag.clone();
            move || flag.load(Ordering::Relaxed)
        };
        let result = match op {
            ModpackOp::Sync => launcher.sync_modpack(&id, false, &cancel, &mut sink),
            ModpackOp::Repair => launcher.sync_modpack(&id, true, &cancel, &mut sink),
            ModpackOp::Reinstall => launcher.reinstall_modpack(&id, &cancel, &mut sink),
            ModpackOp::SyncShared => launcher.sync_from_shared(&id, &cancel, &mut sink),
        };
        if let Ok(mut map) = cancels.lock() {
            map.remove(&id);
        }
        let cancelled = result.as_ref().err().is_some_and(|e| e.is_cancelled());
        let _ = app.emit(
            "modpack://done",
            ModpackDone {
                instance_id: id,
                error: result.err().filter(|e| !e.is_cancelled()).map(|e| e.to_string()),
                cancelled,
            },
        );
    });
}

#[tauri::command]
pub(crate) fn cancel_op(state: State<AppState>, instance_id: String) -> CmdResult<()> {
    if let Ok(map) = state.cancels.lock() {
        if let Some(flag) = map.get(&instance_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn modpack_status(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<ModpackStatus> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.modpack_status(&instance_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) fn sync_modpack(app: AppHandle, state: State<AppState>, instance_id: String) -> CmdResult<()> {
    spawn_modpack_op(app, &state, instance_id, ModpackOp::Sync);
    Ok(())
}

#[tauri::command]
pub(crate) fn repair_modpack(app: AppHandle, state: State<AppState>, instance_id: String) -> CmdResult<()> {
    spawn_modpack_op(app, &state, instance_id, ModpackOp::Repair);
    Ok(())
}

#[tauri::command]
pub(crate) fn reinstall_modpack(app: AppHandle, state: State<AppState>, instance_id: String) -> CmdResult<()> {
    spawn_modpack_op(app, &state, instance_id, ModpackOp::Reinstall);
    Ok(())
}

#[tauri::command]
pub(crate) fn reinstall_loader(state: State<AppState>, instance_id: String) -> CmdResult<()> {
    state.launcher.reinstall_loader(&instance_id).map_err(err)
}

#[tauri::command]
pub(crate) async fn list_mods(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Vec<InstalledMod>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.list_mods(&instance_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn mod_info(
    state: State<'_, AppState>,
    instance_id: String,
    source: String,
    project_id: String,
    version_id: Option<String>,
) -> CmdResult<ModInfo> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(launcher.mod_info(&instance_id, &source, &project_id, version_id.as_deref()))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) fn set_content_enabled(
    state: State<AppState>,
    instance_id: String,
    path: String,
    enabled: bool,
) -> CmdResult<()> {
    state
        .launcher
        .set_content_enabled(&instance_id, &path, enabled)
        .map_err(err)
}

#[tauri::command]
pub(crate) fn remove_content(state: State<AppState>, instance_id: String, path: String) -> CmdResult<()> {
    state.launcher.remove_content(&instance_id, &path).map_err(err)
}

#[tauri::command]
pub(crate) async fn search_content(
    state: State<'_, AppState>,
    instance_id: String,
    query: String,
    project_type: String,
    source: String,
    filters: SearchFilters,
    offset: u32,
) -> CmdResult<Vec<SearchHit>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .search_content(&instance_id, &query, &project_type, &source, &filters, offset)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn content_filter_options(
    state: State<'_, AppState>,
    instance_id: String,
    project_type: String,
    source: String,
) -> CmdResult<FilterOptions> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .content_filter_options(&instance_id, &project_type, &source)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn install_content(
    state: State<'_, AppState>,
    instance_id: String,
    project_id: String,
    project_type: String,
    source: String,
) -> CmdResult<InstallResult> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .install_content(&instance_id, &project_id, &project_type, &source)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn content_detail(
    state: State<'_, AppState>,
    instance_id: String,
    project_id: String,
    source: String,
) -> CmdResult<ProjectDetail> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .content_detail(&instance_id, &project_id, &source)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn content_versions(
    state: State<'_, AppState>,
    instance_id: String,
    project_id: String,
    project_type: String,
    source: String,
) -> CmdResult<Vec<ContentVersion>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .content_versions(&instance_id, &project_id, &project_type, &source)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn install_content_version(
    state: State<'_, AppState>,
    instance_id: String,
    project_id: String,
    version_id: String,
    project_type: String,
    source: String,
) -> CmdResult<InstallResult> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .install_content_version(
                &instance_id,
                &project_id,
                &version_id,
                &project_type,
                &source,
            )
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn update_all_content(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Vec<String>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.update_all_content(&instance_id).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn update_selected_content(
    state: State<'_, AppState>,
    instance_id: String,
    keys: Vec<String>,
) -> CmdResult<Vec<String>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .update_selected_content(&instance_id, &keys)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn content_changelog(
    state: State<'_, AppState>,
    instance_id: String,
    project_id: String,
    version_id: String,
    source: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .content_changelog(&instance_id, &project_id, &version_id, &source)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn uninstall_game(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.uninstall_game(&instance_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) fn set_modpack_locked(
    state: State<AppState>,
    instance_id: String,
    locked: bool,
) -> CmdResult<()> {
    state
        .launcher
        .set_modpack_locked(&instance_id, locked)
        .map_err(err)
}

#[tauri::command]
pub(crate) fn read_log(state: State<AppState>, instance_id: String) -> CmdResult<String> {
    Ok(state.launcher.read_log(&instance_id))
}

#[tauri::command]
pub(crate) fn tail_log(
    state: State<AppState>,
    instance_id: String,
    offset: u64,
) -> CmdResult<brassworks_core::LogTail> {
    Ok(state.launcher.tail_log(&instance_id, offset))
}

#[tauri::command]
pub(crate) async fn upload_log(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<LogUpload> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.upload_log(&instance_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) fn open_dir(state: State<AppState>, instance_id: String, sub: Option<String>) -> CmdResult<()> {
    let mut dir = state.launcher.paths().instance_game_dir(&instance_id);
    if let Some(s) = sub.filter(|s| !s.is_empty()) {
        dir = dir.join(s);
    }
    std::fs::create_dir_all(&dir).map_err(err)?;
    open_in_file_manager(&dir).map_err(err)
}

fn modpack_link(inst: &Instance) -> Option<String> {
    match &inst.pack {
        PackSource::Modrinth {
            project_id: Some(pid),
            ..
        } => Some(format!("https://modrinth.com/modpack/{pid}")),
        PackSource::Curseforge { project_id, .. } => {
            Some(format!("https://www.curseforge.com/projects/{project_id}"))
        }
        _ => None,
    }
}

fn run_shell(command: &str) {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", command]);

        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", command]);
        c
    };
    let _ = cmd.spawn().map(|mut child| child.wait());
}

#[tauri::command]
pub(crate) async fn java_info(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<brassworks_core::JavaReport> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.java_report(&instance_id)))
        .await
        .map_err(err)?
}

fn open_in_file_manager(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";

    std::process::Command::new(program).arg(path).spawn().map(|_| ())
}


#[derive(Serialize)]
pub(crate) struct Screenshot {
    name: String,
    path: String,
    modified: u64,
    size: u64,
    instance: String,
    #[serde(default)]
    starred: bool,
}

fn collect_screenshots(dir: &std::path::Path, instance: &str, out: &mut Vec<Screenshot>) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if !(lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")) {
            continue;
        }
        let meta = entry.metadata().ok();
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        out.push(Screenshot {
            name,
            path: path.to_string_lossy().to_string(),
            modified,
            size,
            instance: instance.to_string(),
            starred: false,
        });
    }
}

#[tauri::command]
pub(crate) fn list_screenshots(state: State<AppState>) -> CmdResult<Vec<Screenshot>> {
    let paths = state.launcher.paths();
    let mut out = Vec::new();
    if let Ok(instances) = state.launcher.instances().list() {
        for inst in instances {
            let dir = paths.instance_game_dir(&inst.id).join("screenshots");
            let before = out.len();
            collect_screenshots(&dir, &inst.id, &mut out);
            let starred = state.launcher.screenshot_stars(&inst.id);
            for shot in out[before..].iter_mut() {
                shot.starred = starred.iter().any(|s| s == &shot.name);
            }
        }
    }
    out.sort_by(|a, b| b.starred.cmp(&a.starred).then(b.modified.cmp(&a.modified)));
    Ok(out)
}

#[tauri::command]
pub(crate) fn delete_screenshot(
    state: State<AppState>,
    instance_id: String,
    name: String,
) -> CmdResult<()> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid screenshot name".to_string());
    }
    let path = state
        .launcher
        .paths()
        .instance_game_dir(&instance_id)
        .join("screenshots")
        .join(&name);
    std::fs::remove_file(&path).map_err(err)
}

fn build_thumbnail(cache_dir: &std::path::Path, src: &str, large: bool) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    let src_path = std::path::Path::new(src);
    let meta = std::fs::metadata(src_path).map_err(|e| e.to_string())?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let tag = if large { "l" } else { "s" };
    let max: u32 = if large { 1600 } else { 480 };

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    src.hash(&mut hasher);
    mtime.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    let out = cache_dir.join(format!("{:016x}_{tag}.jpg", hasher.finish()));
    if out.exists() {
        return Ok(out.to_string_lossy().into_owned());
    }

    std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;

    const MAX_DECODED_BYTES: u64 = 32 * 1024 * 1024;
    let (w, h) = image::ImageReader::open(src_path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_dimensions()
        .map_err(|e| e.to_string())?;
    if (w as u64) * (h as u64) * 4 > MAX_DECODED_BYTES {
        return Err(format!("image too large to preview ({w}×{h})"));
    }

    let img = image::ImageReader::open(src_path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    let thumb = img.thumbnail(max, max).to_rgb8();
    drop(img); 
    let file = std::io::BufWriter::new(std::fs::File::create(&out).map_err(|e| e.to_string())?);
    image::codecs::jpeg::JpegEncoder::new_with_quality(file, 82)
        .encode_image(&thumb)
        .map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) async fn screenshot_thumb(
    state: State<'_, AppState>,
    path: String,
    large: bool,
) -> CmdResult<String> {
    let cache_dir = state.launcher.paths().thumbnails_dir();
    tauri::async_runtime::spawn_blocking(move || build_thumbnail(&cache_dir, &path, large))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn cache_size(state: State<'_, AppState>) -> CmdResult<u64> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.cache_size()))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn clear_cache(state: State<'_, AppState>) -> CmdResult<u64> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.clear_cache().map_err(err)?;
        Ok(launcher.cache_size())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn cache_images(state: State<'_, AppState>, values: Vec<String>) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.cache_images(&values);
        Ok(())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn cached_image(
    state: State<'_, AppState>,
    value: String,
) -> CmdResult<Option<String>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(launcher
            .cached_image(&value)
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn get_news(state: State<'_, AppState>, instance_id: String) -> CmdResult<NewsItem> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let inst = launcher.instances().get(&instance_id).map_err(err)?;
        let url = inst
            .news_url
            .filter(|u| !u.trim().is_empty())
            .ok_or_else(|| "This instance has no news feed".to_string())?;
        brassworks_core::news(&url).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn get_playercount(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<PlayerCount> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let inst = launcher.instances().get(&instance_id).map_err(err)?;
        let url = inst
            .playercount_url
            .filter(|u| !u.trim().is_empty())
            .ok_or_else(|| "This instance has no player count".to_string())?;
        brassworks_core::player_count(&url).map_err(err)
    })
    .await
    .map_err(err)?
}


#[tauri::command]
pub(crate) fn delete_instance(state: State<AppState>, instance_id: String) -> CmdResult<()> {
    state.launcher.delete_instance(&instance_id).map_err(err)
}

#[tauri::command]
pub(crate) fn set_active_instance(state: State<AppState>, instance_id: String) -> CmdResult<()> {
    state.launcher.set_selected_instance(&instance_id).map_err(err)
}

#[tauri::command]
pub(crate) fn create_custom_instance(
    state: State<AppState>,
    name: String,
    minecraft_version: String,
    loader: String,
    loader_version: String,
) -> CmdResult<Instance> {
    state
        .launcher
        .create_custom_instance(
            &name,
            &minecraft_version,
            LoaderKind::parse(&loader),
            LoaderVersion::parse(&loader_version),
        )
        .map_err(err)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn create_packwiz_instance(
    state: State<'_, AppState>,
    name: String,
    url: String,
    optional: Option<Vec<String>>,
    unsup: Option<bool>,
    flavors: Option<Vec<String>>,
    public_key: Option<String>,
    meta: Option<PackInstallMeta>,
) -> CmdResult<Instance> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .create_packwiz_instance(
                &name,
                &url,
                optional.unwrap_or_default(),
                unsup.unwrap_or(false),
                flavors.unwrap_or_default(),
                public_key,
                meta.unwrap_or_default(),
            )
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn extract_packwiz_pack(
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.extract_packwiz_pack(&path).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn detect_pack_file(
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<brassworks_core::instance::PackFileKind> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.detect_pack_file(&path).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn write_temp_pack(
    state: State<'_, AppState>,
    filename: String,
    bytes: Vec<u8>,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.write_temp_pack(&filename, &bytes).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn inspect_packwiz_flavors(
    state: State<'_, AppState>,
    url: String,
) -> CmdResult<Vec<brassworks_core::FlavorGroup>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.inspect_packwiz_flavors(&url, &|| false).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn set_packwiz_flavors(
    state: State<'_, AppState>,
    id: String,
    flavors: Vec<String>,
) -> CmdResult<Instance> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.set_packwiz_flavors(&id, flavors).map_err(err)
    })
    .await
    .map_err(err)?
}

#[derive(Clone, Serialize)]
struct PreflightProgress {
    stage: String,
    current: u64,
    total: u64,
}

impl From<SyncProgress> for PreflightProgress {
    fn from(sp: SyncProgress) -> Self {
        Self {
            stage: sp.message,
            current: sp.current,
            total: sp.total,
        }
    }
}

#[tauri::command]
pub(crate) async fn preflight_modpack(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    project_id: String,
    version_id: String,
) -> CmdResult<brassworks_core::packs::Preflight> {
    let launcher = state.launcher.clone();
    let cancel_flag = state.arm_cancel("__preflight__");
    let cancels = state.cancels.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let progress_app = app.clone();
        let mut sink = move |sp: SyncProgress| {
            let _ = progress_app.emit("pack://preflight", PreflightProgress::from(sp));
        };
        let cancel = move || cancel_flag.load(Ordering::Relaxed);
        launcher
            .preflight_modpack(&source, &project_id, &version_id, &cancel, &mut sink)
            .map_err(err)
    })
    .await
    .map_err(err);
    if let Ok(mut map) = cancels.lock() {
        map.remove("__preflight__");
    }
    result?
}

#[tauri::command]
pub(crate) async fn preflight_modpack_file(
    state: State<'_, AppState>,
    file_path: String,
    source: String,
) -> CmdResult<brassworks_core::packs::Preflight> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.preflight_modpack_file(&file_path, &source).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn scan_manual_mods(
    state: State<'_, AppState>,
    folders: Vec<String>,
    wanted: Vec<brassworks_core::packs::ManualWant>,
) -> CmdResult<Vec<(String, String)>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.scan_manual_mods(folders, wanted))
        .await
        .map_err(err)
}

#[tauri::command]
pub(crate) async fn validate_manual_mod(
    state: State<'_, AppState>,
    path: String,
    sha1: Option<String>,
) -> CmdResult<bool> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.validate_manual_mod(path, sha1))
        .await
        .map_err(err)
}

#[tauri::command]
pub(crate) fn default_download_dir() -> CmdResult<Option<String>> {
    Ok(brassworks_core::settings::default_download_dir())
}

#[tauri::command]
pub(crate) async fn inspect_packwiz(
    state: State<'_, AppState>,
    url: String,
) -> CmdResult<Vec<brassworks_core::packs::OptionalComponent>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.inspect_packwiz(&url, &|| false).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn scan_importable(
    state: State<'_, AppState>,
) -> CmdResult<Vec<brassworks_core::ImportCandidate>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.scan_importable()))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn import_external(
    state: State<'_, AppState>,
    keys: Vec<String>,
) -> CmdResult<Vec<Instance>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.import_external(keys).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn list_packwiz_branches(
    state: State<'_, AppState>,
    repo: String,
) -> CmdResult<Vec<brassworks_core::PackwizBranch>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.list_packwiz_branches(&repo).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn switch_packwiz_branch(
    state: State<'_, AppState>,
    id: String,
    url: String,
) -> CmdResult<Instance> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.switch_packwiz_branch(&id, &url).map_err(err)
    })
    .await
    .map_err(err)?
}


#[tauri::command]
pub(crate) async fn minecraft_versions(include_snapshots: bool) -> CmdResult<Vec<McVersion>> {
    tauri::async_runtime::spawn_blocking(move || {
        brassworks_core::minecraft_versions(include_snapshots).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn loader_versions(
    loader: String,
    minecraft_version: String,
) -> CmdResult<Vec<LoaderVersionInfo>> {
    tauri::async_runtime::spawn_blocking(move || {
        brassworks_core::loader_versions(LoaderKind::parse(&loader), &minecraft_version).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn supported_loaders(minecraft_version: String) -> CmdResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(brassworks_core::supported_loaders(&minecraft_version))
    })
    .await
    .map_err(err)?
}


#[tauri::command]
pub(crate) async fn search_modpacks(
    state: State<'_, AppState>,
    source: String,
    query: String,
    filters: SearchFilters,
    offset: u32,
) -> CmdResult<Vec<SearchHit>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.search_modpacks(&source, &query, &filters, offset).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn modpack_filter_options(
    state: State<'_, AppState>,
    source: String,
) -> CmdResult<FilterOptions> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.modpack_filter_options(&source).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn modpack_versions(
    state: State<'_, AppState>,
    source: String,
    project_id: String,
) -> CmdResult<Vec<ContentVersion>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.modpack_versions(&source, &project_id).map_err(err)
    })
    .await
    .map_err(err)?
}

#[derive(Clone, Serialize)]
struct PackDone {
    instance: Option<Instance>,
    error: Option<String>,
    cancelled: bool,
}

fn emit_pack_progress(app: &AppHandle, channel: &str, id: &str, sp: SyncProgress) {
    let stage = match sp.stage {
        brassworks_core::packs::SyncStage::Fetching => LaunchStage::CheckingUpdates,
        brassworks_core::packs::SyncStage::Done => LaunchStage::Running,
        _ => LaunchStage::SyncingModpack,
    };
    let p = LaunchProgress {
        instance_id: id.to_string(),
        stage,
        message: sp.message,
        current: sp.current,
        total: sp.total,
    };
    let _ = app.emit(channel, &p);
}

#[tauri::command]
pub(crate) fn install_modpack(
    app: AppHandle,
    state: State<AppState>,
    source: String,
    project_id: String,
    version_id: String,
    name: String,
    optional: Option<Vec<String>>,
    manual_mods: Option<Vec<(String, String)>>,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    let cancel_flag = state.arm_cancel("__install__");
    let cancels = state.cancels.clone();
    std::thread::spawn(move || {
        let progress_app = app.clone();
        let mut sink =
            move |sp: SyncProgress| emit_pack_progress(&progress_app, "pack://progress", "__install__", sp);
        let cancel = {
            let flag = cancel_flag.clone();
            move || flag.load(Ordering::Relaxed)
        };
        let started_app = app.clone();
        let mut on_created =
            move |inst: &Instance| {
                let _ = started_app.emit("pack://started", inst);
            };
        let result = launcher.install_modpack(
            &source,
            &project_id,
            &version_id,
            &name,
            optional.unwrap_or_default(),
            manual_mods.unwrap_or_default(),
            &cancel,
            &mut on_created,
            &mut sink,
        );
        if let Ok(mut map) = cancels.lock() {
            map.remove("__install__");
        }
        let done = match result {
            Ok(instance) => PackDone {
                instance: Some(instance),
                error: None,
                cancelled: false,
            },
            Err(e) if e.is_cancelled() => PackDone {
                instance: None,
                error: None,
                cancelled: true,
            },
            Err(e) => PackDone {
                instance: None,
                error: Some(e.to_string()),
                cancelled: false,
            },
        };
        let _ = app.emit("pack://done", done);
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn install_modpack_file(
    app: AppHandle,
    state: State<AppState>,
    file_path: String,
    source: String,
    name: String,
    optional: Option<Vec<String>>,
    manual_mods: Option<Vec<(String, String)>>,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    let cancel_flag = state.arm_cancel("__install__");
    let cancels = state.cancels.clone();
    std::thread::spawn(move || {
        let progress_app = app.clone();
        let mut sink = move |sp: SyncProgress| {
            emit_pack_progress(&progress_app, "pack://progress", "__install__", sp)
        };
        let cancel = {
            let flag = cancel_flag.clone();
            move || flag.load(Ordering::Relaxed)
        };
        let started_app = app.clone();
        let mut on_created = move |inst: &Instance| {
            let _ = started_app.emit("pack://started", inst);
        };
        let result = launcher.install_modpack_file(
            &file_path,
            &source,
            &name,
            optional.unwrap_or_default(),
            manual_mods.unwrap_or_default(),
            &cancel,
            &mut on_created,
            &mut sink,
        );
        if let Ok(mut map) = cancels.lock() {
            map.remove("__install__");
        }
        let done = match result {
            Ok(instance) => PackDone {
                instance: Some(instance),
                error: None,
                cancelled: false,
            },
            Err(e) if e.is_cancelled() => PackDone {
                instance: None,
                error: None,
                cancelled: true,
            },
            Err(e) => PackDone {
                instance: None,
                error: Some(e.to_string()),
                cancelled: false,
            },
        };
        let _ = app.emit("pack://done", done);
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn open_instance_dir(state: State<AppState>, instance_id: String) -> CmdResult<()> {
    let dir = state.launcher.paths().instance_dir(&instance_id);
    std::fs::create_dir_all(&dir).map_err(err)?;
    open_in_file_manager(&dir).map_err(err)
}

#[tauri::command]
pub(crate) fn reveal_path(path: String) -> CmdResult<()> {
    let p = std::path::PathBuf::from(&path);
    let dir = p.parent().map(|d| d.to_path_buf()).unwrap_or(p);
    open_in_file_manager(&dir).map_err(err)
}

fn open_with_default(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn().map(|_| ())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ())
    }
}

#[tauri::command]
pub(crate) fn open_file(path: String) -> CmdResult<()> {
    open_with_default(std::path::Path::new(&path)).map_err(err)
}

#[tauri::command]
pub(crate) fn delete_java_runtime(state: State<AppState>, path: String) -> CmdResult<()> {
    state.launcher.delete_java_runtime(&path).map_err(err)
}

#[tauri::command]
pub(crate) async fn list_java_runtimes(
    state: State<'_, AppState>,
) -> CmdResult<Vec<brassworks_core::JavaInstall>> {
                let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.java_runtimes()))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn download_java(state: State<'_, AppState>, major: u32) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.download_java(major).map_err(err))
        .await
        .map_err(err)?
}


#[tauri::command]
pub(crate) async fn skin_profile(
    state: State<'_, AppState>,
    account_id: String,
) -> CmdResult<SkinProfile> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.skin_profile(&account_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn set_cape(
    state: State<'_, AppState>,
    account_id: String,
    cape_id: Option<String>,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.set_cape(&account_id, cape_id.as_deref()).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) fn list_skins(
    state: State<AppState>,
    account_id: String,
) -> CmdResult<SkinLibraryView> {
    Ok(state.launcher.list_skins(&account_id))
}

#[tauri::command]
pub(crate) async fn seed_current_skin(
    state: State<'_, AppState>,
    account_id: String,
) -> CmdResult<SkinLibraryView> {
    let launcher = state.launcher.clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || launcher.seed_current_skin(&account_id))
            .await
            .map_err(err)?,
    )
}

#[tauri::command]
pub(crate) fn delete_skin(
    state: State<AppState>,
    account_id: String,
    skin_id: String,
) -> CmdResult<()> {
    state.launcher.delete_skin(&account_id, &skin_id).map_err(err)
}

#[tauri::command]
pub(crate) async fn apply_saved_skin(
    state: State<'_, AppState>,
    account_id: String,
    skin_id: String,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.apply_saved_skin(&account_id, &skin_id).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn create_preset(
    state: State<'_, AppState>,
    account_id: String,
    name: String,
    model: String,
    cape_id: Option<String>,
    data: Option<Vec<u8>>,
    url: Option<String>,
) -> CmdResult<SavedSkin> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .create_preset(&account_id, &name, &model, cape_id.as_deref(), data, url)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn duplicate_skin(
    state: State<'_, AppState>,
    account_id: String,
    skin_id: String,
    name: String,
) -> CmdResult<SavedSkin> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .duplicate_skin(&account_id, &skin_id, &name)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn update_preset(
    state: State<'_, AppState>,
    account_id: String,
    skin_id: String,
    name: String,
    model: String,
    cape_id: Option<String>,
    data: Option<Vec<u8>>,
) -> CmdResult<SavedSkin> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .update_preset(&account_id, &skin_id, &name, &model, cape_id.as_deref(), data)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn export_skin(
    app: AppHandle,
    source: String,
    name: String,
) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = if source.starts_with("http://") || source.starts_with("https://") {
            brassworks_core::skins::download_texture(&source).map_err(err)?
        } else {
            std::fs::read(&source).map_err(err)?
        };
        let dir = app.path().download_dir().map_err(err)?;
        std::fs::create_dir_all(&dir).map_err(err)?;
        let safe: String = name
            .chars()
            .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | ' ') { c } else { '_' })
            .collect();
        let base = match safe.trim() {
            "" => "skin",
            s => s,
        };
        let mut path = dir.join(format!("{base}.png"));
        let mut n = 2;
        while path.exists() {
            path = dir.join(format!("{base} ({n}).png"));
            n += 1;
        }
        std::fs::write(&path, &bytes).map_err(err)?;
        let _ = open_in_file_manager(path.parent().unwrap_or(&dir));
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) fn update_modpack(
    app: AppHandle,
    state: State<AppState>,
    instance_id: String,
    version_id: Option<String>,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    let id = instance_id.clone();
    let cancel_flag = state.arm_cancel(&id);
    let cancels = state.cancels.clone();
    std::thread::spawn(move || {
        let progress_app = app.clone();
        let pid = id.clone();
        let mut sink = move |sp: SyncProgress| {
            emit_pack_progress(&progress_app, "modpack://progress", &pid, sp)
        };
        let cancel = {
            let flag = cancel_flag.clone();
            move || flag.load(Ordering::Relaxed)
        };
        let result = launcher.update_modpack(&id, version_id.as_deref(), &cancel, &mut sink);
        if let Ok(mut map) = cancels.lock() {
            map.remove(&id);
        }
        let cancelled = result.as_ref().err().is_some_and(|e| e.is_cancelled());
        let _ = app.emit(
            "modpack://done",
            ModpackDone {
                instance_id: id,
                error: result.err().filter(|e| !e.is_cancelled()).map(|e| e.to_string()),
                cancelled,
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub(crate) async fn release_changelog(version: Option<String>) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        brassworks_core::release_changelog(version.as_deref()).map_err(err)
    })
    .await
    .map_err(err)?
}

#[derive(Clone, Serialize)]
pub(crate) struct UpdateInfo {
    available: bool,
    version: String,
    current_version: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
    done: bool,
}

#[tauri::command]
pub(crate) async fn check_for_update(app: AppHandle) -> CmdResult<UpdateInfo> {
    use tauri_plugin_updater::UpdaterExt;
    let current = app.package_info().version.to_string();
    let updater = app.updater().map_err(err)?;
    match updater.check().await.map_err(err)? {
        Some(update) => Ok(UpdateInfo {
            available: true,
            version: update.version.clone(),
            current_version: current,
            notes: update.body.clone(),
        }),
        None => Ok(UpdateInfo {
            available: false,
            version: current.clone(),
            current_version: current,
            notes: None,
        }),
    }
}

fn update_block_reason_impl() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().ok()?;
        let path = exe.to_string_lossy();
        if path.contains("/AppTranslocation/") {
            return Some(
                "macOS is running Brassworks Launcher from a temporary read-only copy \
                 (App Translocation), so it can't update itself. Move the app to your \
                 Applications folder, reopen it from there, then update again."
                    .into(),
            );
        }
        if path.starts_with("/Volumes/") {
            return Some(
                "Brassworks Launcher is running from a disk image. Drag it into your \
                 Applications folder, eject the disk image, and open it from Applications \
                 before updating."
                    .into(),
            );
        }
        if let Some(app_root) = exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app"))
        {
            if let Some(parent) = app_root.parent() {
                let probe = parent.join(format!(".bw-update-probe-{}", std::process::id()));
                match std::fs::File::create(&probe) {
                    Ok(_) => {
                        let _ = std::fs::remove_file(&probe);
                    }
                    Err(_) => {
                        return Some(
                            "Brassworks Launcher is installed in a read-only location and \
                             can't replace itself. Move it to your Applications folder and \
                             try again."
                                .into(),
                        );
                    }
                }
            }
        }
    }
    None
}

#[tauri::command]
pub(crate) fn update_block_reason() -> CmdResult<Option<String>> {
    Ok(update_block_reason_impl())
}

#[tauri::command]
pub(crate) async fn install_update(app: AppHandle) -> CmdResult<()> {
    use tauri_plugin_updater::UpdaterExt;
    if let Some(reason) = update_block_reason_impl() {
        return Err(reason);
    }
    let updater = app.updater().map_err(err)?;
    let update = updater
        .check()
        .await
        .map_err(err)?
        .ok_or_else(|| "No update available".to_string())?;

    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    let done_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(
                    "updater://progress",
                    UpdateProgress {
                        downloaded,
                        total,
                        done: false,
                    },
                );
            },
            move || {
                let _ = done_app.emit(
                    "updater://progress",
                    UpdateProgress {
                        downloaded: 0,
                        total: None,
                        done: true,
                    },
                );
            },
        )
        .await
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn restart_app(app: AppHandle) {
    app.restart();
}



#[tauri::command]
pub(crate) async fn list_worlds(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Vec<WorldInfo>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.list_worlds(&instance_id)))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) fn world_icon(
    state: State<AppState>,
    instance_id: String,
    folder: String,
) -> CmdResult<Option<String>> {
    Ok(state.launcher.world_icon_path(&instance_id, &folder))
}

#[tauri::command]
pub(crate) fn delete_world(
    state: State<AppState>,
    instance_id: String,
    folder: String,
) -> CmdResult<()> {
    state.launcher.delete_world(&instance_id, &folder).map_err(err)
}

#[tauri::command]
pub(crate) async fn list_datapacks(
    state: State<'_, AppState>,
    instance_id: String,
    world: String,
) -> CmdResult<Vec<DatapackInfo>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.list_datapacks(&instance_id, &world)))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) fn set_datapack_enabled(
    state: State<AppState>,
    instance_id: String,
    world: String,
    filename: String,
    enabled: bool,
) -> CmdResult<()> {
    state
        .launcher
        .set_datapack_enabled(&instance_id, &world, &filename, enabled)
        .map_err(err)
}

#[tauri::command]
pub(crate) fn remove_datapack(
    state: State<AppState>,
    instance_id: String,
    world: String,
    filename: String,
) -> CmdResult<()> {
    state
        .launcher
        .remove_datapack(&instance_id, &world, &filename)
        .map_err(err)
}

#[tauri::command]
pub(crate) async fn install_datapack(
    state: State<'_, AppState>,
    instance_id: String,
    world: String,
    source: String,
    project_id: String,
    version_id: Option<String>,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .install_datapack(&instance_id, &world, &source, &project_id, version_id.as_deref())
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn list_servers(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Vec<ServerEntry>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.list_servers(&instance_id)))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) fn save_servers(
    state: State<AppState>,
    instance_id: String,
    servers: Vec<ServerEntry>,
) -> CmdResult<()> {
    state.launcher.save_servers(&instance_id, &servers).map_err(err)
}

#[tauri::command]
pub(crate) async fn ping_server(
    state: State<'_, AppState>,
    address: String,
) -> CmdResult<ServerStatus> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.ping_server(&address)))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) fn toggle_star(
    state: State<AppState>,
    instance_id: String,
    kind: String,
    key: String,
) -> CmdResult<bool> {
    state.launcher.toggle_star(&instance_id, &kind, &key).map_err(err)
}

#[tauri::command]
pub(crate) async fn export_modpack(
    state: State<'_, AppState>,
    instance_id: String,
    format: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.export_modpack(&instance_id, &format).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn export_tree(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<brassworks_core::export::ExportTree> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.export_tree(&instance_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn export_modpack_selected(
    state: State<'_, AppState>,
    instance_id: String,
    format: String,
    selection: brassworks_core::export::ExportSelection,
    meta: Option<brassworks_core::export::ExportMeta>,
    unsup: Option<bool>,
    sign: Option<bool>,
    sign_format: Option<String>,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .export_modpack_selected_opts(
                &instance_id,
                &format,
                selection,
                meta,
                unsup.unwrap_or(false),
                sign.unwrap_or(false),
                &sign_format.unwrap_or_default(),
            )
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn unsup_public_key(
    state: State<'_, AppState>,
    instance_id: String,
    format: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.unsup_public_key(&instance_id, &format)))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn regenerate_unsup_key(
    state: State<'_, AppState>,
    instance_id: String,
    format: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .regenerate_unsup_key(&instance_id, &format)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn list_export_configs(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Vec<brassworks_core::export::ExportConfig>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.list_export_configs(&instance_id)))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn save_export_config(
    state: State<'_, AppState>,
    instance_id: String,
    config: brassworks_core::export::ExportConfig,
) -> CmdResult<brassworks_core::export::ExportConfig> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.save_export_config(&instance_id, config).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn delete_export_config(
    state: State<'_, AppState>,
    instance_id: String,
    config_id: String,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.delete_export_config(&instance_id, &config_id).map_err(err)
    })
    .await
    .map_err(err)?
}

fn parse_provider(s: &str) -> CmdResult<brassworks_core::forge::Provider> {
    brassworks_core::forge::Provider::parse(s).ok_or_else(|| format!("unknown git provider: {s}"))
}

#[tauri::command]
pub(crate) async fn forge_connect(
    state: State<'_, AppState>,
    provider: String,
    token: String,
    remember: Option<bool>,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    let provider = parse_provider(&provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        let login = launcher.forge_login(provider, &token).map_err(err)?;
        launcher
            .save_forge_token(provider, &token, remember.unwrap_or(true))
            .map_err(err)?;
        Ok(login)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn forge_token_present(
    state: State<'_, AppState>,
    provider: String,
) -> CmdResult<bool> {
    let launcher = state.launcher.clone();
    let provider = parse_provider(&provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(launcher.forge_token(provider).map_err(err)?.is_some())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn forge_remembered(
    state: State<'_, AppState>,
    provider: String,
) -> CmdResult<bool> {
    let launcher = state.launcher.clone();
    let provider = parse_provider(&provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        launcher.forge_token_remembered(provider).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn forge_disconnect(
    state: State<'_, AppState>,
    provider: String,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    let provider = parse_provider(&provider)?;
    tauri::async_runtime::spawn_blocking(move || launcher.clear_forge_token(provider).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn publish_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    config_id: String,
    confirm_embedded: bool,
    provider: String,
) -> CmdResult<brassworks_core::instance::PublishResult> {
    let launcher = state.launcher.clone();
    let provider = parse_provider(&provider)?;
    let cancel_flag = state.arm_cancel(&instance_id);
    let cancels = state.cancels.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut progress = |p: brassworks_core::forge::PushProgress| {
            let _ = app.emit("publish://progress", &p);
        };
        let cancel = {
            let f = cancel_flag.clone();
            move || f.load(Ordering::Relaxed)
        };
        let res = launcher
            .publish_pack(
                &instance_id,
                &config_id,
                confirm_embedded,
                provider,
                &mut progress,
                &cancel,
            )
            .map_err(err);
        if let Ok(mut map) = cancels.lock() {
            map.remove(&instance_id);
        }
        res
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn relink_share(
    state: State<'_, AppState>,
    instance_id: String,
    repo_url: String,
) -> CmdResult<brassworks_core::instance::PackShare> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.relink_share(&instance_id, &repo_url).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) fn sync_from_shared(
    app: AppHandle,
    state: State<AppState>,
    instance_id: String,
) -> CmdResult<()> {
    spawn_modpack_op(app, &state, instance_id, ModpackOp::SyncShared);
    Ok(())
}

#[tauri::command]
pub(crate) async fn share_pending_changes(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<bool> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.share_pending_changes(&instance_id).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn share_link(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.share_link(&instance_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn write_share_file(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.write_share_file(&instance_id).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn disconnect_share(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.disconnect_share(&instance_id).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn share_params(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<brassworks_core::instance::SharePackParams> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.share_params(&instance_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn set_share_params(
    state: State<'_, AppState>,
    instance_id: String,
    params: brassworks_core::instance::SharePackParams,
) -> CmdResult<()> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.set_share_params(&instance_id, params).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn share_repo_info(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<brassworks_core::ShareRepoInfo> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.share_repo_info(&instance_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn share_diff(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Vec<brassworks_core::ShareDiffEntry>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || launcher.share_diff(&instance_id).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn run_export_config(
    state: State<'_, AppState>,
    instance_id: String,
    config_id: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.run_export_config(&instance_id, &config_id).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn backup_world(
    state: State<'_, AppState>,
    instance_id: String,
    world: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.backup_world(&instance_id, &world).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn list_world_backups(
    state: State<'_, AppState>,
    instance_id: String,
) -> CmdResult<Vec<WorldBackup>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(launcher.list_world_backups(&instance_id)))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn export_world(
    state: State<'_, AppState>,
    instance_id: String,
    world: String,
) -> CmdResult<String> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.export_world(&instance_id, &world).map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) fn cli_ready(state: State<AppState>) -> CmdResult<PendingStartup> {
    let open = {
        let mut slot = state.pending_open.lock().map_err(|_| "lock poisoned")?;
        state.frontend_ready.store(true, Ordering::Relaxed);
        slot.take()
    };
    let command = state.pending_cli.lock().map_err(|_| "lock poisoned")?.take();
    Ok(PendingStartup { open, command })
}

#[derive(Serialize)]
pub(crate) struct PendingStartup {
    open: Option<String>,
    command: Option<String>,
}

#[tauri::command]
pub(crate) fn resolve_packwiz_share(input: String) -> CmdResult<PackwizShare> {
    if let Some(scheme_end) = input.find("://") {
        if input[..scheme_end].eq_ignore_ascii_case("brassworks") {
            let url = tauri::Url::parse(&input).map_err(err)?;
            return PackwizShare::from_query_pairs(url.query_pairs()).map_err(err);
        }
    }
    PackwizShare::from_file(&input).map_err(err)
}

#[tauri::command]
pub(crate) fn install_cli() -> CmdResult<String> {
    let exe = std::env::current_exe().map_err(err)?;

    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("LOCALAPPDATA").map_err(err)?;
        let bin = std::path::PathBuf::from(base)
            .join("Microsoft")
            .join("WindowsApps");
        std::fs::create_dir_all(&bin).map_err(err)?;
        let shim = bin.join("brassworks.cmd");
        let content = format!("@echo off\r\n\"{}\" %*\r\n", exe.display());
        std::fs::write(&shim, content).map_err(err)?;
        Ok(format!(
            "{} - open a new terminal, then run `brassworks <command>`",
            shim.display()
        ))
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::symlink;
        use std::path::PathBuf;

        let mut candidates: Vec<PathBuf> = vec![PathBuf::from("/usr/local/bin/brassworks")];
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(home).join(".local/bin/brassworks"));
        }

        let mut last_err = String::from("no writable location on PATH");
        for target in candidates {
            if let Some(parent) = target.parent() {
                if std::fs::create_dir_all(parent).is_err() {
                    continue;
                }
            }
            let _ = std::fs::remove_file(&target);
            match symlink(&exe, &target) {
                Ok(_) => {
                    return Ok(format!(
                        "{} - run `brassworks <command>`",
                        target.display()
                    ))
                }
                Err(e) => last_err = e.to_string(),
            }
        }
        Err(last_err)
    }
}

fn cli_targets() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    #[cfg(target_os = "windows")]
    {
        let mut v = Vec::new();
        if let Ok(base) = std::env::var("LOCALAPPDATA") {
            let base = PathBuf::from(base);
            v.push(
                base.join("Microsoft")
                    .join("WindowsApps")
                    .join("brassworks.cmd"),
            );
            v.push(
                base.join("BrassworksLauncher")
                    .join("bin")
                    .join("brassworks.cmd"),
            );
        }
        v
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut v = vec![PathBuf::from("/usr/local/bin/brassworks")];
        if let Ok(home) = std::env::var("HOME") {
            v.push(PathBuf::from(home).join(".local/bin/brassworks"));
        }
        v
    }
}

#[derive(Serialize)]
pub(crate) struct CliStatus {
    installed: bool,
    path: Option<String>,
}

#[tauri::command]
pub(crate) fn cli_status() -> CliStatus {
    for target in cli_targets() {
        if std::fs::symlink_metadata(&target).is_ok() {
            return CliStatus {
                installed: true,
                path: Some(target.display().to_string()),
            };
        }
    }
    CliStatus {
        installed: false,
        path: None,
    }
}

#[derive(Deserialize)]
pub(crate) struct MenuCommand {
    id: String,
    label: String,
}

#[tauri::command]
pub(crate) fn set_menu_commands(app: AppHandle, items: Vec<MenuCommand>) -> CmdResult<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let pinned: Vec<(String, String)> =
            items.into_iter().map(|c| (c.id, c.label)).collect();
        let menu = crate::build_menu(&app, &pinned).map_err(err)?;
        app.set_menu(menu).map_err(err)?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (&app, &items);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn uninstall_cli() -> CmdResult<String> {
    let mut removed: Option<String> = None;
    for target in cli_targets() {
        if std::fs::symlink_metadata(&target).is_ok() {
            std::fs::remove_file(&target).map_err(err)?;
            removed = Some(target.display().to_string());
        }
    }
    removed.ok_or_else(|| "the brassworks command isn't installed".to_string())
}
