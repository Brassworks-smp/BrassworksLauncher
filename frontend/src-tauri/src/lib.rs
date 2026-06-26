
mod auth_window;
mod commands;
mod discord;
mod state;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use brassworks_core::Launcher;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};

use discord::Discord;
use state::AppState;

fn reveal_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn is_packwiz_scheme(s: &str) -> bool {
    s.len() >= 13 && s[..13].eq_ignore_ascii_case("brassworks://")
}

fn packwiz_open_from_argv(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| {
            is_packwiz_scheme(a)
                || (a.to_lowercase().ends_with(".packwiz") && std::path::Path::new(a).is_file())
        })
        .cloned()
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn packwiz_open_from_url(raw: &str) -> Option<String> {
    if is_packwiz_scheme(raw) {
        return Some(raw.to_string());
    }
    let path = raw.strip_prefix("file://").unwrap_or(raw);
    let decoded = path.replace("%20", " ");
    if decoded.to_lowercase().ends_with(".packwiz") && std::path::Path::new(&decoded).is_file() {
        Some(decoded)
    } else {
        None
    }
}

fn command_from_argv(args: &[String]) -> Option<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut started = false;
    for a in args.iter().skip(1) {
        if !started && a.starts_with('-') {
            continue;
        }
        started = true;
        tokens.push(a.clone());
    }
    let joined = tokens.join(" ");
    let trimmed = joined.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn print_cli_help() {
    println!(
        "Brassworks Launcher - command-line interface

USAGE:
    brassworks <command> [arguments]
    brassworks help | --version

Runs a launcher command. If the app is already open the command is sent to that
window; otherwise the app starts and runs it once ready. Quote multi-word
arguments, e.g. brassworks \"world backup My Base\".

COMMANDS:
  Navigate
    go <view>                                navigate (play, instances, mods, worlds, servers, skin, screenshots, settings)

  Instance
    instance list                            show all instances
    instance launch <name> [--world W] [--server S]   launch (optionally into a world/server)
    instance stop <name>                     stop a running instance
    instance select <name>                   switch to an instance
    instance create                          add a new instance
    instance delete <name>                   delete an instance
    instance open <name>                     open the game folder
    instance info <name>                     show instance details
    instance set <name> <key> <value>        change an instance setting

  Content
    content list                             show installed content
    content search <query> [--source S]      search for mods
    content install <query> [--source S]     install the top match
    content remove <name>                    remove installed content
    content enable <name>                    enable a mod
    content disable <name>                   disable a mod
    content update-all                       update all added content

  Modpack
    modpack status                           show modpack status
    modpack sync                             sync / update the modpack
    modpack repair                           repair the modpack files
    modpack reinstall                        reinstall from scratch
    modpack lock | unlock                    lock / unlock the modpack
    modpack export <packwiz|modrinth|curseforge>  export to Downloads

  World
    world list                               show singleplayer worlds
    world play <name>                        launch directly into a world
    world backup <name>                      back up a world
    world delete <name>                      delete a world

  Server
    server list                              show saved servers
    server join <name>                       launch and join a server
    server ping <name>                       ping a server

  Skin
    skin list                                show saved skins
    skin apply <name>                        apply a saved skin
    skin delete <name>                       delete a saved skin
    skin cape <name|none>                    equip a cape

  Account
    account list                             show accounts
    account select <name>                    switch active account
    account login                            sign in with Microsoft
    account remove <name>                    remove an account

  Settings
    settings set <key> <value>               change a launcher setting
    settings get <key>                       read a launcher setting
    theme <name>                             set the theme
    accent <hex|default>                     set the accent color

  Launcher
    app check-update                         check for a launcher update
    app update                               download and install the update
    app restart                              restart the launcher
    app about                                about Brassworks Launcher
    app view-log                             open the log viewer
    app upload-log                           upload the latest log to mclo.gs
    app install-cli                          install this command-line tool
    app version                              print the launcher version

  Help
    help [area]                              browse every command

Open the app and press {} K, then type / to browse every command with
autocomplete, or run `brassworks help` again any time.",
        if cfg!(target_os = "macos") { "Cmd" } else { "Ctrl" }
    );
}

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

/// Build the native application menu (macOS menu bar / Linux window menu). The
/// "About" item and the Go-menu navigation entries emit `menu://action` events to
/// the webview so the frontend can react (open About, switch tab, etc.). Edit and
/// Window menus use predefined items so standard shortcuts (copy/paste/minimise)
/// behave natively.
/// Build the full native menu. `pinned` is a list of (command-path, label)
/// pairs surfaced under a "Commands" submenu so pinned palette commands can be
/// run straight from the menu bar; each emits `menu://action` with a `cmd:` id.
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) fn build_menu(
    app: &tauri::AppHandle,
    pinned: &[(String, String)],
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};

    let app_menu = SubmenuBuilder::new(app, "Brassworks")
        .text("about", "About Brassworks Launcher")
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let go_menu = SubmenuBuilder::new(app, "Go")
        .text("nav-play", "Play")
        .text("nav-instances", "Instances")
        .text("nav-mods", "Content")
        .text("nav-worlds", "Worlds")
        .text("nav-servers", "Servers")
        .text("nav-skin", "Skins")
        .text("nav-screenshots", "Screenshots")
        .text("nav-settings", "Settings")
        .separator()
        .text("palette", "Command Palette…")
        .text("add-instance", "Add Instance…")
        .text("view-log", "View Last Log")
        .build()?;

    let mut commands = SubmenuBuilder::new(app, "Commands");
    if pinned.is_empty() {
        commands = commands.item(&MenuItem::with_id(
            app,
            "cmd-none",
            "No pinned commands",
            false,
            None::<&str>,
        )?);
    } else {
        for (path, label) in pinned {
            commands = commands.item(&MenuItem::with_id(
                app,
                format!("cmd:{path}"),
                label,
                true,
                None::<&str>,
            )?);
        }
    }
    let commands_menu = commands.build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &go_menu, &commands_menu, &window_menu])
        .build()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn setup_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, &[])?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if id.starts_with("cmd:")
            || matches!(
                id,
                "about"
                    | "palette"
                    | "add-instance"
                    | "view-log"
                    | "nav-play"
                    | "nav-instances"
                    | "nav-mods"
                    | "nav-worlds"
                    | "nav-servers"
                    | "nav-skin"
                    | "nav-screenshots"
                    | "nav-settings"
            )
        {
            let _ = app.emit("menu://action", id.to_string());
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    if let Some(first) = std::env::args().nth(1) {
        if matches!(first.as_str(), "help" | "--help" | "-h") {
            print_cli_help();
            return;
        }
        if matches!(first.as_str(), "--version" | "-V" | "version") {
            println!("Brassworks Launcher {}", env!("CARGO_PKG_VERSION"));
            return;
        }
    }

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            reveal_main(app);
            if let Some(open) = packwiz_open_from_argv(&argv) {
                let _ = app.emit("packwiz://open", open);
            } else if let Some(cmd) = command_from_argv(&argv) {
                let _ = app.emit("cli://command", cmd);
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init());

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
                let discord = discord.clone();
                std::thread::spawn(move || discord.set_idle());
            }

            let cold_args = std::env::args().collect::<Vec<_>>();
            let cold_open = packwiz_open_from_argv(&cold_args);
            let cold_cli = if cold_open.is_some() {
                None
            } else {
                command_from_argv(&cold_args)
            };

            app.manage(AppState {
                launcher,
                running: Arc::new(Mutex::new(HashSet::new())),
                children: Arc::new(Mutex::new(HashMap::new())),
                cancels: Arc::new(Mutex::new(HashMap::new())),
                discord,
                pending_cli: Arc::new(Mutex::new(cold_cli)),
                pending_open: Arc::new(Mutex::new(cold_open)),
                frontend_ready: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            });

            setup_tray(app.handle())?;

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            #[cfg(any(target_os = "macos", target_os = "linux"))]
            setup_menu(app.handle())?;

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
            commands::import_instance_branding,
            commands::get_settings,
            commands::save_settings,
            commands::default_settings,
            commands::featured_packs,
            commands::get_accounts,
            commands::select_account,
            commands::remove_account,
            commands::account_status,
            commands::add_offline_account,
            commands::clear_ms_login_cookies,
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
            commands::tail_log,
            commands::upload_log,
            commands::open_dir,
            commands::java_info,
            commands::cache_size,
            commands::clear_cache,
            commands::cache_images,
            commands::cached_image,
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
            commands::extract_packwiz_pack,
            commands::inspect_packwiz_flavors,
            commands::set_packwiz_flavors,
            commands::list_packwiz_branches,
            commands::switch_packwiz_branch,
            commands::scan_importable,
            commands::import_external,
            commands::minecraft_versions,
            commands::loader_versions,
            commands::supported_loaders,
            commands::search_modpacks,
            commands::modpack_versions,
            commands::install_modpack,
            commands::install_modpack_file,
            commands::preflight_modpack,
            commands::preflight_modpack_file,
            commands::scan_manual_mods,
            commands::validate_manual_mod,
            commands::default_download_dir,
            commands::inspect_packwiz,
            commands::update_modpack,
            commands::open_instance_dir,
            commands::reveal_path,
            commands::delete_java_runtime,
            commands::list_java_runtimes,
            commands::download_java,
            commands::skin_profile,
            commands::set_cape,
            commands::list_skins,
            commands::seed_current_skin,
            commands::delete_skin,
            commands::apply_saved_skin,
            commands::create_preset,
            commands::update_preset,
            commands::duplicate_skin,
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
            commands::export_tree,
            commands::export_modpack_selected,
            commands::list_export_configs,
            commands::save_export_config,
            commands::delete_export_config,
            commands::run_export_config,
            commands::unsup_public_key,
            commands::regenerate_unsup_key,
            commands::github_connect,
            commands::github_token_present,
            commands::github_remembered,
            commands::github_disconnect,
            commands::publish_pack,
            commands::relink_share,
            commands::sync_from_shared,
            commands::share_pending_changes,
            commands::share_link,
            commands::write_share_file,
            commands::disconnect_share,
            commands::share_params,
            commands::set_share_params,
            commands::share_repo_info,
            commands::share_diff,
            commands::backup_world,
            commands::list_world_backups,
            commands::export_world,
            commands::cli_ready,
            commands::install_cli,
            commands::uninstall_cli,
            commands::cli_status,
            commands::set_menu_commands,
            commands::resolve_packwiz_share,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Brassworks Launcher")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let opens: Vec<String> = urls
                    .iter()
                    .filter_map(|u| packwiz_open_from_url(u.as_str()))
                    .collect();
                if let Some(file) = opens.into_iter().next() {
                    reveal_main(app);
                    if let Some(slot) = app.try_state::<AppState>() {
                        if let Ok(mut pending) = slot.pending_open.lock() {
                            if slot.frontend_ready.load(std::sync::atomic::Ordering::Relaxed) {
                                let _ = app.emit("packwiz://open", file);
                            } else {
                                *pending = Some(file);
                            }
                        }
                    }
                }
            }
        });
}
