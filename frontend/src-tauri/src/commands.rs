
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use brassworks_core::{
    AccountStore, ContentVersion, InstalledMod, Instance, LaunchProgress, LauncherSettings,
    LogUpload, MicrosoftCode, ModInfo, ModpackStatus, NewsItem, PlayerCount, ProjectDetail,
    SearchHit,
};
use serde::Serialize;
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
pub(crate) fn get_settings(state: State<AppState>) -> CmdResult<LauncherSettings> {
    state.launcher.settings().map_err(err)
}

#[tauri::command]
pub(crate) fn save_settings(state: State<AppState>, settings: LauncherSettings) -> CmdResult<()> {
    state.launcher.save_settings(&settings).map_err(err)
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

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum AuthEvent {
    Code(MicrosoftCode),
    Done { store: AccountStore },
    Error { message: String },
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
pub(crate) fn launch(app: AppHandle, state: State<AppState>, instance_id: String) -> CmdResult<()> {
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
    let id = instance_id;

    std::thread::spawn(move || {
        let progress_app = app.clone();
        let mut sink = move |p: LaunchProgress| {
            let _ = progress_app.emit("launch://progress", &p);
        };
        let cancel = {
            let flag = cancel_flag.clone();
            move || flag.load(Ordering::Relaxed)
        };

        let exit = match launcher.launch(&id, &cancel, &mut sink) {
            Ok(child) => {
                if let Ok(mut map) = children.lock() {
                    map.insert(id.clone(), child);
                }
                let _ = app.emit("launch://started", &id);
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
                if secs > 0 {
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
    modrinth_id: String,
    version_id: Option<String>,
) -> CmdResult<ModInfo> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(launcher.mod_info(&instance_id, &modrinth_id, version_id.as_deref()))
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
    offset: u32,
) -> CmdResult<Vec<SearchHit>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .search_content(&instance_id, &query, &project_type, offset)
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
) -> CmdResult<InstalledMod> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .install_content(&instance_id, &project_id, &project_type)
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
) -> CmdResult<ProjectDetail> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher.content_detail(&instance_id, &project_id).map_err(err)
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
) -> CmdResult<Vec<ContentVersion>> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .content_versions(&instance_id, &project_id, &project_type)
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
) -> CmdResult<InstalledMod> {
    let launcher = state.launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        launcher
            .install_content_version(&instance_id, &project_id, &version_id, &project_type)
            .map_err(err)
    })
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

fn open_in_file_manager(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";

    std::process::Command::new(program).arg(path).spawn().map(|_| ())
}


#[tauri::command]
pub(crate) async fn get_news() -> CmdResult<NewsItem> {
    tauri::async_runtime::spawn_blocking(|| brassworks_core::news().map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub(crate) async fn get_playercount() -> CmdResult<PlayerCount> {
    tauri::async_runtime::spawn_blocking(|| brassworks_core::player_count().map_err(err))
        .await
        .map_err(err)?
}

