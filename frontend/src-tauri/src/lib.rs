//! Brassworks Launcher desktop app.
//!
//! This crate is basically the thing that connects the frontend to
//! `brassworks_core`. It uses Tauri commands to talk to the core crate
//! and sends updates back to the UI whenever stuff is happening.
//!
//! Most of the actual important code is in `brassworks_core`, so this
//! crate is kinda just the middleman.
//!
//! Files are split up like this:
//!
//! - [`state`] - shared app state and some helper stuff.
//! - [`auth_window`] - the Microsoft login window thing.
//! - [`commands`] - all the Tauri command functions.
//!
//! Nothing too crazy happens in here. Most of the heavy lifting is done
//! by the core crate.

mod auth_window;
mod commands;
mod discord;
mod state;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use brassworks_core::Launcher;
use tauri::Manager;

use discord::Discord;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            commands::set_modpack_locked,
            commands::read_log,
            commands::upload_log,
            commands::open_dir,
            commands::java_info,
            commands::cache_size,
            commands::clear_cache,
            commands::get_news,
            commands::get_playercount,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Brassworks Launcher");
}
