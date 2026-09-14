use image::ImageReader;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

// Data types

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub category: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Stem of the thumbnail file (without extension) stored under thumbnails dir.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_id: Option<String>,
    /// Category-specific payload stored as raw JSON.
    pub data: Value,
    pub created_at: u64,
    pub updated_at: u64,
}

// Internal path helpers

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn library_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("library");
    Ok(dir)
}

fn category_dir(app_handle: &AppHandle, category: &str) -> Result<PathBuf, String> {
    let sanitized = sanitize_segment(category);
    let dir = library_root(app_handle)?.join(sanitized);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn thumbnails_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = library_root(app_handle)?.join("thumbnails");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sanitize_segment(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "misc".to_string()
    } else {
        trimmed.to_string()
    }
}

fn generate_id(name: &str, category: &str) -> String {
    let ts = now_ms();
    let mut hasher = Sha256::new();
    hasher.update(format!("{name}{category}{ts}").as_bytes());
    let hash = hasher.finalize();
    format!("{:x}", hash)[..16].to_string()
}

fn item_path(app_handle: &AppHandle, category: &str, id: &str) -> Result<PathBuf, String> {
    let safe_id = sanitize_segment(id);
    Ok(category_dir(app_handle, category)?.join(format!("{safe_id}.json")))
}

// Tauri commands — CRUD

/// Items are small local JSON files, so the full `data` payload is returned;
/// callers filter/preview client-side without a second round-trip per item.
#[tauri::command]
pub fn library_list_items(
    app_handle: AppHandle,
    category: String,
) -> Result<Vec<LibraryItem>, String> {
    let dir = category_dir(&app_handle, &category)?;
    let mut entries: Vec<LibraryItem> = Vec::new();

    if let Ok(dir_entries) = fs::read_dir(&dir) {
        for entry in dir_entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(item) = serde_json::from_str::<LibraryItem>(&content) {
                        entries.push(item);
                    }
                }
            }
        }
    }

    clean_orphaned_thumbnails(&app_handle);
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(entries)
}

#[tauri::command]
pub fn library_get_item(
    app_handle: AppHandle,
    id: String,
    category: String,
) -> Result<LibraryItem, String> {
    let path = item_path(&app_handle, &category, &id)?;
    let content = fs::read_to_string(&path).map_err(|e| format!("Item not found: {e}"))?;
    serde_json::from_str::<LibraryItem>(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_save_item(
    app_handle: AppHandle,
    mut item: LibraryItem,
) -> Result<LibraryItem, String> {
    let now = now_ms();

    if item.id.is_empty() {
        item.id = generate_id(&item.name, &item.category);
        item.created_at = now;
    } else {
        // If updating an existing item, remove any old thumbnail that was replaced or removed
        let old_path = item_path(&app_handle, &item.category, &item.id)?;
        if old_path.exists() {
            if let Ok(old_content) = fs::read_to_string(&old_path) {
                if let Ok(old_item) = serde_json::from_str::<LibraryItem>(&old_content) {
                    if let Some(old_thumb) = old_item.thumbnail_id {
                        if item.thumbnail_id.as_deref() != Some(&old_thumb) {
                            delete_thumbnail_file(&app_handle, &old_thumb);
                        }
                    }
                }
            }
        }
    }
    item.updated_at = now;

    let path = item_path(&app_handle, &item.category, &item.id)?;
    let json = serde_json::to_string_pretty(&item).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;

    Ok(item)
}

#[tauri::command]
pub fn library_delete_item(
    app_handle: AppHandle,
    id: String,
    category: String,
) -> Result<(), String> {
    let path = item_path(&app_handle, &category, &id)?;
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(item) = serde_json::from_str::<LibraryItem>(&content) {
                if let Some(thumb_id) = item.thumbnail_id {
                    delete_thumbnail_file(&app_handle, &thumb_id);
                }
            }
        }
        delete_thumbnail_file(&app_handle, &id);
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    clean_orphaned_thumbnails(&app_handle);
    Ok(())
}

pub fn delete_thumbnail_file(app_handle: &AppHandle, thumb_id: &str) {
    if let Ok(thumb_dir) = thumbnails_dir(app_handle) {
        let safe = sanitize_segment(thumb_id);
        let path = thumb_dir.join(format!("{safe}.jpg"));
        if path.exists() {
            let _ = fs::remove_file(&path);
        }
    }
}

pub fn clean_orphaned_thumbnails(app_handle: &AppHandle) {
    let thumb_dir = match thumbnails_dir(app_handle) {
        Ok(d) => d,
        Err(_) => return,
    };

    let mut referenced_ids = HashSet::new();
    let categories = ["prompts", "loras", "characters"];
    for cat in &categories {
        if let Ok(dir) = category_dir(app_handle, cat) {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension().map_or(false, |ext| ext == "json") {
                        if let Ok(content) = fs::read_to_string(&p) {
                            if let Ok(item) = serde_json::from_str::<LibraryItem>(&content) {
                                if let Some(tid) = item.thumbnail_id {
                                    referenced_ids.insert(sanitize_segment(&tid));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(entries) = fs::read_dir(&thumb_dir) {
        let now = SystemTime::now();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "jpg") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if !referenced_ids.contains(stem) {
                        let is_recent = entry
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .map_or(false, |mod_time| {
                                now.duration_since(mod_time)
                                    .map_or(false, |d| d.as_secs() < 60)
                            });
                        if !is_recent {
                            let _ = fs::remove_file(&path);
                        }
                    }
                }
            }
        }
    }
}

// Tauri commands — Thumbnails

/// Copy an image file from any path on disk into the library thumbnails dir,
/// converting it to JPEG. Returns the thumbnail_id (filename stem).
#[tauri::command]
pub fn library_save_thumbnail_from_path(
    app_handle: AppHandle,
    item_id: String,
    source_path: String,
) -> Result<String, String> {
    let src = source_path.trim().trim_matches(|c| c == '"' || c == '\'');
    let src_path = std::path::Path::new(src);
    let bytes = fs::read(src_path).map_err(|e| format!("Cannot read source: {e}"))?;
    save_thumbnail_bytes(&app_handle, &item_id, &bytes)
}

/// Decode a base64 data-URL image and save it as JPEG in the thumbnails dir.
/// Returns the thumbnail_id.
#[tauri::command]
pub fn library_save_thumbnail_from_data_url(
    app_handle: AppHandle,
    item_id: String,
    data_url: String,
) -> Result<String, String> {
    let base64_data = data_url
        .splitn(2, ',')
        .nth(1)
        .ok_or("Invalid data URL")?;
    let bytes = base64_decode(base64_data)?;
    save_thumbnail_bytes(&app_handle, &item_id, &bytes)
}

/// Download an image from a remote URL and save it as JPEG in the thumbnails dir.
/// Returns the thumbnail_id.
#[tauri::command]
pub async fn library_save_thumbnail_from_url(
    app_handle: AppHandle,
    item_id: String,
    url: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Koharu/1.0")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client
            .get(&url)
            .send()
            .map_err(|e| format!("Failed to download image: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("Server returned HTTP {}", resp.status()));
        }
        let bytes = resp
            .bytes()
            .map_err(|e| format!("Failed to read image bytes: {e}"))?;
        save_thumbnail_bytes(&app_handle, &item_id, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use std::collections::HashMap;
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let lut: HashMap<char, u8> = alphabet.chars().enumerate().map(|(i, c)| (c, i as u8)).collect();
    let input: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits = 0u8;
    for c in input.chars() {
        if c == '=' {
            break;
        }
        let v = lut.get(&c).copied().ok_or_else(|| format!("Invalid base64 char: {c}"))? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

fn save_thumbnail_bytes(
    app_handle: &AppHandle,
    item_id: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let thumb_id = sanitize_segment(item_id);
    let thumb_dir = thumbnails_dir(app_handle)?;
    let dest = thumb_dir.join(format!("{thumb_id}.jpg"));

    let img = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| format!("Cannot decode image: {e}"))?;

    // Handle alpha channel transparency by compositing over clean white background
    let img = if img.color().has_alpha() {
        let rgba = img.to_rgba8();
        let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
        for (x, y, pixel) in rgba.enumerate_pixels() {
            let a = pixel[3] as f32 / 255.0;
            let r = ((pixel[0] as f32 * a) + (255.0 * (1.0 - a))) as u8;
            let g = ((pixel[1] as f32 * a) + (255.0 * (1.0 - a))) as u8;
            let b = ((pixel[2] as f32 * a) + (255.0 * (1.0 - a))) as u8;
            rgb.put_pixel(x, y, image::Rgb([r, g, b]));
        }
        image::DynamicImage::ImageRgb8(rgb)
    } else {
        img
    };

    // High-quality downsampling with Lanczos3:
    // Only downscale if the image exceeds 1024px on any side, preserving crisp line art,
    // hair details, and textures without blurry bilinear scaling.
    let (w, h) = (img.width(), img.height());
    let resized = if w > 1024 || h > 1024 {
        img.resize(1024, 1024, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    // Encode as high-quality JPEG (Quality 90):
    // Preserves near-original visual fidelity with imperceptible compression while keeping file size compact (~80-160 KB).
    let mut out_bytes = Vec::with_capacity(128 * 1024);
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out_bytes, 90);
    encoder
        .encode_image(&resized)
        .map_err(|e| format!("Cannot encode JPEG: {e}"))?;

    fs::write(&dest, out_bytes).map_err(|e| format!("Cannot save JPEG: {e}"))?;

    Ok(thumb_id)
}

#[tauri::command]
pub fn library_read_thumbnail(
    app_handle: AppHandle,
    thumbnail_id: String,
) -> Result<Vec<u8>, String> {
    let thumb_dir = thumbnails_dir(&app_handle)?;
    let safe_id = sanitize_segment(&thumbnail_id);
    let path = thumb_dir.join(format!("{safe_id}.jpg"));
    fs::read(&path).map_err(|e| format!("Thumbnail not found: {e}"))
}

// Tauri commands — Folder access

#[tauri::command]
pub fn library_open_folder(
    app_handle: AppHandle,
    category: Option<String>,
) -> Result<(), String> {
    let dir = match category {
        Some(cat) => category_dir(&app_handle, &cat)?,
        None => {
            let root = library_root(&app_handle)?;
            fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            root
        }
    };
    crate::show_in_folder(dir.to_string_lossy().to_string())
}

// URI scheme handler (called from lib.rs)

/// Read a thumbnail by ID for the `koharu-library` URI scheme.
/// URI format: koharu-library://thumb/<thumbnail_id>
pub fn handle_library_uri(
    app_handle: &AppHandle,
    path: &str,
) -> Option<(Vec<u8>, &'static str)> {
    let clean = path.trim_matches('/');
    let mut parts = clean.split('/');
    let first = parts.next()?;
    let id = if first == "thumb" {
        parts.next().unwrap_or(first)
    } else {
        first
    };
    let safe_id = sanitize_segment(id);
    if safe_id.is_empty() {
        return None;
    }
    match library_read_thumbnail(app_handle.clone(), safe_id) {
        Ok(bytes) => Some((bytes, "image/jpeg")),
        Err(_) => None,
    }
}
