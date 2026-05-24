use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Site {
    pub id: String,
    pub url: String,
    pub name: String,
    pub check_interval_secs: u32,
    pub expected_status: u16,
    pub ssl_check: bool,
    pub keyword_check: Option<String>,
    pub keyword_present: Option<bool>,
    pub timeout_secs: u32,
    pub tags: Vec<String>,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckResult {
    pub id: String,
    pub site_id: String,
    pub checked_at: String,
    pub status: String, // "UP", "DOWN", "WARNING", "UNKNOWN"
    pub status_code: Option<u16>,
    pub response_time_ms: Option<u32>,
    pub ssl_valid: Option<bool>,
    pub ssl_expiry_date: Option<String>,
    pub ssl_days_remaining: Option<i32>,
    pub error_message: Option<String>,
    pub redirect_url: Option<String>,
    pub domain_expiry_date: Option<String>,
    pub domain_days_remaining: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteWithStatus {
    #[serde(flatten)]
    pub site: Site,
    pub latest_result: Option<CheckResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub launch_at_startup: bool,
    pub global_check_interval: u32,
    pub request_timeout: u32,
    pub ssl_warning_threshold: u32,
    pub response_time_warning: u32,
    pub history_retention: u32,
    pub theme: String,
    pub notification_cooldown: u32,
    pub user_agent: String,
}

pub fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    path.push("sitewatcher.db");
    Ok(path)
}

pub fn establish_connection(app: &AppHandle) -> Result<Connection, String> {
    let db_path = get_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    init_db(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;", [])?;

    // Create tables
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sites (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            name TEXT NOT NULL,
            check_interval_secs INTEGER NOT NULL,
            expected_status INTEGER NOT NULL,
            ssl_check INTEGER NOT NULL,
            keyword_check TEXT,
            keyword_present INTEGER,
            timeout_secs INTEGER NOT NULL,
            tags TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS check_results (
            id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            checked_at TEXT NOT NULL,
            status TEXT NOT NULL,
            status_code INTEGER,
            response_time_ms INTEGER,
            ssl_valid INTEGER,
            ssl_expiry_date TEXT,
            ssl_days_remaining INTEGER,
            error_message TEXT,
            redirect_url TEXT,
            domain_expiry_date TEXT,
            domain_days_remaining INTEGER,
            FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
        );",
        [],
    )?;

    // Perform database migrations for existing check_results tables
    let _ = conn.execute("ALTER TABLE check_results ADD COLUMN domain_expiry_date TEXT;", []);
    let _ = conn.execute("ALTER TABLE check_results ADD COLUMN domain_days_remaining INTEGER;", []);

    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
        [],
    )?;

    // Set default settings if not exists
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM settings",
        [],
        |row| row.get(0),
    )?;

    if count == 0 {
        let defaults = [
            ("launch_at_startup", "true"),
            ("global_check_interval", "300"),
            ("request_timeout", "10"),
            ("ssl_warning_threshold", "30"),
            ("response_time_warning", "2000"),
            ("history_retention", "30"),
            ("theme", "system"),
            ("notification_cooldown", "900"),
            ("user_agent", "SiteWatcher/1.0"),
        ];
        for &(key, val) in &defaults {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                params![key, val],
            )?;
        }
    }

    Ok(())
}

pub fn get_sites(conn: &Connection) -> Result<Vec<SiteWithStatus>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT 
            id, url, name, check_interval_secs, expected_status, ssl_check, 
            keyword_check, keyword_present, timeout_secs, tags, enabled, created_at
         FROM sites ORDER BY created_at DESC",
    )?;

    let site_iter = stmt.query_map([], |row| {
        let tags_str: String = row.get(9)?;
        let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();

        Ok(Site {
            id: row.get(0)?,
            url: row.get(1)?,
            name: row.get(2)?,
            check_interval_secs: row.get(3)?,
            expected_status: row.get(4)?,
            ssl_check: row.get::<_, i32>(5)? == 1,
            keyword_check: row.get(6)?,
            keyword_present: row.get::<_, Option<i32>>(7)?.map(|n| n == 1),
            timeout_secs: row.get(8)?,
            tags,
            enabled: row.get::<_, i32>(10)? == 1,
            created_at: row.get(11)?,
        })
    })?;

    let mut sites_with_status = Vec::new();
    for site_res in site_iter {
        let site = site_res?;
        // Query the latest check result for this site
        let latest_result = conn.query_row(
            "SELECT 
                id, site_id, checked_at, status, status_code, response_time_ms, 
                ssl_valid, ssl_expiry_date, ssl_days_remaining, error_message, redirect_url,
                domain_expiry_date, domain_days_remaining
             FROM check_results 
             WHERE site_id = ?1 
             ORDER BY checked_at DESC LIMIT 1",
            params![site.id],
            |row| {
                Ok(CheckResult {
                    id: row.get(0)?,
                    site_id: row.get(1)?,
                    checked_at: row.get(2)?,
                    status: row.get(3)?,
                    status_code: row.get(4)?,
                    response_time_ms: row.get(5)?,
                    ssl_valid: row.get::<_, Option<i32>>(6)?.map(|n| n == 1),
                    ssl_expiry_date: row.get(7)?,
                    ssl_days_remaining: row.get(8)?,
                    error_message: row.get(9)?,
                    redirect_url: row.get(10)?,
                    domain_expiry_date: row.get(11)?,
                    domain_days_remaining: row.get(12)?,
                })
            },
        ).optional()?;

        sites_with_status.push(SiteWithStatus { site, latest_result });
    }

    Ok(sites_with_status)
}

pub fn get_site(conn: &Connection, id: &str) -> Result<Option<Site>, rusqlite::Error> {
    conn.query_row(
        "SELECT 
            id, url, name, check_interval_secs, expected_status, ssl_check, 
            keyword_check, keyword_present, timeout_secs, tags, enabled, created_at
         FROM sites WHERE id = ?1",
        params![id],
        |row| {
            let tags_str: String = row.get(9)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(Site {
                id: row.get(0)?,
                url: row.get(1)?,
                name: row.get(2)?,
                check_interval_secs: row.get(3)?,
                expected_status: row.get(4)?,
                ssl_check: row.get::<_, i32>(5)? == 1,
                keyword_check: row.get(6)?,
                keyword_present: row.get::<_, Option<i32>>(7)?.map(|n| n == 1),
                timeout_secs: row.get(8)?,
                tags,
                enabled: row.get::<_, i32>(10)? == 1,
                created_at: row.get(11)?,
            })
        },
    ).optional()
}

pub fn add_site(conn: &Connection, site: &Site) -> Result<(), rusqlite::Error> {
    let tags_str = serde_json::to_string(&site.tags).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO sites (
            id, url, name, check_interval_secs, expected_status, ssl_check, 
            keyword_check, keyword_present, timeout_secs, tags, enabled, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            site.id,
            site.url,
            site.name,
            site.check_interval_secs,
            site.expected_status,
            if site.ssl_check { 1 } else { 0 },
            site.keyword_check,
            site.keyword_present.map(|v| if v { 1 } else { 0 }),
            site.timeout_secs,
            tags_str,
            if site.enabled { 1 } else { 0 },
            site.created_at,
        ],
    )?;
    Ok(())
}

pub fn update_site(conn: &Connection, site: &Site) -> Result<(), rusqlite::Error> {
    let tags_str = serde_json::to_string(&site.tags).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "UPDATE sites SET 
            url = ?1, 
            name = ?2, 
            check_interval_secs = ?3, 
            expected_status = ?4, 
            ssl_check = ?5, 
            keyword_check = ?6, 
            keyword_present = ?7, 
            timeout_secs = ?8, 
            tags = ?9, 
            enabled = ?10 
         WHERE id = ?11",
        params![
            site.url,
            site.name,
            site.check_interval_secs,
            site.expected_status,
            if site.ssl_check { 1 } else { 0 },
            site.keyword_check,
            site.keyword_present.map(|v| if v { 1 } else { 0 }),
            site.timeout_secs,
            tags_str,
            if site.enabled { 1 } else { 0 },
            site.id,
        ],
    )?;
    Ok(())
}

pub fn delete_site(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM sites WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_site_history(
    conn: &Connection,
    site_id: &str,
    limit: u32,
) -> Result<Vec<CheckResult>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT 
            id, site_id, checked_at, status, status_code, response_time_ms, 
            ssl_valid, ssl_expiry_date, ssl_days_remaining, error_message, redirect_url,
            domain_expiry_date, domain_days_remaining
         FROM check_results 
         WHERE site_id = ?1 
         ORDER BY checked_at DESC LIMIT ?2",
    )?;

    let iter = stmt.query_map(params![site_id, limit], |row| {
        Ok(CheckResult {
            id: row.get(0)?,
            site_id: row.get(1)?,
            checked_at: row.get(2)?,
            status: row.get(3)?,
            status_code: row.get(4)?,
            response_time_ms: row.get(5)?,
            ssl_valid: row.get::<_, Option<i32>>(6)?.map(|n| n == 1),
            ssl_expiry_date: row.get(7)?,
            ssl_days_remaining: row.get(8)?,
            error_message: row.get(9)?,
            redirect_url: row.get(10)?,
            domain_expiry_date: row.get(11)?,
            domain_days_remaining: row.get(12)?,
        })
    })?;

    let mut results = Vec::new();
    for res in iter {
        results.push(res?);
    }
    Ok(results)
}

pub fn add_check_result(conn: &Connection, result: &CheckResult) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO check_results (
            id, site_id, checked_at, status, status_code, response_time_ms, 
            ssl_valid, ssl_expiry_date, ssl_days_remaining, error_message, redirect_url,
            domain_expiry_date, domain_days_remaining
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            result.id,
            result.site_id,
            result.checked_at,
            result.status,
            result.status_code,
            result.response_time_ms,
            result.ssl_valid.map(|v| if v { 1 } else { 0 }),
            result.ssl_expiry_date,
            result.ssl_days_remaining,
            result.error_message,
            result.redirect_url,
            result.domain_expiry_date,
            result.domain_days_remaining,
        ],
    )?;
    Ok(())
}

pub fn get_settings(conn: &Connection) -> Result<Settings, rusqlite::Error> {
    let get_val = |k: &str| -> Result<String, rusqlite::Error> {
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![k],
            |row| row.get(0),
        )
    };

    Ok(Settings {
        launch_at_startup: get_val("launch_at_startup")? == "true",
        global_check_interval: get_val("global_check_interval")?
            .parse()
            .unwrap_or(300),
        request_timeout: get_val("request_timeout")?.parse().unwrap_or(10),
        ssl_warning_threshold: get_val("ssl_warning_threshold")?.parse().unwrap_or(30),
        response_time_warning: get_val("response_time_warning")?.parse().unwrap_or(2000),
        history_retention: get_val("history_retention")?.parse().unwrap_or(30),
        theme: get_val("theme").unwrap_or_else(|_| "system".to_string()),
        notification_cooldown: get_val("notification_cooldown")?.parse().unwrap_or(900),
        user_agent: get_val("user_agent").unwrap_or_else(|_| "SiteWatcher/1.0".to_string()),
    })
}

pub fn update_settings(conn: &Connection, settings: &Settings) -> Result<(), rusqlite::Error> {
    let set_val = |k: &str, v: &str| -> Result<(), rusqlite::Error> {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![k, v],
        )?;
        Ok(())
    };

    set_val("launch_at_startup", if settings.launch_at_startup { "true" } else { "false" })?;
    set_val("global_check_interval", &settings.global_check_interval.to_string())?;
    set_val("request_timeout", &settings.request_timeout.to_string())?;
    set_val("ssl_warning_threshold", &settings.ssl_warning_threshold.to_string())?;
    set_val("response_time_warning", &settings.response_time_warning.to_string())?;
    set_val("history_retention", &settings.history_retention.to_string())?;
    set_val("theme", &settings.theme)?;
    set_val("notification_cooldown", &settings.notification_cooldown.to_string())?;
    set_val("user_agent", &settings.user_agent)?;

    Ok(())
}

pub fn purge_old_history(
    conn: &Connection,
    retention_days: u32,
) -> Result<usize, rusqlite::Error> {
    // Delete results where checked_at is older than retention_days
    let query = "DELETE FROM check_results WHERE datetime(checked_at) < datetime('now', '-' || ?1 || ' days')";
    let count = conn.execute(query, params![retention_days])?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_db_init_and_crud() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        let test_site = Site {
            id: "test-id-123".to_string(),
            url: "https://example.com".to_string(),
            name: "Example".to_string(),
            check_interval_secs: 300,
            expected_status: 200,
            ssl_check: true,
            keyword_check: None,
            keyword_present: None,
            timeout_secs: 10,
            tags: vec!["prod".to_string()],
            enabled: true,
            created_at: "2026-05-24T00:00:00Z".to_string(),
        };

        add_site(&conn, &test_site).unwrap();

        let retrieved = get_site(&conn, "test-id-123").unwrap().unwrap();
        assert_eq!(retrieved.name, "Example");
        assert_eq!(retrieved.url, "https://example.com");
        assert_eq!(retrieved.ssl_check, true);
        assert_eq!(retrieved.tags, vec!["prod".to_string()]);

        // Update site test
        let mut updated_site = retrieved.clone();
        updated_site.name = "Updated Example".to_string();
        updated_site.url = "https://updated-example.com".to_string();
        update_site(&conn, &updated_site).unwrap();

        let retrieved_updated = get_site(&conn, "test-id-123").unwrap().unwrap();
        assert_eq!(retrieved_updated.name, "Updated Example");
        assert_eq!(retrieved_updated.url, "https://updated-example.com");

        let sites_with_status = get_sites(&conn).unwrap();
        assert_eq!(sites_with_status.len(), 1);
        assert_eq!(sites_with_status[0].site.id, "test-id-123");
        assert!(sites_with_status[0].latest_result.is_none());

        // Delete site test
        delete_site(&conn, "test-id-123").unwrap();
        assert!(get_site(&conn, "test-id-123").unwrap().is_none());
    }

    #[test]
    fn test_settings_crud() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        // Get default settings
        let settings = get_settings(&conn).unwrap();
        assert_eq!(settings.launch_at_startup, true);
        assert_eq!(settings.global_check_interval, 300);
        assert_eq!(settings.theme, "system");

        // Update settings
        let updated_settings = Settings {
            launch_at_startup: false,
            global_check_interval: 60,
            request_timeout: 5,
            ssl_warning_threshold: 15,
            response_time_warning: 1000,
            history_retention: 7,
            theme: "dark".to_string(),
            notification_cooldown: 300,
            user_agent: "TestAgent/2.0".to_string(),
        };
        update_settings(&conn, &updated_settings).unwrap();

        // Verify updated settings
        let retrieved = get_settings(&conn).unwrap();
        assert_eq!(retrieved.launch_at_startup, false);
        assert_eq!(retrieved.global_check_interval, 60);
        assert_eq!(retrieved.request_timeout, 5);
        assert_eq!(retrieved.ssl_warning_threshold, 15);
        assert_eq!(retrieved.response_time_warning, 1000);
        assert_eq!(retrieved.history_retention, 7);
        assert_eq!(retrieved.theme, "dark");
        assert_eq!(retrieved.notification_cooldown, 300);
        assert_eq!(retrieved.user_agent, "TestAgent/2.0");
    }

    #[test]
    fn test_check_results_and_purging() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        let test_site = Site {
            id: "site-1".to_string(),
            url: "https://example.com".to_string(),
            name: "Example".to_string(),
            check_interval_secs: 300,
            expected_status: 200,
            ssl_check: true,
            keyword_check: None,
            keyword_present: None,
            timeout_secs: 10,
            tags: vec![],
            enabled: true,
            created_at: "2026-05-24T00:00:00Z".to_string(),
        };
        add_site(&conn, &test_site).unwrap();

        // Add check results with different timestamps
        let res1 = CheckResult {
            id: "res-1".to_string(),
            site_id: "site-1".to_string(),
            checked_at: "2026-05-24T10:00:00Z".to_string(),
            status: "UP".to_string(),
            status_code: Some(200),
            response_time_ms: Some(150),
            ssl_valid: Some(true),
            ssl_expiry_date: None,
            ssl_days_remaining: None,
            error_message: None,
            redirect_url: None,
            domain_expiry_date: None,
            domain_days_remaining: None,
        };
        add_check_result(&conn, &res1).unwrap();

        // Verify latest status fetch
        let sites = get_sites(&conn).unwrap();
        assert_eq!(sites.len(), 1);
        let latest = sites[0].latest_result.as_ref().unwrap();
        assert_eq!(latest.id, "res-1");
        assert_eq!(latest.status, "UP");

        let res2 = CheckResult {
            id: "res-2".to_string(),
            site_id: "site-1".to_string(),
            checked_at: "2026-05-24T11:00:00Z".to_string(), // later timestamp
            status: "DOWN".to_string(),
            status_code: Some(500),
            response_time_ms: Some(100),
            ssl_valid: Some(true),
            ssl_expiry_date: None,
            ssl_days_remaining: None,
            error_message: Some("Internal Server Error".to_string()),
            redirect_url: None,
            domain_expiry_date: None,
            domain_days_remaining: None,
        };
        add_check_result(&conn, &res2).unwrap();

        // Verify latest status is now res-2
        let sites = get_sites(&conn).unwrap();
        let latest = sites[0].latest_result.as_ref().unwrap();
        assert_eq!(latest.id, "res-2");
        assert_eq!(latest.status, "DOWN");

        // Verify history listing
        let history = get_site_history(&conn, "site-1", 10).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, "res-2"); // ordered desc by checked_at
        assert_eq!(history[1].id, "res-1");

        // Test purging old history
        // Let's insert a result that is 5 days old
        // We'll calculate the date dynamically so datetime('now') works correctly in tests
        let old_date = (chrono::Utc::now() - chrono::Duration::days(5)).to_rfc3339();
        let res_old = CheckResult {
            id: "res-old".to_string(),
            site_id: "site-1".to_string(),
            checked_at: old_date,
            status: "UP".to_string(),
            status_code: Some(200),
            response_time_ms: Some(120),
            ssl_valid: Some(true),
            ssl_expiry_date: None,
            ssl_days_remaining: None,
            error_message: None,
            redirect_url: None,
            domain_expiry_date: None,
            domain_days_remaining: None,
        };
        add_check_result(&conn, &res_old).unwrap();

        let history_before = get_site_history(&conn, "site-1", 10).unwrap();
        assert_eq!(history_before.len(), 3);

        // Purge with retention of 3 days (should delete res_old)
        let purged_count = purge_old_history(&conn, 3).unwrap();
        assert_eq!(purged_count, 1);

        let history_after = get_site_history(&conn, "site-1", 10).unwrap();
        assert_eq!(history_after.len(), 2);
        assert!(history_after.iter().all(|r| r.id != "res-old"));
    }
}

