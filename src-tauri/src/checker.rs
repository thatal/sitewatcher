use crate::db::{self, CheckResult, Site, SiteWithStatus};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::{AppHandle, Manager, Emitter};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;
use x509_parser::prelude::*;

// Cooldown state for notification alert fatigue
pub struct NotificationState {
    pub last_sent: Mutex<HashMap<String, chrono::DateTime<Utc>>>,
}

// Statically include tray icon png bytes to bundle them in the binary
const ICON_GREEN: &[u8] = include_bytes!("../icons/tray-green.png");
const ICON_YELLOW: &[u8] = include_bytes!("../icons/tray-yellow.png");
const ICON_RED: &[u8] = include_bytes!("../icons/tray-red.png");
const ICON_GRAY: &[u8] = include_bytes!("../icons/tray-gray.png");

pub fn start_checker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;

            let conn = match db::establish_connection(&app) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Failed to connect to db in checker: {}", e);
                    continue;
                }
            };

            let sites = match db::get_sites(&conn) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Failed to fetch sites in checker: {}", e);
                    continue;
                }
            };

            let settings = match db::get_settings(&conn) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Failed to fetch settings in checker: {}", e);
                    continue;
                }
            };

            // Purge old history based on retention days setting
            let _ = db::purge_old_history(&conn, settings.history_retention);

            let now = Utc::now();

            for site_status in sites {
                let site = site_status.site;
                if !site.enabled {
                    continue;
                }

                // Check if it's time to run check
                let should_check = match site_status.latest_result {
                    None => true,
                    Some(ref res) => {
                        if let Ok(last_checked) = chrono::DateTime::parse_from_rfc3339(&res.checked_at) {
                            let last_checked_utc = last_checked.with_timezone(&Utc);
                            let secs_elapsed = now.signed_duration_since(last_checked_utc).num_seconds();
                            secs_elapsed >= site.check_interval_secs as i64
                        } else {
                            true
                        }
                    }
                };

                if should_check {
                    let app_clone = app.clone();
                    let site_clone = site.clone();
                    let user_agent = settings.user_agent.clone();
                    let cooldown = settings.notification_cooldown;
                    let response_time_warning = settings.response_time_warning;
                    let ssl_warning_threshold = settings.ssl_warning_threshold;
                    let prev_res = site_status.latest_result;
                    let prev_res_clone = prev_res.clone();

                    tauri::async_runtime::spawn(async move {
                        let res = run_single_check(
                            &site_clone,
                            &user_agent,
                            response_time_warning,
                            ssl_warning_threshold,
                            prev_res_clone,
                        )
                        .await;

                        if let Ok(conn) = db::establish_connection(&app_clone) {
                            if let Err(e) = db::add_check_result(&conn, &res) {
                                eprintln!("Failed to save check result: {}", e);
                            }

                            handle_notifications(&app_clone, &site_clone, &res, prev_res, cooldown);

                            let _ = app_clone.emit("site-status-changed", &res);

                            update_tray_icon(&app_clone, &conn);
                        }
                    });
                }
            }
        }
    });
}

pub fn determine_overall_status(sites: &[SiteWithStatus]) -> &'static str {
    let mut has_warnings = false;
    let mut has_downs = false;
    let mut has_enabled_sites = false;

    for site_status in sites {
        if site_status.site.enabled {
            has_enabled_sites = true;
            if let Some(ref res) = site_status.latest_result {
                if res.status == "DOWN" {
                    has_downs = true;
                } else if res.status == "WARNING" {
                    has_warnings = true;
                }
            }
        }
    }

    if has_enabled_sites {
        if has_downs {
            "DOWN"
        } else if has_warnings {
            "WARNING"
        } else {
            "UP"
        }
    } else {
        "UNKNOWN"
    }
}

pub fn update_tray_icon(app: &AppHandle, conn: &rusqlite::Connection) {
    if let Some(tray) = app.tray_by_id("main") {
        let sites = match db::get_sites(conn) {
            Ok(s) => s,
            Err(_) => return,
        };

        let overall_status = determine_overall_status(&sites);

        let image = match overall_status {
            "UP" => Image::from_bytes(ICON_GREEN),
            "WARNING" => Image::from_bytes(ICON_YELLOW),
            "DOWN" => Image::from_bytes(ICON_RED),
            _ => Image::from_bytes(ICON_GRAY),
        };

        if let Ok(img) = image {
            let _ = tray.set_icon(Some(img));
        }
    }
}

pub async fn run_single_check(
    site: &Site,
    user_agent: &str,
    response_time_warning: u32,
    ssl_warning_threshold: u32,
    prev_res: Option<CheckResult>,
) -> CheckResult {
    let id = Uuid::new_v4().to_string();
    let checked_at = Utc::now().to_rfc3339();

    let client_res = reqwest::Client::builder()
        .timeout(Duration::from_secs(site.timeout_secs as u64))
        .user_agent(user_agent)
        .tls_info(true)
        .build();

    let client = match client_res {
        Ok(c) => c,
        Err(e) => {
            return CheckResult {
                id,
                site_id: site.id.clone(),
                checked_at,
                status: "DOWN".to_string(),
                status_code: None,
                response_time_ms: None,
                ssl_valid: None,
                ssl_expiry_date: None,
                ssl_days_remaining: None,
                error_message: Some(format!("Failed to build HTTP client: {}", e)),
                redirect_url: None,
                domain_expiry_date: None,
                domain_days_remaining: None,
            };
        }
    };

    let start_time = Instant::now();
    let response_res = client.get(&site.url).send().await;
    let duration = start_time.elapsed();
    let response_time_ms = duration.as_millis() as u32;

    let response = match response_res {
        Ok(r) => r,
        Err(e) => {
            let error_msg = if e.is_timeout() {
                format!("Request timed out after {}s", site.timeout_secs)
            } else if e.is_connect() {
                "Connection refused or DNS resolution failed".to_string()
            } else {
                format!("Connection error: {}", e)
            };

            return CheckResult {
                id,
                site_id: site.id.clone(),
                checked_at,
                status: "DOWN".to_string(),
                status_code: None,
                response_time_ms: Some(response_time_ms),
                ssl_valid: None,
                ssl_expiry_date: None,
                ssl_days_remaining: None,
                error_message: Some(error_msg),
                redirect_url: None,
                domain_expiry_date: None,
                domain_days_remaining: None,
            };
        }
    };

    let status_code = response.status().as_u16();
    let final_url = response.url().to_string();
    let redirect_url = if final_url != site.url {
        Some(final_url)
    } else {
        None
    };

    let mut status = "UP".to_string();
    let mut error_message = None;

    if status_code != site.expected_status {
        status = "DOWN".to_string();
        error_message = Some(format!(
            "Unexpected status code: {} (expected {})",
            status_code, site.expected_status
        ));
    }

    // SSL Cert Verification
    let mut ssl_valid = None;
    let mut ssl_expiry_date = None;
    let mut ssl_days_remaining = None;

    if site.ssl_check && site.url.starts_with("https://") {
        if let Some(tls_info) = response.extensions().get::<reqwest::tls::TlsInfo>() {
            if let Some(cert_der) = tls_info.peer_certificate() {
                match get_cert_expiry(cert_der) {
                    Ok(expiry) => {
                        let now = Utc::now();
                        let days_rem = expiry.signed_duration_since(now).num_days() as i32;

                        ssl_expiry_date = Some(expiry.to_rfc3339());
                        ssl_days_remaining = Some(days_rem);

                        if days_rem <= 0 {
                            ssl_valid = Some(false);
                            if status == "UP" {
                                status = "DOWN".to_string();
                                error_message = Some("SSL certificate has expired".to_string());
                            }
                        } else {
                            ssl_valid = Some(true);
                            if status == "UP" && days_rem <= ssl_warning_threshold as i32 {
                                status = "WARNING".to_string();
                                error_message = Some(format!(
                                    "SSL certificate expires in {} days",
                                    days_rem
                                ));
                            }
                        }
                    }
                    Err(e) => {
                        ssl_valid = Some(false);
                        if status == "UP" {
                            status = "DOWN".to_string();
                            error_message = Some(format!("Failed to parse SSL certificate: {}", e));
                        }
                    }
                }
            } else {
                ssl_valid = Some(false);
                if status == "UP" {
                    status = "DOWN".to_string();
                    error_message = Some("SSL certificate details not available".to_string());
                }
            }
        } else {
            ssl_valid = Some(false);
            if status == "UP" {
                status = "DOWN".to_string();
                error_message = Some("TLS handshake info not available".to_string());
            }
        }
    }

    // Domain Expiry Check (RDAP lookup / Cache reuse)
    let mut domain_expiry_date = None;
    let mut domain_days_remaining = None;

    if let Some(domain) = extract_domain(&site.url) {
        let mut need_fetch = true;
        if let Some(ref prev) = prev_res {
            if let Some(ref expiry_str) = prev.domain_expiry_date {
                if let Ok(prev_checked) = chrono::DateTime::parse_from_rfc3339(&prev.checked_at) {
                    let diff_secs = Utc::now().signed_duration_since(prev_checked.with_timezone(&Utc)).num_seconds();
                    if diff_secs < 86400 { // 24 hours caching
                        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expiry_str) {
                            let now = Utc::now();
                            let days_rem = expiry.signed_duration_since(now).num_days() as i32;
                            domain_expiry_date = Some(expiry_str.clone());
                            domain_days_remaining = Some(days_rem);
                            need_fetch = false;
                        }
                    }
                }
            }
        }

        if need_fetch {
            if let Some(expiry) = get_domain_expiry(&domain, user_agent, site.timeout_secs as u64).await {
                let now = Utc::now();
                let days_rem = expiry.signed_duration_since(now).num_days() as i32;
                domain_expiry_date = Some(expiry.to_rfc3339());
                domain_days_remaining = Some(days_rem);
            }
        }
    }

    // Keyword Content Check
    if status == "UP" {
        if let Some(ref keyword) = site.keyword_check {
            if !keyword.is_empty() {
                let body_res = response.text().await;
                match body_res {
                    Ok(body) => {
                        let contains = body.contains(keyword);
                        let must_be_present = site.keyword_present.unwrap_or(true);

                        if must_be_present && !contains {
                            status = "DOWN".to_string();
                            error_message = Some(format!("Keyword '{}' not found in response", keyword));
                        } else if !must_be_present && contains {
                            status = "DOWN".to_string();
                            error_message = Some(format!("Keyword '{}' was found in response", keyword));
                        }
                    }
                    Err(e) => {
                        status = "DOWN".to_string();
                        error_message = Some(format!("Failed to read response body: {}", e));
                    }
                }
            }
        }
    }

    // Response time warning check
    if status == "UP" && response_time_ms > response_time_warning {
        status = "WARNING".to_string();
        error_message = Some(format!(
            "Response time higher than threshold: {} ms (threshold: {} ms)",
            response_time_ms, response_time_warning
        ));
    }

    // Domain expiration warning check (<= 30 days)
    if status == "UP" {
        if let Some(days_rem) = domain_days_remaining {
            if days_rem <= 30 {
                status = "WARNING".to_string();
                error_message = Some(format!(
                    "Domain registration expires in {} days",
                    days_rem
                ));
            }
        }
    }

    CheckResult {
        id,
        site_id: site.id.clone(),
        checked_at,
        status,
        status_code: Some(status_code),
        response_time_ms: Some(response_time_ms),
        ssl_valid,
        ssl_expiry_date,
        ssl_days_remaining,
        error_message,
        redirect_url,
        domain_expiry_date,
        domain_days_remaining,
    }
}

fn extract_domain(url_str: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url_str).ok()?;
    let host = parsed.host_str()?;
    if host.contains('.') && !host.parse::<std::net::IpAddr>().is_ok() && host != "localhost" {
        return Some(get_base_domain(host));
    }
    None
}

fn get_base_domain(host: &str) -> String {
    let parts: Vec<&str> = host.split('.').collect();
    let len = parts.len();
    if len <= 2 {
        return host.to_string();
    }
    let second_to_last = parts[len - 2].to_lowercase();
    let multi_part_suffixes = [
        "co", "com", "org", "net", "gov", "edu", "ac", "mil", "or", "nom", "club"
    ];
    if multi_part_suffixes.contains(&second_to_last.as_str()) && len >= 3 {
        parts[len - 3..].join(".")
    } else {
        parts[len - 2..].join(".")
    }
}

#[derive(serde::Deserialize, Debug)]
struct RdapEvent {
    #[serde(rename = "eventAction")]
    event_action: String,
    #[serde(rename = "eventDate")]
    event_date: String,
}

#[derive(serde::Deserialize, Debug)]
struct RdapResponse {
    events: Option<Vec<RdapEvent>>,
}

async fn get_domain_expiry(domain: &str, user_agent: &str, timeout_secs: u64) -> Option<chrono::DateTime<Utc>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent(user_agent)
        .build()
        .ok()?;

    let url = format!("https://rdap.org/domain/{}", domain);
    let response = client.get(&url).send().await.ok()?;
    let rdap: RdapResponse = response.json().await.ok()?;
    
    if let Some(events) = rdap.events {
        for event in events {
            if event.event_action == "expiration" || event.event_action == "registrar expiration" {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&event.event_date) {
                    return Some(dt.with_timezone(&Utc));
                }
            }
        }
    }
    None
}

fn get_cert_expiry(der_bytes: &[u8]) -> Result<chrono::DateTime<Utc>, String> {
    let (_, cert) = parse_x509_certificate(der_bytes).map_err(|e| e.to_string())?;
    let validity = cert.validity();
    let not_after = validity.not_after;
    let timestamp = not_after.timestamp();
    let dt = chrono::DateTime::from_timestamp(timestamp, 0)
        .ok_or_else(|| "Invalid timestamp in certificate".to_string())?;
    Ok(dt)
}

fn handle_notifications(
    app: &AppHandle,
    site: &Site,
    res: &CheckResult,
    prev_res: Option<CheckResult>,
    cooldown_secs: u32,
) {
    let now = Utc::now();
    let state = match app.try_state::<NotificationState>() {
        Some(s) => s,
        None => return,
    };

    let mut trigger_alert = false;
    let mut title = String::new();
    let mut body = String::new();

    if let Some(ref prev) = prev_res {
        if prev.status != res.status {
            if res.status == "DOWN" {
                trigger_alert = true;
                title = format!("⛔ Site Down: {}", site.name);
                body = res
                    .error_message
                    .clone()
                    .unwrap_or_else(|| "An error occurred".to_string());
            } else if res.status == "UP" && prev.status == "DOWN" {
                trigger_alert = true;
                title = format!("❇️ Site Recovered: {}", site.name);
                body = format!(
                    "{} is back online ({} ms)",
                    site.url,
                    res.response_time_ms.unwrap_or(0)
                );
            }
        }
    } else if res.status == "DOWN" {
        trigger_alert = true;
        title = format!("⛔ Site Down: {}", site.name);
        body = res
            .error_message
            .clone()
            .unwrap_or_else(|| "An error occurred".to_string());
    }

    // Check SSL warning transition
    if res.status == "WARNING"
        && res
            .error_message
            .as_ref()
            .map(|m| m.contains("SSL"))
            .unwrap_or(false)
    {
        let prev_was_warning = prev_res.map(|p| p.status == "WARNING").unwrap_or(false);
        if !prev_was_warning {
            trigger_alert = true;
            title = format!("⚠️ SSL Expiry Warning: {}", site.name);
            body = res
                .error_message
                .clone()
                .unwrap_or_else(|| "SSL expiring soon".to_string());
        }
    }

    if trigger_alert {
        let cache_key = format!("{}:{}", site.id, title);
        let mut last_sent = state.last_sent.lock().unwrap();

        let should_send = match last_sent.get(&cache_key) {
            None => true,
            Some(&last_time) => {
                let diff = now.signed_duration_since(last_time).num_seconds();
                diff >= cooldown_secs as i64
            }
        };

        if should_send {
            last_sent.insert(cache_key, now);
            let _ = app
                .notification()
                .builder()
                .title(title)
                .body(body)
                .show();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Site, SiteWithStatus, CheckResult};

    fn make_test_site(id: &str, enabled: bool) -> Site {
        Site {
            id: id.to_string(),
            url: "https://example.com".to_string(),
            name: "Test Site".to_string(),
            check_interval_secs: 60,
            expected_status: 200,
            ssl_check: true,
            keyword_check: None,
            keyword_present: None,
            timeout_secs: 5,
            tags: vec![],
            enabled,
            created_at: "".to_string(),
        }
    }

    #[test]
    fn test_determine_overall_status_empty() {
        assert_eq!(determine_overall_status(&[]), "UNKNOWN");
    }

    #[test]
    fn test_determine_overall_status_all_disabled() {
        let sites = vec![
            SiteWithStatus {
                site: make_test_site("1", false),
                latest_result: Some(CheckResult {
                    id: "r1".to_string(),
                    site_id: "1".to_string(),
                    checked_at: "".to_string(),
                    status: "DOWN".to_string(),
                    status_code: None,
                    response_time_ms: None,
                    ssl_valid: None,
                    ssl_expiry_date: None,
                    ssl_days_remaining: None,
                    error_message: None,
                    redirect_url: None,
                    domain_expiry_date: None,
                    domain_days_remaining: None,
                }),
            }
        ];
        assert_eq!(determine_overall_status(&sites), "UNKNOWN");
    }

    #[test]
    fn test_determine_overall_status_no_results() {
        let sites = vec![
            SiteWithStatus {
                site: make_test_site("1", true),
                latest_result: None,
            }
        ];
        assert_eq!(determine_overall_status(&sites), "UP");
    }

    #[test]
    fn test_determine_overall_status_up() {
        let sites = vec![
            SiteWithStatus {
                site: make_test_site("1", true),
                latest_result: Some(CheckResult {
                    id: "r1".to_string(),
                    site_id: "1".to_string(),
                    checked_at: "".to_string(),
                    status: "UP".to_string(),
                    status_code: Some(200),
                    response_time_ms: Some(100),
                    ssl_valid: Some(true),
                    ssl_expiry_date: None,
                    ssl_days_remaining: None,
                    error_message: None,
                    redirect_url: None,
                    domain_expiry_date: None,
                    domain_days_remaining: None,
                }),
            }
        ];
        assert_eq!(determine_overall_status(&sites), "UP");
    }

    #[test]
    fn test_determine_overall_status_warning() {
        let sites = vec![
            SiteWithStatus {
                site: make_test_site("1", true),
                latest_result: Some(CheckResult {
                    id: "r1".to_string(),
                    site_id: "1".to_string(),
                    checked_at: "".to_string(),
                    status: "UP".to_string(),
                    status_code: Some(200),
                    response_time_ms: Some(100),
                    ssl_valid: Some(true),
                    ssl_expiry_date: None,
                    ssl_days_remaining: None,
                    error_message: None,
                    redirect_url: None,
                    domain_expiry_date: None,
                    domain_days_remaining: None,
                }),
            },
            SiteWithStatus {
                site: make_test_site("2", true),
                latest_result: Some(CheckResult {
                    id: "r2".to_string(),
                    site_id: "2".to_string(),
                    checked_at: "".to_string(),
                    status: "WARNING".to_string(),
                    status_code: Some(200),
                    response_time_ms: Some(2500),
                    ssl_valid: Some(true),
                    ssl_expiry_date: None,
                    ssl_days_remaining: None,
                    error_message: None,
                    redirect_url: None,
                    domain_expiry_date: None,
                    domain_days_remaining: None,
                }),
            }
        ];
        assert_eq!(determine_overall_status(&sites), "WARNING");
    }

    #[test]
    fn test_determine_overall_status_down() {
        let sites = vec![
            SiteWithStatus {
                site: make_test_site("1", true),
                latest_result: Some(CheckResult {
                    id: "r1".to_string(),
                    site_id: "1".to_string(),
                    checked_at: "".to_string(),
                    status: "WARNING".to_string(),
                    status_code: Some(2500),
                    response_time_ms: Some(100),
                    ssl_valid: Some(true),
                    ssl_expiry_date: None,
                    ssl_days_remaining: None,
                    error_message: None,
                    redirect_url: None,
                    domain_expiry_date: None,
                    domain_days_remaining: None,
                }),
            },
            SiteWithStatus {
                site: make_test_site("2", true),
                latest_result: Some(CheckResult {
                    id: "r2".to_string(),
                    site_id: "2".to_string(),
                    checked_at: "".to_string(),
                    status: "DOWN".to_string(),
                    status_code: Some(500),
                    response_time_ms: Some(200),
                    ssl_valid: Some(true),
                    ssl_expiry_date: None,
                    ssl_days_remaining: None,
                    error_message: None,
                    redirect_url: None,
                    domain_expiry_date: None,
                    domain_days_remaining: None,
                }),
            }
        ];
        assert_eq!(determine_overall_status(&sites), "DOWN");
    }

    #[test]
    fn test_get_cert_expiry_invalid() {
        let res = get_cert_expiry(&[0, 1, 2, 3]);
        assert!(res.is_err());
    }
}

