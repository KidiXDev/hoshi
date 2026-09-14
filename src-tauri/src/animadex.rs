use crate::network_cache;
use reqwest::blocking::Client;
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;

const BASE_URL: &str = "https://animadex.net";
const ANIMADEX_FACET_TTL_SECONDS: u64 = 7 * 24 * 3600;
const ANIMADEX_SEARCH_TTL_SECONDS: u64 = 2 * 24 * 3600;

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Koharu/1.0")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn animadex_request(
    app_handle: AppHandle,
    url: String,
    force_refresh: Option<bool>,
) -> Result<Value, String> {
    let bypass_cache = force_refresh.unwrap_or(false);

    if !bypass_cache {
        if let Some(cached) = network_cache::read_cache(&app_handle, "animadex", &url) {
            return Ok(cached);
        }
    }

    let fetched_url = url.clone();
    let fetched = tauri::async_runtime::spawn_blocking(move || {
        let client = client()?;
        let full_url = if fetched_url.starts_with("http://") || fetched_url.starts_with("https://") {
            fetched_url
        } else {
            format!(
                "{BASE_URL}{}",
                if fetched_url.starts_with('/') {
                    fetched_url
                } else {
                    format!("/{fetched_url}")
                }
            )
        };
        let response = client.get(&full_url).send().map_err(|e| e.to_string())?;
        let status = response.status();
        if status.is_success() {
            response.json().map_err(|e| e.to_string())
        } else {
            let text = response.text().unwrap_or_default();
            Err(format!("AnimaDex returned {status}: {text}"))
        }
    })
    .await
    .map_err(|error| error.to_string())??;

    let ttl = if url.contains("/facets") || url.contains("/facet/") {
        ANIMADEX_FACET_TTL_SECONDS
    } else {
        ANIMADEX_SEARCH_TTL_SECONDS
    };

    let _ = network_cache::write_cache(&app_handle, "animadex", &url, &fetched, ttl);

    Ok(fetched)
}
