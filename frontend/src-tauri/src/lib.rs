
mod auth_window;
mod commands;
mod discord;
mod state;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use brassworks_core::Launcher;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};

use discord::Discord;
use state::AppState;

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray-show", "Open Brassworks", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray-hide", "Hide to tray", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &hide, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let reveal = |app: &tauri::AppHandle| {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    };

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().expect("window icon"))
        .tooltip("Brassworks Launcher")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "tray-show" => reveal(app),
            "tray-hide" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            let launcher = Launcher::new().map_err(|e| format!("init launcher: {e}"))?;
            launcher
                .bootstrap()
                .map_err(|e| format!("bootstrap: {e}"))?;

            let discord = Arc::new(Discord::new());
            if launcher.settings().map(|s| s.discord_rpc).unwrap_or(true) {
                discord.set_idle();
            }

            app.manage(AppState {
                launcher,
                running: Arc::new(Mutex::new(HashSet::new())),
                children: Arc::new(Mutex::new(HashMap::new())),
                cancels: Arc::new(Mutex::new(HashMap::new())),
                discord,
            });

            setup_tray(app.handle())?;

            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let hide = handle
                            .state::<AppState>()
                            .launcher
                            .settings()
                            .map(|s| s.close_to_tray)
                            .unwrap_or(false);
                        if hide {
                            api.prevent_close();
                            if let Some(win) = handle.get_webview_window("main") {
                                let _ = win.hide();
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_instances,
            commands::get_instance,
            commands::update_instance,
            commands::get_settings,
            commands::save_settings,
            commands::get_accounts,
            commands::select_account,
            commands::remove_account,
            commands::start_microsoft_login,
            commands::get_running,
            commands::launch,
            commands::stop,
            commands::cancel_op,
            commands::modpack_status,
            commands::sync_modpack,
            commands::repair_modpack,
            commands::reinstall_modpack,
            commands::reinstall_loader,
            commands::list_mods,
            commands::mod_info,
            commands::set_content_enabled,
            commands::remove_content,
            commands::search_content,
            commands::install_content,
            commands::content_detail,
            commands::content_versions,
            commands::install_content_version,
            commands::update_all_content,
            commands::update_selected_content,
            commands::content_changelog,
            commands::uninstall_game,
            commands::list_screenshots,
            commands::delete_screenshot,
            commands::screenshot_thumb,
            commands::open_file,
            commands::set_modpack_locked,
            commands::read_log,
            commands::upload_log,
            commands::open_dir,
            commands::java_info,
            commands::cache_size,
            commands::clear_cache,
            commands::get_news,
            commands::get_playercount,
            commands::release_changelog,
            commands::check_for_update,
            commands::install_update,
            commands::restart_app,
            commands::delete_instance,
            commands::set_active_instance,
            commands::create_custom_instance,
            commands::create_packwiz_instance,
            commands::minecraft_versions,
            commands::loader_versions,
            commands::search_modpacks,
            commands::modpack_versions,
            commands::install_modpack,
            commands::install_modpack_file,
            commands::install_modpack_bytes,
            commands::update_modpack,
            commands::open_instance_dir,
            commands::reveal_path,
            commands::delete_java_runtime,
            commands::list_java_runtimes,
            commands::download_java,
            commands::skin_profile,
            commands::set_cape,
            commands::list_skins,
            commands::delete_skin,
            commands::apply_saved_skin,
            commands::upload_skin,
            commands::apply_preset,
            commands::update_skin,
            commands::replace_skin_texture,
            commands::import_skin,
            commands::rename_skin,
            commands::export_skin,
            commands::update_block_reason,
            commands::list_worlds,
            commands::world_icon,
            commands::delete_world,
            commands::list_datapacks,
            commands::set_datapack_enabled,
            commands::remove_datapack,
            commands::install_datapack,
            commands::list_servers,
            commands::save_servers,
            commands::ping_server,
            commands::toggle_star,
            commands::export_modpack,
            commands::backup_world,
            commands::list_world_backups,
            commands::export_world,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Brassworks Launcher");
}
