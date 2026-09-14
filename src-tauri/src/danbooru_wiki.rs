use crate::network_cache;
use reqwest::blocking::Client;
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;

const DANBOORU_WIKI_TTL_SECONDS: u64 = 7 * 24 * 3600;

#[tauri::command]
pub async fn danbooru_wiki_request(
    app_handle: AppHandle,
    title: Option<String>,
    post_ids: Option<Vec<u64>>,
    force_refresh: Option<bool>,
) -> Result<Value, String> {
    let cache_key = if let Some(ref t) = title {
        format!("wiki:{}", t.trim().to_lowercase())
    } else {
        let mut ids = post_ids.clone().unwrap_or_default();
        ids.sort_unstable();
        format!(
            "posts:{}",
            ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",")
        )
    };

    let bypass_cache = force_refresh.unwrap_or(false);

    if !bypass_cache {
        if let Some(cached) = network_cache::read_cache(&app_handle, "danbooru_wiki", &cache_key) {
            return Ok(cached);
        }
    }

    let fetched = tauri::async_runtime::spawn_blocking(move || {
        let client = Client::builder()
            .user_agent("Koharu/1.0 (Danbooru Tag Wiki)")
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| error.to_string())?;
        let request = if let Some(title) = title {
            if title.trim().is_empty() || title.len() > 500 {
                return Err("Invalid wiki title".into());
            }
            let mut url = reqwest::Url::parse("https://danbooru.donmai.us/wiki_pages/").unwrap();
            url.path_segments_mut()
                .unwrap()
                .pop_if_empty()
                .push(&format!("{title}.json"));
            client.get(url)
        } else {
            let ids = post_ids.unwrap_or_default();
            if ids.is_empty() || ids.len() > 100 || ids.contains(&0) {
                return Err("Expected 1–100 post IDs".into());
            }
            let ids = ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
            client.get("https://danbooru.donmai.us/posts.json").query(&[
                ("tags", format!("id:{ids}")),
                ("limit", "100".into()),
                ("only", "id,preview_file_url".into()),
            ])
        };
        let response = request.send().map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!("Danbooru returned {}", response.status()));
        }
        response.json().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;

    let _ = network_cache::write_cache(
        &app_handle,
        "danbooru_wiki",
        &cache_key,
        &fetched,
        DANBOORU_WIKI_TTL_SECONDS,
    );

    Ok(fetched)
}
