use crate::db::{self, CheckResult, Settings, Site, SiteWithStatus};
use crate::checker::{self, run_single_check};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[tauri::command]
pub async fn get_sites(app: AppHandle) -> Result<Vec<SiteWithStatus>, String> {
    let conn = db::establish_connection(&app)?;
    db::get_sites(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_site(app: AppHandle, mut site: Site) -> Result<Site, String> {
    let conn = db::establish_connection(&app)?;
    if site.id.is_empty() {
        site.id = Uuid::new_v4().to_string();
    }
    if site.created_at.is_empty() {
        site.created_at = chrono::Utc::now().to_rfc3339();
    }
    db::add_site(&conn, &site).map_err(|e| e.to_string())?;
    
    // Trigger an immediate check in the background
    let app_clone = app.clone();
    let site_clone = site.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(conn) = db::establish_connection(&app_clone) {
            let settings = db::get_settings(&conn).unwrap_or_else(|_| db::Settings {
                launch_at_startup: true,
                global_check_interval: 300,
                request_timeout: 10,
                ssl_warning_threshold: 30,
                response_time_warning: 2000,
                history_retention: 30,
                theme: "system".to_string(),
                notification_cooldown: 900,
                user_agent: "SiteWatcher/1.0".to_string(),
            });
            let res = run_single_check(
                &site_clone,
                &settings.user_agent,
                settings.response_time_warning,
                settings.ssl_warning_threshold,
                None,
            ).await;
            let _ = db::add_check_result(&conn, &res);
            let _ = app_clone.emit("site-status-changed", &res);
            checker::update_tray_icon(&app_clone, &conn);
        }
    });

    Ok(site)
}

#[tauri::command]
pub async fn update_site(app: AppHandle, site: Site) -> Result<Site, String> {
    let conn = db::establish_connection(&app)?;
    db::update_site(&conn, &site).map_err(|e| e.to_string())?;
    
    // Trigger check of the updated site
    let app_clone = app.clone();
    let site_clone = site.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(conn) = db::establish_connection(&app_clone) {
            let settings = db::get_settings(&conn).unwrap_or_else(|_| db::Settings {
                launch_at_startup: true,
                global_check_interval: 300,
                request_timeout: 10,
                ssl_warning_threshold: 30,
                response_time_warning: 2000,
                history_retention: 30,
                theme: "system".to_string(),
                notification_cooldown: 900,
                user_agent: "SiteWatcher/1.0".to_string(),
            });
            let res = run_single_check(
                &site_clone,
                &settings.user_agent,
                settings.response_time_warning,
                settings.ssl_warning_threshold,
                None,
            ).await;
            let _ = db::add_check_result(&conn, &res);
            let _ = app_clone.emit("site-status-changed", &res);
            checker::update_tray_icon(&app_clone, &conn);
        }
    });

    Ok(site)
}

#[tauri::command]
pub async fn delete_site(app: AppHandle, id: String) -> Result<(), String> {
    println!("[Rust] delete_site command called with ID: {}", id);
    let conn = db::establish_connection(&app)?;
    println!("[Rust] Database connection established for deletion");
    match db::delete_site(&conn, &id) {
        Ok(_) => {
            println!("[Rust] Site successfully deleted from database");
        }
        Err(e) => {
            println!("[Rust] SQLite delete failed: {}", e);
            return Err(e.to_string());
        }
    }
    checker::update_tray_icon(&app, &conn);
    Ok(())
}

#[tauri::command]
pub async fn get_site_history(
    app: AppHandle,
    site_id: String,
    limit: u32,
) -> Result<Vec<CheckResult>, String> {
    let conn = db::establish_connection(&app)?;
    db::get_site_history(&conn, &site_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let conn = db::establish_connection(&app)?;
    db::get_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let conn = db::establish_connection(&app)?;
    db::update_settings(&conn, &settings).map_err(|e| e.to_string())?;
    
    // Toggle autostart depending on setting
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        
        let autostart_manager = app.autolaunch();
        if settings.launch_at_startup {
            let _ = autostart_manager.enable();
        } else {
            let _ = autostart_manager.disable();
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn trigger_check(app: AppHandle, id: String) -> Result<CheckResult, String> {
    let conn = db::establish_connection(&app)?;
    let site = db::get_site(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Site not found".to_string())?;
    
    let settings = db::get_settings(&conn).unwrap_or_else(|_| db::Settings {
        launch_at_startup: true,
        global_check_interval: 300,
        request_timeout: 10,
        ssl_warning_threshold: 30,
        response_time_warning: 2000,
        history_retention: 30,
        theme: "system".to_string(),
        notification_cooldown: 900,
        user_agent: "SiteWatcher/1.0".to_string(),
    });

    let prev_res = db::get_sites(&conn).ok()
        .and_then(|sites| sites.into_iter().find(|s| s.site.id == id))
        .and_then(|s| s.latest_result);

    let res = run_single_check(
        &site,
        &settings.user_agent,
        settings.response_time_warning,
        settings.ssl_warning_threshold,
        prev_res,
    ).await;

    db::add_check_result(&conn, &res).map_err(|e| e.to_string())?;
    let _ = app.emit("site-status-changed", &res);
    checker::update_tray_icon(&app, &conn);

    Ok(res)
}

#[tauri::command]
pub async fn test_connection(
    app: AppHandle,
    url: String,
    expected_status: u16,
    ssl_check: bool,
    keyword_check: Option<String>,
    keyword_present: Option<bool>,
    timeout_secs: u32,
) -> Result<CheckResult, String> {
    let conn = db::establish_connection(&app)?;
    let settings = db::get_settings(&conn).unwrap_or_else(|_| db::Settings {
        launch_at_startup: true,
        global_check_interval: 300,
        request_timeout: 10,
        ssl_warning_threshold: 30,
        response_time_warning: 2000,
        history_retention: 30,
        theme: "system".to_string(),
        notification_cooldown: 900,
        user_agent: "SiteWatcher/1.0".to_string(),
    });

    // Create a temporary site config
    let temp_site = Site {
        id: "test".to_string(),
        url,
        name: "Test Connection".to_string(),
        check_interval_secs: 300,
        expected_status,
        ssl_check,
        keyword_check,
        keyword_present,
        timeout_secs,
        tags: vec![],
        enabled: true,
        created_at: "".to_string(),
    };

    let res = run_single_check(
        &temp_site,
        &settings.user_agent,
        settings.response_time_warning,
        settings.ssl_warning_threshold,
        None,
    ).await;

    Ok(res)
}
