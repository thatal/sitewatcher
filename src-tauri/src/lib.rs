mod db;
mod checker;
mod commands;

use tauri::{Manager, Emitter};
use tauri::image::Image;
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};
use tauri_plugin_positioner::{WindowExt, Position};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_positioner::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Manage notifications and alert cooldown
            app.manage(checker::NotificationState {
                last_sent: std::sync::Mutex::new(std::collections::HashMap::new()),
            });

            // Initialize SQLite DB
            let conn = db::establish_connection(app.handle())?;
            checker::update_tray_icon(app.handle(), &conn);

            // Start checker engine loop!
            checker::start_checker(app.handle().clone());

            // Build system tray menu
            let tray_menu = Menu::with_items(app, &[
                &MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?,
                &MenuItem::with_id(app, "add_site", "Add Site", true, None::<&str>)?,
                &MenuItem::with_id(app, "pause_all", "Pause All Checks", true, None::<&str>)?,
                &MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?,
                &tauri::menu::PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
            ])?;

            let _tray = TrayIconBuilder::with_id("main")
                .icon(Image::from_bytes(include_bytes!("../icons/tray-gray.png"))?)
                .menu(&tray_menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "dashboard" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.emit("navigate", "dashboard");
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "add_site" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.emit("navigate", "add_site");
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "settings" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.emit("navigate", "settings");
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "pause_all" => {
                            let _ = app.emit("pause-all", ());
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Feed event to positioner plugin
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Down,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("popover") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.move_window(Position::TrayCenter);
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Hide main window initially in background
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.hide();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_sites,
            commands::add_site,
            commands::update_site,
            commands::delete_site,
            commands::get_site_history,
            commands::get_settings,
            commands::update_settings,
            commands::trigger_check,
            commands::test_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
