mod aitag;
mod danbooru;
mod gelbooru;
mod moebooru;
mod safebooru;

use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{ACCEPT, CONTENT_LENGTH, CONTENT_TYPE, LOCATION, REFERER};
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const CATEGORY_ORDER: [&str; 5] = ["artist", "copyright", "character", "general", "meta"];
const STATIC_EXTENSIONS: [&str; 5] = ["jpg", "jpeg", "png", "webp", "gif"];
const MAX_MEDIA_BYTES: u64 = 100 * 1024 * 1024;
const MAX_CACHED_MEDIA_BYTES: usize = 64 * 1024 * 1024;
const SEARCH_TTL_SECONDS: u64 = 300;
const QUERY_TTL_SECONDS: u64 = 86_400;
const DETAIL_TTL_SECONDS: u64 = 86_400;
const TAG_TTL_SECONDS: u64 = 30 * 24 * 3600;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub source: &'static str,
    pub display_name: &'static str,
    pub ratings: &'static [&'static str],
    pub sort_values: &'static [&'static str],
    pub pagination: &'static str,
    pub max_page_size: usize,
    pub auth_fields: &'static [&'static str],
    pub categorized_tags: bool,
    pub favorite_read: bool,
    pub favorite_write: bool,
    pub ranking_periods: &'static [&'static str],
    pub page_jump: bool,
    pub detail_hydration: bool,
    pub download: bool,
    pub auth_required: bool,
    pub tag_search: bool,
    pub max_search_tags: Option<usize>,
    pub credentials_url: &'static str,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostSummary {
    pub source: String,
    pub post_id: String,
    pub post_url: String,
    pub preview_url: String,
    pub sample_url: String,
    pub width: u64,
    pub height: u64,
    pub rating: String,
    pub created_at: String,
    pub favorite: Option<bool>,
    pub score: i64,
    pub fav_count: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostDetail {
    pub source: String,
    pub post_id: String,
    pub post_url: String,
    pub preview_url: String,
    pub sample_url: String,
    pub media_url: String,
    pub width: u64,
    pub height: u64,
    pub rating: String,
    pub created_at: String,
    pub favorite: Option<bool>,
    pub score: i64,
    pub fav_count: i64,
    pub file_ext: String,
    pub file_size: u64,
    pub tags: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub complete: bool,
}

impl PostDetail {
    pub(crate) fn from_summary(summary: PostSummary) -> Self {
        Self {
            source: summary.source,
            post_id: summary.post_id,
            post_url: summary.post_url,
            preview_url: summary.preview_url,
            sample_url: summary.sample_url,
            width: summary.width,
            height: summary.height,
            rating: summary.rating,
            created_at: summary.created_at,
            favorite: summary.favorite,
            score: summary.score,
            fav_count: summary.fav_count,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub posts: Vec<PostSummary>,
    pub next_cursor: Option<String>,
    pub ended: bool,
    pub warnings: Vec<String>,
    pub page: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<usize>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub source: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub ratings: Vec<String>,
    #[serde(default = "latest")]
    pub sort: String,
    pub cursor: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    pub page: Option<usize>,
    #[serde(default)]
    pub random: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankingRequest {
    pub source: String,
    pub period: String,
    #[serde(default)]
    pub ratings: Vec<String>,
    pub cursor: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    pub page: Option<usize>,
    #[serde(default)]
    pub random: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoritesRequest {
    pub source: String,
    pub cursor: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    pub page: Option<usize>,
    #[serde(default)]
    pub random: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptDefaults {
    #[serde(default = "default_categories")]
    categories: Vec<String>,
    #[serde(default)]
    replace_underscores: bool,
    #[serde(default)]
    escape_parentheses: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    #[serde(default)]
    danbooru: HashMap<String, String>,
    #[serde(default)]
    gelbooru: HashMap<String, String>,
    #[serde(default)]
    konachan: HashMap<String, String>,
}

impl Credentials {
    fn get(&self, source: &str) -> HashMap<String, String> {
        match source {
            "danbooru" => self.danbooru.clone(),
            "gelbooru" => self.gelbooru.clone(),
            "konachan.com" | "konachan" => self.konachan.clone(),
            _ => HashMap::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
struct Settings {
    version: u8,
    revision: u64,
    default_source: String,
    blacklist: Vec<String>,
    output_filter_tags: Vec<String>,
    prompt_defaults: PromptDefaults,
    timeout: u64,
    cache_budget_mi_b: u64,
    credentials: Credentials,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            default_source: "danbooru".into(),
            blacklist: Vec::new(),
            output_filter_tags: Vec::new(),
            prompt_defaults: PromptDefaults {
                categories: default_categories(),
                replace_underscores: false,
                escape_parentheses: false,
            },
            timeout: 30,
            cache_budget_mi_b: 1024,
            credentials: Credentials::default(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    default_source: Option<String>,
    blacklist: Option<Vec<String>>,
    output_filter_tags: Option<Vec<String>>,
    prompt_defaults: Option<PromptDefaults>,
    timeout: Option<u64>,
    cache_budget_mi_b: Option<u64>,
    credentials: Option<HashMap<String, HashMap<String, String>>>,
    clear_credentials: Option<HashMap<String, Vec<String>>>,
}

pub(crate) trait Provider: Sync {
    fn capabilities(&self) -> Capabilities;
    fn search(
        &self,
        client: &Client,
        request: &SearchRequest,
        credentials: &HashMap<String, String>,
        blacklist: &HashSet<String>,
    ) -> Result<Page, String>;
    fn detail(
        &self,
        client: &Client,
        post_id: &str,
        credentials: &HashMap<String, String>,
    ) -> Result<PostDetail, String>;
    fn ranking(
        &self,
        _client: &Client,
        period: &str,
        _request: &RankingRequest,
        _credentials: &HashMap<String, String>,
        _blacklist: &HashSet<String>,
    ) -> Result<Page, String> {
        Err(format!(
            "{} does not support {period} rankings",
            self.capabilities().source
        ))
    }
    fn favorites(
        &self,
        _client: &Client,
        _request: &FavoritesRequest,
        _credentials: &HashMap<String, String>,
        _blacklist: &HashSet<String>,
    ) -> Result<Page, String> {
        Err(format!(
            "{} does not support account favorites",
            self.capabilities().source
        ))
    }
    fn set_favorite(
        &self,
        _client: &Client,
        _post_id: &str,
        _favorite: bool,
        _credentials: &HashMap<String, String>,
    ) -> Result<bool, String> {
        Err(format!(
            "{} does not support favorite writes",
            self.capabilities().source
        ))
    }
    fn classify_tags(
        &self,
        _client: &Client,
        tags: &[String],
        _credentials: &HashMap<String, String>,
    ) -> Result<HashMap<String, Vec<String>>, String> {
        Ok(group_as_general(tags))
    }
    fn known_tags(
        &self,
        _client: &Client,
        _names: &[String],
        _credentials: &HashMap<String, String>,
    ) -> Result<HashSet<String>, String> {
        Ok(HashSet::new())
    }
    fn normalize_query(
        &self,
        client: &Client,
        query: &str,
        credentials: &HashMap<String, String>,
    ) -> Result<String, String> {
        let tokens = tokenize_query(query);
        if tokens.len() > 40 {
            return Ok(tokens.join(" "));
        }
        let known = self.known_tags(client, &join_candidates(&tokens), credentials)?;
        Ok(repair_spaced_tags(&tokens, &known).join(" "))
    }
    fn test_credentials(
        &self,
        client: &Client,
        credentials: &HashMap<String, String>,
    ) -> Result<Value, String> {
        self.search(
            client,
            &SearchRequest {
                source: self.capabilities().source.into(),
                limit: 1,
                ..SearchRequest::default()
            },
            credentials,
            &HashSet::new(),
        )?;
        Ok(serde_json::json!({"ok": true}))
    }
    fn validate_media_url(&self, url: &str) -> Result<(), String> {
        validate_media_url(self.capabilities().source, url)
    }
    fn media_referer(&self) -> Option<&'static str> {
        None
    }
    fn cursor_for_page(&self, page: usize) -> String {
        page.max(1).to_string()
    }
}

fn latest() -> String {
    "latest".into()
}

fn default_limit() -> usize {
    60
}

fn default_categories() -> Vec<String> {
    vec!["copyright".into(), "character".into(), "general".into()]
}

pub(crate) fn provider(source: &str) -> Result<&'static dyn Provider, String> {
    match source {
        "danbooru" => Ok(&danbooru::DANBOORU),
        "gelbooru" => Ok(&gelbooru::GELBOORU),
        "safebooru" => Ok(&safebooru::SAFEBOORU),
        "aitag" => Ok(&aitag::AI_TAG),
        "yandere" => Ok(&moebooru::YANDERE),
        "konachan.net" => Ok(&moebooru::KONACHAN_NET),
        "konachan.com" => Ok(&moebooru::KONACHAN_COM),
        _ => Err(format!("unsupported booru source: {source}")),
    }
}

fn providers() -> [&'static dyn Provider; 7] {
    [
        &danbooru::DANBOORU,
        &gelbooru::GELBOORU,
        &safebooru::SAFEBOORU,
        &aitag::AI_TAG,
        &moebooru::YANDERE,
        &moebooru::KONACHAN_NET,
        &moebooru::KONACHAN_COM,
    ]
}

pub(crate) fn client(timeout: u64) -> Result<Client, String> {
    Client::builder()
        .user_agent("Koharu/1.0 (Native Booru Gallery)")
        .connect_timeout(Duration::from_secs(timeout.min(30)))
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(|error| error.to_string())
}

pub(crate) fn send_json(source: &str, request: RequestBuilder) -> Result<Value, String> {
    for attempt in 0..3 {
        let response = request
            .try_clone()
            .ok_or_else(|| format!("{source} request cannot be retried"))?
            .send();
        match response {
            Ok(response) => {
                let status = response.status();
                let final_url = sanitized_url(response.url());
                let retry_after = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or((attempt + 1) as u64)
                    .min(5);
                let body = response.text().unwrap_or_default();
                if status.is_success() {
                    return serde_json::from_str(&body)
                        .map_err(|_| format!("{source} GET {final_url} returned invalid JSON"));
                }
                if status == StatusCode::FORBIDDEN && body.contains("you have been blocked") {
                    // Cloudflare WAF block page (error 1020): no challenge exists to solve.
                    return Err(format!(
                        "{source} request was blocked by the site's Cloudflare firewall (HTTP {status}). This is not a solvable challenge; the site is rejecting requests from this app."
                    ));
                }
                if body.contains("cf-mitigated")
                    || body.contains("challenges.cloudflare.com")
                    || body.contains("Just a moment...")
                    || body.contains("Turnstile")
                    || (status == StatusCode::FORBIDDEN
                        && (body.contains("Cloudflare")
                            || body.contains("<html")
                            || body.contains("<!DOCTYPE html>")))
                {
                    return Err(format!(
                        "{source} request was blocked by Cloudflare verification (HTTP {status}). Please solve the Cloudflare challenge to proceed."
                    ));
                }
                if body.contains("QueryCanceled") || body.contains("timed out running your query") {
                    return Err(format!(
                        "{source} aborted the query: the result set exceeded its execution budget"
                    ));
                }
                let limited = status == StatusCode::NOT_FOUND
                    || status == StatusCode::TOO_MANY_REQUESTS
                    || status.is_server_error()
                    || body.contains("API limited due to abuse");
                if limited && attempt < 2 {
                    thread::sleep(Duration::from_secs(retry_after));
                    continue;
                }
                return Err(format!(
                    "{source} GET {final_url} HTTP {status}: {}",
                    truncate(&body, 300)
                ));
            }
            Err(error) if attempt < 2 && !error.is_builder() => {
                thread::sleep(Duration::from_secs((attempt + 1) as u64));
            }
            Err(error) => return Err(format!("{source} request failed: {}", error.without_url())),
        }
    }
    unreachable!()
}

pub(crate) fn send_status(source: &str, request: RequestBuilder) -> Result<(), String> {
    let response = request
        .send()
        .map_err(|error| format!("{source} request failed: {}", error.without_url()))?;
    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        Err(format!(
            "{source} request returned {status}: {}",
            truncate(&response.text().unwrap_or_default(), 300)
        ))
    }
}

fn sanitized_url(url: &Url) -> Url {
    let mut url = url.clone();
    url.set_query(None);
    url.set_fragment(None);
    url
}

fn truncate(value: &str, limit: usize) -> &str {
    value.get(..value.len().min(limit)).unwrap_or(value)
}

pub(crate) fn as_i64(value: Option<&Value>) -> i64 {
    value
        .and_then(Value::as_i64)
        .or_else(|| value.and_then(Value::as_str)?.parse().ok())
        .unwrap_or(0)
}

pub(crate) fn as_u64(value: Option<&Value>) -> u64 {
    u64::try_from(as_i64(value)).unwrap_or(0)
}

pub(crate) fn string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

pub(crate) fn split_tags(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(value)) => value.split_whitespace().map(str::to_string).collect(),
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn normalized_blacklist(values: &[String]) -> HashSet<String> {
    values
        .iter()
        .flat_map(|value| value.split([',', '，', '、', '\r', '\n']))
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

pub(crate) fn raw_tags(post: &Value) -> HashSet<String> {
    let Some(object) = post.as_object() else {
        return HashSet::new();
    };
    let mut tags = HashSet::new();
    for (key, value) in object {
        if key == "tags" || key.starts_with("tag_string") || key == "prompt" || key == "prompt_text"
        {
            match value {
                Value::String(value) => tags.extend(
                    value
                        .split(|c: char| c.is_whitespace() || c == ',')
                        .filter(|v| !v.is_empty())
                        .map(|v| v.to_lowercase()),
                ),
                Value::Array(values) => tags.extend(
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|v| v.to_lowercase()),
                ),
                _ => {}
            }
        }
    }
    tags
}

pub(crate) fn is_blacklisted(post: &Value, blacklist: &HashSet<String>) -> bool {
    !blacklist.is_empty() && raw_tags(post).iter().any(|tag| blacklist.contains(tag))
}

pub(crate) fn is_static_post(post: &Value) -> bool {
    let extension = string(post.get("file_ext"));
    if !extension.is_empty() {
        return STATIC_EXTENSIONS.contains(&extension.to_lowercase().as_str());
    }
    [
        "file_url",
        "sample_url",
        "preview_url",
        "large_file_url",
        "preview_file_url",
    ]
    .iter()
    .filter_map(|key| post.get(key).and_then(Value::as_str))
    .any(|url| {
        let path = url
            .split(['?', '#'])
            .next()
            .unwrap_or_default()
            .to_lowercase();
        STATIC_EXTENSIONS
            .iter()
            .any(|ext| path.ends_with(&format!(".{ext}")))
    })
}

pub(crate) fn rating_matches(source: &str, rating: &str, ratings: &[String]) -> bool {
    if ratings.is_empty() {
        return true;
    }
    let lower = rating.to_lowercase();
    let normalized = match (source, lower.as_str()) {
        ("safebooru", "g" | "general" | "s") => "safe",
        (_, "g") => "general",
        (_, "s") => "sensitive",
        (_, "q") => "questionable",
        (_, "e") => "explicit",
        (_, other) => other,
    };
    ratings.iter().any(|value| value == normalized)
}

pub(crate) fn group_as_general(tags: &[String]) -> HashMap<String, Vec<String>> {
    CATEGORY_ORDER
        .into_iter()
        .map(|category| {
            (
                category.into(),
                if category == "general" {
                    tags.to_vec()
                } else {
                    Vec::new()
                },
            )
        })
        .collect()
}

fn tokenize_query(query: &str) -> Vec<String> {
    query
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn is_operator(token: &str) -> bool {
    token.starts_with(['-', '~']) || token.contains([':', '*', '(', ')', '[', ']', '"', '\''])
}

fn join_candidates(tokens: &[String]) -> Vec<String> {
    let mut names = HashSet::new();
    let mut start = 0;
    while start < tokens.len() {
        if is_operator(&tokens[start]) {
            start += 1;
            continue;
        }
        let mut end = start;
        while end < tokens.len() && !is_operator(&tokens[end]) {
            end += 1;
        }
        for first in start..end {
            names.insert(tokens[first].to_lowercase());
            for last in first + 2..=end.min(first + 6) {
                names.insert(tokens[first..last].join("_").to_lowercase());
            }
        }
        start = end;
    }
    let mut result: Vec<_> = names.into_iter().collect();
    result.sort();
    result
}

fn repair_spaced_tags(tokens: &[String], known: &HashSet<String>) -> Vec<String> {
    if known.is_empty() {
        return tokens.to_vec();
    }
    let mut output = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        if is_operator(&tokens[index]) {
            output.push(tokens[index].clone());
            index += 1;
            continue;
        }
        let mut run_end = index;
        while run_end < tokens.len() && !is_operator(&tokens[run_end]) {
            run_end += 1;
        }
        let run = &tokens[index..run_end];
        if run.iter().all(|word| known.contains(&word.to_lowercase())) {
            output.extend_from_slice(run);
        } else {
            let mut start = 0;
            while start < run.len() {
                let mut matched = None;
                for end in (start + 2..=run.len().min(start + 6)).rev() {
                    let candidate = run[start..end].join("_");
                    if known.contains(&candidate.to_lowercase()) {
                        matched = Some((end, candidate));
                        break;
                    }
                }
                if let Some((end, candidate)) = matched {
                    output.push(candidate);
                    start = end;
                } else {
                    output.push(run[start].clone());
                    start += 1;
                }
            }
        }
        index = run_end;
    }
    output
}

fn settings(app: &AppHandle) -> Result<Settings, String> {
    let value = crate::load_app_data_entry(app, "state", "booru_gallery")?;
    let mut settings = value
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    validate_settings(&mut settings)?;
    Ok(settings)
}

fn validate_settings(settings: &mut Settings) -> Result<(), String> {
    provider(&settings.default_source)?;
    if !(3..=300).contains(&settings.timeout) {
        return Err("timeout must be between 3 and 300 seconds".into());
    }
    if !(128..=32_768).contains(&settings.cache_budget_mi_b) {
        return Err("cacheBudgetMiB must be between 128 and 32768".into());
    }
    settings.blacklist = unique_strings(&settings.blacklist);
    settings.output_filter_tags = unique_strings(&settings.output_filter_tags);
    settings
        .prompt_defaults
        .categories
        .retain(|value| CATEGORY_ORDER.contains(&value.as_str()));
    gelbooru::normalize_credentials(&mut settings.credentials.gelbooru);
    Ok(())
}

fn unique_strings(values: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .iter()
        .flat_map(|value| value.split([',', '，', '、', '\r', '\n']))
        .map(str::trim)
        .filter(|value| !value.is_empty() && seen.insert((*value).to_string()))
        .map(str::to_string)
        .collect()
}

fn public_settings(settings: &Settings) -> Value {
    serde_json::json!({
        "defaultSource": settings.default_source,
        "blacklist": settings.blacklist,
        "outputFilterTags": settings.output_filter_tags,
        "promptDefaults": settings.prompt_defaults,
        "timeout": settings.timeout,
        "cacheBudgetMiB": settings.cache_budget_mi_b,
        "credentialStatus": {
            "danbooru": {
                "hasUsername": settings.credentials.danbooru.get("username").is_some_and(|v| !v.is_empty()),
                "hasApiKey": settings.credentials.danbooru.get("apiKey").is_some_and(|v| !v.is_empty())
            },
            "gelbooru": {
                "hasUserId": settings.credentials.gelbooru.get("userId").is_some_and(|v| !v.is_empty()),
                "hasApiKey": settings.credentials.gelbooru.get("apiKey").is_some_and(|v| !v.is_empty())
            },
            "konachan": {
                "hasCookie": settings.credentials.konachan.get("cookie").is_some_and(|v| !v.is_empty()),
                "hasUserAgent": settings.credentials.konachan.get("userAgent").is_some_and(|v| !v.is_empty())
            },
            "safebooru": {}, "aitag": {}
        }
    })
}

fn cache_read<T: for<'de> Deserialize<'de>>(
    app: &AppHandle,
    namespace: &str,
    key: &str,
) -> Option<T> {
    crate::network_cache::read_cache(app, namespace, key)
        .and_then(|value| serde_json::from_value(value).ok())
}

fn cache_write<T: Serialize>(app: &AppHandle, namespace: &str, key: &str, value: &T, ttl: u64) {
    if let Ok(value) = serde_json::to_value(value) {
        let _ = crate::network_cache::write_cache(app, namespace, key, &value, ttl);
    }
}

fn hydrate_detail(
    app: &AppHandle,
    provider: &dyn Provider,
    client: &Client,
    mut detail: PostDetail,
    credentials: &HashMap<String, String>,
) -> Result<PostDetail, String> {
    if detail.complete {
        return Ok(detail);
    }
    let raw: Vec<String> = detail.tags.values().flatten().cloned().collect();
    let mut categories = HashMap::new();
    let mut missing = Vec::new();
    for tag in &raw {
        let key = format!("{}:{tag}", detail.source);
        if let Some(category) = cache_read::<String>(app, "booru_tags", &key) {
            categories.insert(tag.clone(), category);
        } else {
            missing.push(tag.clone());
        }
    }
    let classified = provider.classify_tags(client, &missing, credentials)?;
    for (category, tags) in classified {
        for tag in tags {
            cache_write(
                app,
                "booru_tags",
                &format!("{}:{tag}", detail.source),
                &category,
                TAG_TTL_SECONDS,
            );
            categories.insert(tag, category.clone());
        }
    }
    detail.tags = CATEGORY_ORDER
        .into_iter()
        .map(|category| {
            (
                category.into(),
                raw.iter()
                    .filter(|tag| {
                        categories
                            .get(*tag)
                            .map(String::as_str)
                            .unwrap_or("general")
                            == category
                    })
                    .cloned()
                    .collect(),
            )
        })
        .collect();
    detail.complete = !detail.media_url.is_empty();
    Ok(detail)
}

fn random_page(total: usize, page_size: usize) -> usize {
    let pages = total.max(1).div_ceil(page_size.max(1));
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as usize;
    seed % pages + 1
}

#[tauri::command]
pub async fn booru_sources() -> Result<Vec<Capabilities>, String> {
    Ok(providers()
        .into_iter()
        .map(Provider::capabilities)
        .collect())
}

#[tauri::command]
pub async fn booru_search(app_handle: AppHandle, request: SearchRequest) -> Result<Page, String> {
    tauri::async_runtime::spawn_blocking(move || search_blocking(&app_handle, request))
        .await
        .map_err(|e| e.to_string())?
}

fn search_blocking(app: &AppHandle, mut request: SearchRequest) -> Result<Page, String> {
    let settings = settings(app)?;
    let provider = provider(&request.source)?;
    let caps = provider.capabilities();
    if caps.ratings.is_empty() {
        request.ratings.clear();
    }
    if request
        .ratings
        .iter()
        .any(|rating| !caps.ratings.contains(&rating.as_str()))
    {
        return Err(format!(
            "{} does not support one or more selected ratings",
            request.source
        ));
    }
    request.limit = request.limit.clamp(1, caps.max_page_size);
    if let Some(page) = request.page.filter(|_| !request.random) {
        request.cursor = Some(provider.cursor_for_page(page));
    }
    let credentials = settings.credentials.get(&request.source);
    let client = client(settings.timeout)?;
    let query_key = format!("{}:{}", request.source, request.query);
    request.query = match cache_read(app, "booru_query", &query_key) {
        Some(normalized) => normalized,
        None => {
            let normalized = provider.normalize_query(&client, &request.query, &credentials)?;
            cache_write(
                app,
                "booru_query",
                &query_key,
                &normalized,
                QUERY_TTL_SECONDS,
            );
            normalized
        }
    };
    let blacklist = normalized_blacklist(&settings.blacklist);
    if request.random && request.source == "aitag" {
        let first = provider.search(&client, &request, &credentials, &blacklist)?;
        request.cursor = Some(
            random_page(first.total.unwrap_or(first.posts.len()), caps.max_page_size).to_string(),
        );
    } else if request.random {
        request.sort = "random".into();
        request.cursor = None;
    }
    let key = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    if !request.random {
        if let Some(page) = cache_read(app, "booru_search", &key) {
            return Ok(page);
        }
    }
    let page = provider.search(&client, &request, &credentials, &blacklist)?;
    if !request.random {
        cache_write(app, "booru_search", &key, &page, SEARCH_TTL_SECONDS);
    }
    Ok(page)
}

#[tauri::command]
pub async fn booru_ranking(
    app_handle: AppHandle,
    mut request: RankingRequest,
) -> Result<Page, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let settings = settings(&app_handle)?;
        let provider = provider(&request.source)?;
        let caps = provider.capabilities();
        if !caps.ranking_periods.contains(&request.period.as_str()) {
            return Err(format!(
                "{} does not support {} rankings",
                request.source, request.period
            ));
        }
        request.limit = request.limit.clamp(1, caps.max_page_size);
        if let Some(page) = request.page.filter(|_| !request.random) {
            request.cursor = Some(provider.cursor_for_page(page));
        }
        let credentials = settings.credentials.get(&request.source);
        let client = client(settings.timeout)?;
        let blacklist = normalized_blacklist(&settings.blacklist);
        if request.random && request.source == "aitag" {
            let first =
                provider.ranking(&client, &request.period, &request, &credentials, &blacklist)?;
            request.cursor = Some(
                random_page(first.total.unwrap_or(first.posts.len()), caps.max_page_size)
                    .to_string(),
            );
        }
        let key = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        if !request.random {
            if let Some(page) = cache_read(&app_handle, "booru_search", &key) {
                return Ok(page);
            }
        }
        let mut page =
            provider.ranking(&client, &request.period, &request, &credentials, &blacklist)?;
        page.posts
            .retain(|post| rating_matches(&request.source, &post.rating, &request.ratings));
        if !request.random {
            cache_write(&app_handle, "booru_search", &key, &page, SEARCH_TTL_SECONDS);
        }
        Ok(page)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn booru_detail(
    app_handle: AppHandle,
    source: String,
    post_id: String,
) -> Result<PostDetail, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if post_id.trim().is_empty() {
            return Err("postId is required".into());
        }
        let key = format!("{source}:{post_id}");
        if let Some(detail) = cache_read(&app_handle, "booru_detail", &key) {
            return Ok(detail);
        }
        let settings = settings(&app_handle)?;
        let provider = provider(&source)?;
        let credentials = settings.credentials.get(&source);
        let client = client(settings.timeout)?;
        let detail = hydrate_detail(
            &app_handle,
            provider,
            &client,
            provider.detail(&client, &post_id, &credentials)?,
            &credentials,
        )?;
        if !detail.media_url.is_empty() {
            provider.validate_media_url(&detail.media_url)?;
        }
        if !detail.sample_url.is_empty() {
            provider.validate_media_url(&detail.sample_url)?;
        }
        cache_write(
            &app_handle,
            "booru_detail",
            &key,
            &detail,
            DETAIL_TTL_SECONDS,
        );
        Ok(detail)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn booru_settings_get(app_handle: AppHandle) -> Result<Value, String> {
    Ok(public_settings(&settings(&app_handle)?))
}

#[tauri::command]
pub async fn booru_settings_save(
    app_handle: AppHandle,
    update: SettingsUpdate,
) -> Result<Value, String> {
    let mut settings = settings(&app_handle)?;
    if let Some(value) = update.default_source {
        settings.default_source = value;
    }
    if let Some(value) = update.blacklist {
        settings.blacklist = value;
    }
    if let Some(value) = update.output_filter_tags {
        settings.output_filter_tags = value;
    }
    if let Some(value) = update.prompt_defaults {
        settings.prompt_defaults = value;
    }
    if let Some(value) = update.timeout {
        settings.timeout = value;
    }
    if let Some(value) = update.cache_budget_mi_b {
        settings.cache_budget_mi_b = value;
    }
    for (source, values) in update.credentials.unwrap_or_default() {
        let (target, allowed): (&mut HashMap<String, String>, &[&str]) = match source.as_str() {
            "danbooru" => (&mut settings.credentials.danbooru, &["username", "apiKey"]),
            "gelbooru" => (&mut settings.credentials.gelbooru, &["userId", "apiKey"]),
            "konachan" | "konachan.com" => (
                &mut settings.credentials.konachan,
                &["cookie", "userAgent"],
            ),
            _ => return Err(format!("invalid credential source: {source}")),
        };
        for (key, value) in values {
            if !allowed.contains(&key.as_str()) {
                return Err(format!("invalid credential field {source}.{key}"));
            }
            if !value.trim().is_empty() {
                target.insert(key, value.trim().into());
            }
        }
    }
    for (source, keys) in update.clear_credentials.unwrap_or_default() {
        let target = match source.as_str() {
            "danbooru" => &mut settings.credentials.danbooru,
            "gelbooru" => &mut settings.credentials.gelbooru,
            "konachan" | "konachan.com" => &mut settings.credentials.konachan,
            _ => continue,
        };
        for key in keys {
            target.remove(&key);
        }
    }
    settings.revision += 1;
    validate_settings(&mut settings)?;
    crate::save_app_data_entry(
        &app_handle,
        "state",
        "booru_gallery",
        serde_json::to_value(&settings).map_err(|e| e.to_string())?,
    )?;
    clear_json_caches(&app_handle);
    prune_media(&app_handle, settings.cache_budget_mi_b)?;
    Ok(public_settings(&settings))
}

#[tauri::command]
pub async fn booru_test_credentials(
    app_handle: AppHandle,
    source: String,
    credentials: HashMap<String, String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let stored = settings(&app_handle)?;
        let mut merged = stored.credentials.get(&source);
        merged.extend(
            credentials
                .into_iter()
                .filter(|(_, value)| !value.trim().is_empty()),
        );
        provider(&source)?.test_credentials(&client(stored.timeout)?, &merged)
    })
    .await
    .map_err(|e| e.to_string())?
}

const CLOUDFLARE_SOLVER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

#[tauri::command]
pub async fn booru_solve_cloudflare(
    app_handle: AppHandle,
    source: String,
) -> Result<Value, String> {
    let normalized_source = match source.as_str() {
        "konachan" | "konachan.com" => "konachan.com",
        _ => return Err(format!("Cloudflare solver is not supported for {source}")),
    };
    let target_url = format!("https://{normalized_source}/post.json?limit=1");

    if let Some(existing) = app_handle.get_webview_window("booru-cf-solver") {
        let _ = existing.close();
        thread::sleep(Duration::from_millis(200));
    }

    let parsed_url = Url::parse(&target_url).map_err(|e| e.to_string())?;

    let old_cookie = {
        let current = settings(&app_handle)?;
        current
            .credentials
            .konachan
            .get("cookie")
            .cloned()
            .unwrap_or_default()
    };
    let old_clearance = old_cookie.split(';').find_map(|pair| {
        let mut parts = pair.trim().splitn(2, '=');
        if parts.next()? == "cf_clearance" {
            parts.next().map(str::to_string)
        } else {
            None
        }
    });

    let app_name = app_handle.package_info().name.clone();
    let banner_script = format!(
        r#"
        window.addEventListener('DOMContentLoaded', () => {{
            const banner = document.createElement('div');
            banner.style.position = 'fixed';
            banner.style.top = '0';
            banner.style.left = '0';
            banner.style.right = '0';
            banner.style.zIndex = '9999999';
            banner.style.padding = '12px 16px';
            banner.style.background = '#0f172a';
            banner.style.color = '#38bdf8';
            banner.style.fontSize = '13px';
            banner.style.fontWeight = '600';
            banner.style.fontFamily = 'system-ui, sans-serif';
            banner.style.textAlign = 'center';
            banner.style.borderBottom = '1px solid #1e293b';
            banner.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';
            banner.innerText = '🛡️ {app_name}: Please complete Cloudflare verification. This window will close automatically once verified.';
            document.body.prepend(banner);
        }});
    "#
    );

    let solver_window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "booru-cf-solver",
        tauri::WebviewUrl::External(parsed_url),
    )
    .title(format!("Konachan Cloudflare Verification - {app_name}"))
    .inner_size(620.0, 720.0)
    .incognito(true)
    .user_agent(CLOUDFLARE_SOLVER_UA)
    .initialization_script(&banner_script)
    .build()
    .map_err(|e| format!("Failed to create verification window: {e}"))?;

    let _ = solver_window.set_focus();

    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let max_checks = 180;
        for _ in 0..max_checks {
            thread::sleep(Duration::from_millis(800));

            let Some(window) = app_handle_clone.get_webview_window("booru-cf-solver") else {
                return Err("Verification was cancelled (window closed).".into());
            };

            if let Ok(cookies) = window.cookies() {
                let clearance_cookie = cookies.iter().find(|c| c.name() == "cf_clearance");
                let is_new_clearance = match (&clearance_cookie, &old_clearance) {
                    (Some(c), Some(old)) => !c.value().is_empty() && c.value() != old,
                    (Some(c), None) => !c.value().is_empty(),
                    _ => false,
                };

                if is_new_clearance {
                    // Brief delay to allow Cloudflare redirects to complete and set remaining session cookies
                    thread::sleep(Duration::from_millis(1000));

                    let final_cookies = window.cookies().unwrap_or(cookies);
                    let mut cookie_header_parts = Vec::new();
                    for c in &final_cookies {
                        let name = c.name();
                        let val = c.value();
                        cookie_header_parts.push(format!("{name}={val}"));
                    }
                    let cookie_str = cookie_header_parts.join("; ");

                    let mut current_settings = settings(&app_handle_clone)?;
                    current_settings
                        .credentials
                        .konachan
                        .insert("cookie".into(), cookie_str);
                    current_settings
                        .credentials
                        .konachan
                        .insert("userAgent".into(), CLOUDFLARE_SOLVER_UA.into());
                    current_settings.revision += 1;
                    validate_settings(&mut current_settings)?;
                    crate::save_app_data_entry(
                        &app_handle_clone,
                        "state",
                        "booru_gallery",
                        serde_json::to_value(&current_settings).map_err(|e| e.to_string())?,
                    )?;
                    clear_json_caches(&app_handle_clone);

                    let _ = window.close();

                    return Ok(serde_json::json!({
                        "ok": true,
                        "message": "Cloudflare clearance obtained successfully!"
                    }));
                }
            }
        }

        if let Some(window) = app_handle_clone.get_webview_window("booru-cf-solver") {
            let _ = window.close();
        }
        Err("Verification timed out. Please try again.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn booru_favorites(
    app_handle: AppHandle,
    mut request: FavoritesRequest,
) -> Result<Page, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let settings = settings(&app_handle)?;
        let provider = provider(&request.source)?;
        let caps = provider.capabilities();
        request.limit = request.limit.clamp(1, caps.max_page_size);
        if let Some(page) = request.page.filter(|_| !request.random) {
            request.cursor = Some(provider.cursor_for_page(page));
        }
        let credentials = settings.credentials.get(&request.source);
        provider.favorites(
            &client(settings.timeout)?,
            &request,
            &credentials,
            &normalized_blacklist(&settings.blacklist),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn booru_favorite_set(
    app_handle: AppHandle,
    source: String,
    post_id: String,
    favorite: bool,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let settings = settings(&app_handle)?;
        let value = provider(&source)?.set_favorite(
            &client(settings.timeout)?,
            &post_id,
            favorite,
            &settings.credentials.get(&source),
        )?;
        clear_json_caches(&app_handle);
        Ok(serde_json::json!({"favorite": value}))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn booru_clear_cache(app_handle: AppHandle) -> Result<Value, String> {
    clear_json_caches(&app_handle);
    let root = media_root(&app_handle)?;
    if root.exists() {
        fs::remove_dir_all(root).map_err(|e| e.to_string())?;
    }
    media_bytes(&app_handle).store(0, Ordering::Relaxed);
    Ok(serde_json::json!({"ok": true}))
}

fn clear_json_caches(app: &AppHandle) {
    for namespace in ["booru_search", "booru_query", "booru_detail", "booru_tags"] {
        let _ = crate::network_cache::clear_network_cache_sync(app, Some(namespace));
    }
}

fn media_hosts(source: &str) -> &'static [&'static str] {
    match source {
        "danbooru" => &["cdn.donmai.us", "danbooru.donmai.us"],
        "gelbooru" => &["gelbooru.com", "img3.gelbooru.com", "img4.gelbooru.com"],
        "safebooru" => &["safebooru.org", "images.safebooru.org"],
        "aitag" => &["ai-img.10118899.xyz"],
        "yandere" => &["yande.re", "files.yande.re", "assets.yande.re"],
        "konachan.net" | "konachan.com" => &["konachan.net", "konachan.com"],
        _ => &[],
    }
}

fn validate_media_url(source: &str, url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "invalid media URL".to_string())?;
    let host = parsed.host_str().unwrap_or_default().to_lowercase();
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !media_hosts(source).contains(&host.as_str())
    {
        return Err(format!(
            "{source} media URL is not on an allowed HTTPS host"
        ));
    }
    Ok(())
}

fn media_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("booru")
        .join("media"))
}

fn media_paths(app: &AppHandle, url: &str) -> Result<(PathBuf, PathBuf), String> {
    let digest = format!("{:x}", Sha256::digest(url.as_bytes()));
    let root = media_root(app)?;
    Ok((
        root.join(format!("{digest}.bin")),
        root.join(format!("{digest}.json")),
    ))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct MediaMeta {
    content_type: String,
}

fn read_media_cache(app: &AppHandle, url: &str) -> Option<(Vec<u8>, String)> {
    let (body, meta) = media_paths(app, url).ok()?;
    let metadata: MediaMeta = serde_json::from_slice(&fs::read(meta).ok()?).ok()?;
    let bytes = fs::read(&body).ok()?;
    let _ = fs::File::options()
        .write(true)
        .open(&body)
        .and_then(|file| file.set_modified(SystemTime::now()));
    Some((bytes, metadata.content_type))
}

fn write_media_cache(
    app: &AppHandle,
    url: &str,
    content_type: &str,
    bytes: &[u8],
) -> Result<u64, String> {
    if bytes.len() > MAX_CACHED_MEDIA_BYTES {
        return Ok(0);
    }
    let (body, meta) = media_paths(app, url)?;
    fs::create_dir_all(body.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
    let body_tmp = body.with_extension("bin.tmp");
    let meta_tmp = meta.with_extension("json.tmp");
    fs::write(&body_tmp, bytes).map_err(|e| e.to_string())?;
    fs::write(
        &meta_tmp,
        serde_json::to_vec(&MediaMeta {
            content_type: content_type.into(),
        })
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(body_tmp, body).map_err(|e| e.to_string())?;
    fs::rename(meta_tmp, meta).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

/// Approximate on-disk media size, seeded by one scan and re-synced by every prune,
/// so the per-download path is O(1) instead of a full directory walk.
static MEDIA_BYTES: OnceLock<AtomicU64> = OnceLock::new();

fn media_bytes(app: &AppHandle) -> &'static AtomicU64 {
    MEDIA_BYTES.get_or_init(|| AtomicU64::new(media_files(app).iter().map(|f| f.1).sum()))
}

/// `(path, size, last_used)` for every cached body, oldest first.
fn media_files(app: &AppHandle) -> Vec<(PathBuf, u64, Option<SystemTime>)> {
    let Ok(root) = media_root(app) else {
        return Vec::new();
    };
    let mut files: Vec<_> = fs::read_dir(&root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "bin"))
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            Some((entry.path(), metadata.len(), metadata.modified().ok()))
        })
        .collect();
    files.sort_by_key(|(_, _, used)| *used);
    files
}

#[derive(Default)]
struct DownloadState {
    done: bool,
    result: Option<Result<(Vec<u8>, String), String>>,
}
type SharedDownload = Arc<(Mutex<DownloadState>, Condvar)>;
static MEDIA_INFLIGHT: OnceLock<Mutex<HashMap<String, SharedDownload>>> = OnceLock::new();

pub fn handle_media_uri(app: &AppHandle, uri: &str) -> Result<(Vec<u8>, String), String> {
    let parsed = Url::parse(uri)
        .or_else(|_| Url::parse(&uri.replace("booru-image://", "http://")))
        .map_err(|e| e.to_string())?;
    let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
    let source = params
        .get("source")
        .ok_or("missing media source")?
        .to_string();
    let url = params.get("url").ok_or("missing media URL")?.to_string();
    provider(&source)?.validate_media_url(&url)?;
    if let Some(cached) = read_media_cache(app, &url) {
        return Ok(cached);
    }

    let (shared, owner) = {
        let mut inflight = MEDIA_INFLIGHT
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|e| e.to_string())?;
        if let Some(shared) = inflight.get(&url) {
            (shared.clone(), false)
        } else {
            let shared = Arc::new((Mutex::new(DownloadState::default()), Condvar::new()));
            inflight.insert(url.clone(), shared.clone());
            (shared, true)
        }
    };
    if owner {
        let result = download_media(app, &source, &url);
        let (lock, wake) = &*shared;
        if let Ok(mut state) = lock.lock() {
            state.result = Some(result.clone());
            state.done = true;
            wake.notify_all();
        }
        if let Ok(mut inflight) = MEDIA_INFLIGHT.get().unwrap().lock() {
            inflight.remove(&url);
        }
        result
    } else {
        let (lock, wake) = &*shared;
        let mut state = lock.lock().map_err(|e| e.to_string())?;
        while !state.done {
            state = wake.wait(state).map_err(|e| e.to_string())?;
        }
        state
            .result
            .clone()
            .ok_or_else(|| "media download finished without a result".to_string())?
    }
}

fn download_media(app: &AppHandle, source: &str, url: &str) -> Result<(Vec<u8>, String), String> {
    let settings = settings(app)?;
    let client = Client::builder()
        .user_agent("Koharu/1.0 (Native Booru Gallery)")
        .connect_timeout(Duration::from_secs(settings.timeout.min(30)))
        .timeout(Duration::from_secs(settings.timeout))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let provider = provider(source)?;
    let mut current = Url::parse(url).map_err(|e| e.to_string())?;
    for _ in 0..5 {
        provider.validate_media_url(current.as_str())?;
        let mut request = client.get(current.clone()).header(ACCEPT, "image/*");
        if let Some(referer) = provider.media_referer() {
            request = request.header(REFERER, referer);
        }
        let response = request.send().map_err(|e| e.to_string())?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("media redirect has no Location header")?;
            current = current.join(location).map_err(|e| e.to_string())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("{source} media returned {}", response.status()));
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .split(';')
            .next()
            .unwrap_or_default()
            .to_lowercase();
        if !["image/jpeg", "image/png", "image/webp", "image/gif"].contains(&content_type.as_str())
        {
            return Err(format!("unsupported media Content-Type: {content_type}"));
        }
        if response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .is_some_and(|size| size > MAX_MEDIA_BYTES)
        {
            return Err("media exceeds 100 MiB".into());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_MEDIA_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_MEDIA_BYTES {
            return Err("media exceeds 100 MiB".into());
        }
        let written = write_media_cache(app, url, &content_type, &bytes)?;
        let total = media_bytes(app).fetch_add(written, Ordering::Relaxed) + written;
        if total > settings.cache_budget_mi_b * 1024 * 1024 {
            prune_media(app, settings.cache_budget_mi_b)?;
        }
        return Ok((bytes, content_type));
    }
    Err("media redirected too many times".into())
}

fn prune_media(app: &AppHandle, budget_mib: u64) -> Result<(), String> {
    let files = media_files(app);
    let mut total: u64 = files.iter().map(|(_, size, _)| *size).sum();
    let budget = budget_mib * 1024 * 1024;
    for (body, size, _) in files {
        if total <= budget {
            break;
        }
        if fs::remove_file(&body).is_ok() {
            total = total.saturating_sub(size);
        }
        let _ = fs::remove_file(body.with_extension("json"));
    }
    MEDIA_BYTES
        .get_or_init(|| AtomicU64::new(total))
        .store(total, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairs_spaced_tags_without_touching_operators() {
        let tokens = tokenize_query("blue archive, -rating:e");
        let known = HashSet::from(["blue_archive".into()]);
        assert_eq!(
            repair_spaced_tags(&tokens, &known),
            ["blue_archive", "-rating:e"]
        );
    }

    #[test]
    fn validates_provider_media_hosts() {
        assert!(validate_media_url("danbooru", "https://cdn.donmai.us/a.jpg").is_ok());
        assert!(validate_media_url("danbooru", "https://example.com/a.jpg").is_err());
        assert!(validate_media_url("danbooru", "http://cdn.donmai.us/a.jpg").is_err());
    }

    #[test]
    fn maps_ratings_and_cursor_rules() {
        assert!(rating_matches("danbooru", "g", &["general".into()]));
        assert!(rating_matches("safebooru", "s", &["safe".into()]));
        assert_eq!(provider("gelbooru").unwrap().cursor_for_page(3), "2");
    }

    #[test]
    fn filters_blacklisted_and_non_static_posts() {
        let post = serde_json::json!({"tag_string": "solo gore", "file_ext": "jpg"});
        assert!(is_blacklisted(&post, &HashSet::from(["gore".into()])));
        assert!(is_static_post(&post));
        assert!(!is_static_post(&serde_json::json!({"file_ext": "mp4"})));
    }

    #[test]
    fn keeps_frontend_settings_wire_names() {
        let settings = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(settings["cacheBudgetMiB"], 1024);
        let update: SettingsUpdate =
            serde_json::from_value(serde_json::json!({"cacheBudgetMiB": 2048})).unwrap();
        assert_eq!(update.cache_budget_mi_b, Some(2048));
    }
}
