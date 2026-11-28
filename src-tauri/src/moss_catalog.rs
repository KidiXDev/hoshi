use flate2::read::GzDecoder;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

const DATASET_URL: &str =
    "https://huggingface.co/datasets/hide1/MOSS-Image-Character-Catalog/resolve/main";
const CATALOG_FILE: &str = "catalog.json.gz";
const CATEGORIES_FILE: &str = "style-categories.json";
const REFRESH_AFTER: Duration = Duration::from_secs(7 * 24 * 3600);
const DEFAULT_PAGE_SIZE: usize = 60;
const MAX_PAGE_SIZE: usize = 200;
const COPYRIGHT_FACET_LIMIT: usize = 300;

static CATALOG: Mutex<Option<Arc<Catalog>>> = Mutex::new(None);

// Raw dataset shape
#[derive(Deserialize)]
struct RawCatalog {
    entries: Vec<RawEntry>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawFacets {
    hair_color: Vec<String>,
    hair_length: Vec<String>,
    eye_color: Vec<String>,
    gender: Vec<String>,
    outfit: Vec<String>,
}

#[derive(Deserialize)]
struct RawEntry {
    id: String,
    key: String,
    name: String,
    copyright: String,
    kind: String,
    added_at: String,
    #[serde(default)]
    copy_tags: String,
    #[serde(default)]
    copy_prompt: String,
    reuse_generation_prompt: Option<String>,
    generation_prompt: Option<String>,
    source_count: Option<u32>,
    #[serde(default)]
    facets: RawFacets,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    deleted: bool,
}

#[derive(Deserialize)]
struct RawCategory {
    id: String,
    en: String,
}

#[derive(Deserialize)]
struct RawCategories {
    categories: Vec<RawCategory>,
    assignments: HashMap<String, String>,
}

// Served catalog
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MossEntry {
    id: String,
    name: String,
    copyright: String,
    kind: String,
    tags: String,
    caption: String,
    prompt: String,
    source_count: u32,
    gender: Vec<String>,
    hair_color: Vec<String>,
    hair_length: Vec<String>,
    eye_color: Vec<String>,
    outfit: Vec<String>,
    category: Option<String>,
    added_at: String,
    #[serde(skip)]
    search_text: String,
}

#[derive(Serialize, Clone)]
pub struct FacetValue {
    value: String,
    label: String,
    count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MossFacets {
    characters: usize,
    styles: usize,
    copyright: Vec<FacetValue>,
    gender: Vec<FacetValue>,
    hair_color: Vec<FacetValue>,
    hair_length: Vec<FacetValue>,
    eye_color: Vec<FacetValue>,
    outfit: Vec<FacetValue>,
    category: Vec<FacetValue>,
}

struct Catalog {
    entries: Vec<MossEntry>,
    facets: MossFacets,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MossQuery {
    query: Option<String>,
    kind: Option<String>,
    id: Option<String>,
    copyright: Option<String>,
    gender: Option<String>,
    hair_color: Option<String>,
    hair_length: Option<String>,
    eye_color: Option<String>,
    outfit: Option<String>,
    category: Option<String>,
    sort: Option<String>,
    seed: Option<u64>,
    page: Option<usize>,
    page_size: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MossPage {
    total: usize,
    page: usize,
    pages: usize,
    page_size: usize,
    results: Vec<MossEntry>,
}

// Download and cache
fn client() -> Result<&'static Client, String> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .user_agent("Koharu/1.0 (MOSS Catalog)")
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(180))
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn fetch(path: &str) -> Result<Vec<u8>, String> {
    let response = client()?
        .get(format!("{DATASET_URL}/{path}"))
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Hugging Face returned {status} for {path}"));
    }
    Ok(response.bytes().map_err(|e| e.to_string())?.to_vec())
}

fn is_fresh(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age < REFRESH_AFTER)
}

fn cached_file(dir: &Path, name: &str, force_refresh: bool) -> Result<Vec<u8>, String> {
    let path = dir.join(name);
    if !force_refresh && is_fresh(&path) {
        if let Ok(bytes) = fs::read(&path) {
            return Ok(bytes);
        }
    }
    match fetch(name) {
        Ok(bytes) => {
            let partial = dir.join(format!("{name}.part"));
            fs::write(&partial, &bytes)
                .and_then(|()| fs::rename(&partial, &path))
                .map_err(|e| e.to_string())?;
            Ok(bytes)
        }
        Err(error) => fs::read(&path).map_err(|_| error),
    }
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("moss_catalog");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Catalog building
fn facet_values(counts: HashMap<String, usize>, limit: usize) -> Vec<FacetValue> {
    let mut values: Vec<FacetValue> = counts
        .into_iter()
        .map(|(value, count)| FacetValue {
            label: value.clone(),
            value,
            count,
        })
        .collect();
    values.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    values.truncate(limit);
    values
}

fn count_into(counts: &mut HashMap<String, usize>, values: &[String]) {
    for value in values {
        *counts.entry(value.clone()).or_default() += 1;
    }
}

fn build_catalog(raw: RawCatalog, categories: RawCategories) -> Catalog {
    let category_labels: HashMap<&str, &str> = categories
        .categories
        .iter()
        .map(|category| (category.id.as_str(), category.en.as_str()))
        .collect();

    let entries: Vec<MossEntry> = raw
        .entries
        .into_iter()
        .filter(|entry| !entry.hidden && !entry.deleted)
        .map(|entry| {
            let category = categories.assignments.get(&entry.key).cloned();
            let search_text =
                format!("{} {} {}", entry.name, entry.copyright, entry.copy_tags).to_lowercase();
            MossEntry {
                prompt: entry
                    .reuse_generation_prompt
                    .or(entry.generation_prompt)
                    .unwrap_or_else(|| entry.copy_prompt.clone()),
                id: entry.id,
                name: entry.name,
                copyright: entry.copyright,
                kind: entry.kind,
                tags: entry.copy_tags,
                caption: entry.copy_prompt,
                source_count: entry.source_count.unwrap_or(0),
                gender: entry.facets.gender,
                hair_color: entry.facets.hair_color,
                hair_length: entry.facets.hair_length,
                eye_color: entry.facets.eye_color,
                outfit: entry.facets.outfit,
                category,
                added_at: entry.added_at,
                search_text,
            }
        })
        .collect();

    let mut copyright = HashMap::new();
    let mut gender = HashMap::new();
    let mut hair_color = HashMap::new();
    let mut hair_length = HashMap::new();
    let mut eye_color = HashMap::new();
    let mut outfit = HashMap::new();
    let mut category = HashMap::new();
    for entry in &entries {
        if entry.kind == "style" {
            if let Some(id) = &entry.category {
                *category.entry(id.clone()).or_default() += 1;
            }
            continue;
        }
        *copyright.entry(entry.copyright.clone()).or_default() += 1;
        count_into(&mut gender, &entry.gender);
        count_into(&mut hair_color, &entry.hair_color);
        count_into(&mut hair_length, &entry.hair_length);
        count_into(&mut eye_color, &entry.eye_color);
        count_into(&mut outfit, &entry.outfit);
    }

    let mut category = facet_values(category, usize::MAX);
    for value in &mut category {
        if let Some(label) = category_labels.get(value.value.as_str()) {
            value.label = (*label).to_string();
        }
    }

    let styles = entries.iter().filter(|entry| entry.kind == "style").count();
    let facets = MossFacets {
        characters: entries.len() - styles,
        styles,
        copyright: facet_values(copyright, COPYRIGHT_FACET_LIMIT),
        gender: facet_values(gender, usize::MAX),
        hair_color: facet_values(hair_color, usize::MAX),
        hair_length: facet_values(hair_length, usize::MAX),
        eye_color: facet_values(eye_color, usize::MAX),
        outfit: facet_values(outfit, COPYRIGHT_FACET_LIMIT),
        category,
    };
    Catalog { entries, facets }
}

fn load_catalog(app: &AppHandle, force_refresh: bool) -> Result<Arc<Catalog>, String> {
    let mut slot = CATALOG.lock().unwrap_or_else(PoisonError::into_inner);
    if !force_refresh {
        if let Some(catalog) = slot.as_ref() {
            return Ok(catalog.clone());
        }
    }
    let dir = cache_dir(app)?;
    let catalog_bytes = cached_file(&dir, CATALOG_FILE, force_refresh)?;
    let categories_bytes = cached_file(&dir, CATEGORIES_FILE, force_refresh)?;
    let mut catalog_json = Vec::new();
    GzDecoder::new(catalog_bytes.as_slice())
        .read_to_end(&mut catalog_json)
        .map_err(|e| format!("Invalid MOSS catalog: {e}"))?;
    let raw: RawCatalog =
        serde_json::from_slice(&catalog_json).map_err(|e| format!("Invalid MOSS catalog: {e}"))?;
    let categories: RawCategories = serde_json::from_slice(&categories_bytes)
        .map_err(|e| format!("Invalid MOSS style categories: {e}"))?;
    let catalog = Arc::new(build_catalog(raw, categories));
    *slot = Some(catalog.clone());
    Ok(catalog)
}

// Search
fn has_value(values: &[String], wanted: &Option<String>) -> bool {
    wanted
        .as_deref()
        .is_none_or(|wanted| values.iter().any(|value| value == wanted))
}

fn matches(entry: &MossEntry, query: &MossQuery, terms: &[String]) -> bool {
    query.kind.as_deref().is_none_or(|kind| entry.kind == kind)
        && query.id.as_deref().is_none_or(|id| entry.id == id)
        && query
            .copyright
            .as_deref()
            .is_none_or(|copyright| entry.copyright == copyright)
        && query
            .category
            .as_deref()
            .is_none_or(|category| entry.category.as_deref() == Some(category))
        && has_value(&entry.gender, &query.gender)
        && has_value(&entry.hair_color, &query.hair_color)
        && has_value(&entry.hair_length, &query.hair_length)
        && has_value(&entry.eye_color, &query.eye_color)
        && has_value(&entry.outfit, &query.outfit)
        && terms.iter().all(|term| entry.search_text.contains(term))
}

fn name_rank(entry: &MossEntry, phrase: &str) -> u8 {
    if phrase.is_empty() {
        return 0;
    }
    let name = entry.name.to_lowercase();
    if name == phrase {
        3
    } else if name.starts_with(phrase) {
        2
    } else if name.contains(phrase) {
        1
    } else {
        0
    }
}

fn random_key(seed: u64, id: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    (seed, id).hash(&mut hasher);
    hasher.finish()
}

fn search(catalog: &Catalog, query: &MossQuery) -> MossPage {
    let phrase = query.query.as_deref().unwrap_or("").trim().to_lowercase();
    let terms: Vec<String> = phrase.split_whitespace().map(str::to_owned).collect();
    let mut hits: Vec<&MossEntry> = catalog
        .entries
        .iter()
        .filter(|entry| matches(entry, query, &terms))
        .collect();

    match query.sort.as_deref() {
        Some("az") => hits.sort_by_cached_key(|entry| entry.name.to_lowercase()),
        Some("newest") => hits.sort_by(|a, b| b.added_at.cmp(&a.added_at)),
        Some("random") => {
            let seed = query.seed.unwrap_or(0);
            hits.sort_by_cached_key(|entry| random_key(seed, &entry.id));
        }
        _ => hits
            .sort_by_cached_key(|entry| Reverse((name_rank(entry, &phrase), entry.source_count))),
    }

    let page_size = query
        .page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let total = hits.len();
    let pages = total.div_ceil(page_size).max(1);
    let page = query.page.unwrap_or(1).max(1);
    let results = hits
        .into_iter()
        .skip((page - 1) * page_size)
        .take(page_size)
        .cloned()
        .collect();
    MossPage {
        total,
        page,
        pages,
        page_size,
        results,
    }
}

// Commands
#[tauri::command]
pub async fn moss_catalog_search(
    app_handle: AppHandle,
    query: MossQuery,
) -> Result<MossPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_catalog(&app_handle, false).map(|catalog| search(&catalog, &query))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn moss_catalog_facets(
    app_handle: AppHandle,
    force_refresh: Option<bool>,
) -> Result<MossFacets, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_catalog(&app_handle, force_refresh.unwrap_or(false))
            .map(|catalog| catalog.facets.clone())
    })
    .await
    .map_err(|e| e.to_string())?
}

// Image proxy
fn is_media_path(path: &str) -> bool {
    let mut parts = path.split('/');
    let (Some(folder), Some(shard), Some(file), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let is_hex = |text: &str| text.bytes().all(|byte| byte.is_ascii_hexdigit());
    let Some(id) = file.strip_suffix(".webp") else {
        return false;
    };
    matches!(folder, "images" | "thumbnails")
        && shard.len() == 2
        && is_hex(shard)
        && id.len() == 32
        && is_hex(id)
        && id.starts_with(shard)
}

pub fn media(path: &str) -> Option<(Vec<u8>, String)> {
    is_media_path(path)
        .then(|| fetch(path).ok())
        .flatten()
        .map(|bytes| (bytes, "image/webp".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, kind: &str, source_count: u32) -> RawEntry {
        RawEntry {
            id: format!("{name}-id"),
            key: format!("user/{name}-id"),
            name: name.into(),
            copyright: "series".into(),
            kind: kind.into(),
            added_at: "2026-10-17".into(),
            copy_tags: format!("{name}, series, 1girl"),
            copy_prompt: String::new(),
            reuse_generation_prompt: None,
            generation_prompt: None,
            source_count: Some(source_count),
            facets: RawFacets {
                hair_color: vec!["blue hair".into()],
                ..RawFacets::default()
            },
            hidden: false,
            deleted: false,
        }
    }

    fn catalog(entries: Vec<RawEntry>) -> Catalog {
        build_catalog(
            RawCatalog { entries },
            RawCategories {
                categories: Vec::new(),
                assignments: HashMap::new(),
            },
        )
    }

    fn names(page: &MossPage) -> Vec<&str> {
        page.results
            .iter()
            .map(|entry| entry.name.as_str())
            .collect()
    }

    #[test]
    fn ranks_exact_name_above_popular_partial_matches() {
        let catalog = catalog(vec![
            entry("miku fan", "character", 900),
            entry("miku", "character", 10),
        ]);
        let query = MossQuery {
            query: Some("Miku".into()),
            ..MossQuery::default()
        };
        assert_eq!(names(&search(&catalog, &query)), ["miku", "miku fan"]);
    }

    #[test]
    fn filters_by_kind_and_facet() {
        let catalog = catalog(vec![entry("a", "character", 1), entry("b", "style", 1)]);
        let query = MossQuery {
            kind: Some("character".into()),
            hair_color: Some("blue hair".into()),
            ..MossQuery::default()
        };
        assert_eq!(names(&search(&catalog, &query)), ["a"]);
        assert_eq!(catalog.facets.styles, 1);
    }

    #[test]
    fn paginates_results() {
        let catalog = catalog(
            (0..5)
                .map(|i| entry(&format!("c{i}"), "character", i))
                .collect(),
        );
        let query = MossQuery {
            page: Some(3),
            page_size: Some(2),
            ..MossQuery::default()
        };
        let page = search(&catalog, &query);
        assert_eq!((page.total, page.pages, names(&page)), (5, 3, vec!["c0"]));
    }

    #[test]
    fn accepts_only_dataset_media_paths() {
        assert!(is_media_path(
            "thumbnails/89/89bd1748a67b5fce996a823d2f784cfb.webp"
        ));
        assert!(!is_media_path(
            "thumbnails/00/89bd1748a67b5fce996a823d2f784cfb.webp"
        ));
        assert!(!is_media_path("catalog.json.gz"));
        assert!(!is_media_path(
            "images/89/../89bd1748a67b5fce996a823d2f784cfb.webp"
        ));
    }
}
