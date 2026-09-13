use reqwest::blocking::{Client, Response};
use reqwest::header::{CACHE_CONTROL, RANGE};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

use crate::download_manager::{DownloadManager, DownloadRecord, NewDownload};
use crate::network_cache;

const API_BASE: &str = "https://civitai.com/api/v1";
const CACHE_NS: &str = "civitai";
const LIST_TTL_SECONDS: u64 = 5 * 60;
const MODEL_TTL_SECONDS: u64 = 60 * 60;
const ENUMS_TTL_SECONDS: u64 = 24 * 3600;

/// Disk-cache wrapper: `key` must include everything that changes the response
/// (URL + API key, since the key gates restricted/early-access content).
fn cached_json(
    app: &AppHandle,
    key: &str,
    ttl: u64,
    fetch: impl FnOnce() -> Result<Value, String>,
) -> Result<Value, String> {
    if let Some(cached) = network_cache::read_cache(app, CACHE_NS, key) {
        return Ok(cached);
    }
    let value = fetch()?;
    let _ = network_cache::write_cache(app, CACHE_NS, key, &value, ttl);
    Ok(value)
}

pub(crate) fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("ComfyGUI/1.0")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60 * 60 * 6))
        .build()
        .map_err(|error| error.to_string())
}

pub(crate) fn authorized(
    request: reqwest::blocking::RequestBuilder,
    api_key: &str,
) -> reqwest::blocking::RequestBuilder {
    if api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(api_key.trim())
    }
}

fn resolve_download_url(
    client: &Client,
    mut url: reqwest::Url,
    api_key: &str,
) -> Result<String, String> {
    for attempt in 0..2 {
        if attempt > 0 {
            url.query_pairs_mut().append_pair(
                "comfygui_refresh",
                &SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
                    .to_string(),
            );
        }
        let response = authorized(client.get(url.clone()), api_key)
            .header(RANGE, "bytes=0-0")
            .header(CACHE_CONTROL, "no-cache")
            .send()
            .map_err(|_| "Failed to resolve Civitai download. Please retry.".to_string())?;
        if response.status().is_success() {
            return Ok(response.url().to_string());
        }
        if response.status() == reqwest::StatusCode::FORBIDDEN && attempt == 0 {
            continue;
        }
        let service = if response.url().domain() == Some("civitai.com") {
            "Civitai"
        } else {
            "Civitai CDN"
        };
        return Err(format!("{service} model download failed with {}. Check the API key and this model's access requirements.", response.status()));
    }
    unreachable!()
}

fn response_json(response: Response) -> Result<Value, String> {
    let status = response.status();
    if status.is_success() {
        response.json().map_err(|error| error.to_string())
    } else {
        let message = response.text().unwrap_or_default();
        Err(if message.is_empty() {
            format!("Civitai returned {status}")
        } else {
            format!("Civitai returned {status}: {message}")
        })
    }
}

fn models_blocking(
    app: &AppHandle,
    query: String,
    model_type: String,
    base_model: String,
    sort: String,
    period: String,
    cursor: Option<String>,
    api_key: String,
    nsfw: Option<bool>,
) -> Result<Value, String> {
    let mut url =
        reqwest::Url::parse(&format!("{API_BASE}/models")).map_err(|error| error.to_string())?;
    {
        let mut params = url.query_pairs_mut();
        params.append_pair("limit", "24");
        params.append_pair(
            "nsfw",
            if nsfw.unwrap_or(false) {
                "true"
            } else {
                "false"
            },
        );
        params.append_pair("primaryFileOnly", "true");
        params.append_pair("sort", &sort);
        params.append_pair("period", &period);
        if !query.trim().is_empty() {
            params.append_pair("query", query.trim());
        }
        for model_type in model_type
            .split(',')
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            params.append_pair("types", model_type);
        }
        if !base_model.trim().is_empty() {
            params.append_pair("baseModels", base_model.trim());
        }
        if let Some(cursor) = cursor.filter(|value| !value.is_empty()) {
            params.append_pair("cursor", &cursor);
        }
    }
    cached_json(app, &format!("{url}|{api_key}"), LIST_TTL_SECONDS, || {
        response_json(
            authorized(client()?.get(url), &api_key)
                .send()
                .map_err(|e| e.to_string())?,
        )
    })
}

#[tauri::command]
pub async fn models(
    app_handle: AppHandle,
    query: String,
    model_type: String,
    base_model: String,
    sort: String,
    period: String,
    cursor: Option<String>,
    api_key: String,
    nsfw: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        models_blocking(
            &app_handle,
            query,
            model_type,
            base_model,
            sort,
            period,
            cursor,
            api_key,
            nsfw,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn enums(app_handle: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cached_json(&app_handle, "enums", ENUMS_TTL_SECONDS, || {
            let response = client()?
                .get(format!("{API_BASE}/enums"))
                .send()
                .map_err(|error| error.to_string())?;
            response_json(response)
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn fetch_model_by_id(app: &AppHandle, id: u64, api_key: &str) -> Result<Value, String> {
    let url = format!("{API_BASE}/models/{id}");
    cached_json(app, &format!("{url}|{api_key}"), MODEL_TTL_SECONDS, || {
        let client = client()?;
        response_json(
            authorized(client.get(&url), api_key)
                .send()
                .map_err(|error| error.to_string())?,
        )
    })
}

#[tauri::command]
pub async fn model_by_id(app_handle: AppHandle, id: u64, api_key: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_model_by_id(&app_handle, id, &api_key))
        .await
        .map_err(|error| error.to_string())?
}

/// Cached `GET /model-versions/...` used by the downloader and the Model Manager.
/// A 404 is reported as the `NOT_FOUND` sentinel and never cached.
pub(crate) fn fetch_model_version(
    app: &AppHandle,
    url: &str,
    api_key: &str,
) -> Result<Value, String> {
    cached_json(app, &format!("{url}|{api_key}"), MODEL_TTL_SECONDS, || {
        let response = authorized(client()?.get(url), api_key)
            .send()
            .map_err(|error| error.to_string())?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err("NOT_FOUND".into());
        }
        response_json(response)
    })
}

pub(crate) fn model_version_url(version_id: u64) -> String {
    format!("{API_BASE}/model-versions/{version_id}")
}

pub(crate) fn model_version_by_hash_url(sha256: &str) -> Result<String, String> {
    let hash = sha256.trim();
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("A full SHA256 hash (64 hex characters) is required.".into());
    }
    Ok(format!(
        "{API_BASE}/model-versions/by-hash/{}",
        hash.to_ascii_uppercase()
    ))
}

#[tauri::command]
pub async fn model_version_by_id(
    app_handle: AppHandle,
    version_id: u64,
    api_key: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch_model_version(&app_handle, &model_version_url(version_id), &api_key)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn model_version_by_hash(
    app_handle: AppHandle,
    sha256: String,
    api_key: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let url = model_version_by_hash_url(&sha256)?;
        fetch_model_version(&app_handle, &url, &api_key)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Writes `<stem>.civitai.info` and `<stem>.cm-info.json` next to a model file.
pub(crate) fn write_sidecars(directory: &Path, stem: &str, metadata: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(metadata).map_err(|error| error.to_string())?;
    fs::write(directory.join(format!("{stem}.civitai.info")), &bytes)
        .map_err(|error| error.to_string())?;
    fs::write(directory.join(format!("{stem}.cm-info.json")), bytes)
        .map_err(|error| error.to_string())
}

/// Downloads the first image sample of a model version as `<stem>.preview.<ext>`.
/// Returns `Ok(None)` when the version has no usable image.
pub(crate) fn download_preview(
    client: &Client,
    metadata: &Value,
    directory: &Path,
    stem: &str,
) -> Result<Option<PathBuf>, String> {
    let Some(url) = metadata["images"]
        .as_array()
        .and_then(|images| images.iter().find(|image| is_image_item(image)))
        .and_then(|image| image["url"].as_str())
        .and_then(|url| reqwest::Url::parse(url).ok())
        .filter(|url| url.scheme() == "https" && is_civitai_host(url))
    else {
        return Ok(None);
    };
    let extension = preview_extension(&url);
    let response = client.get(url).send().map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Preview download failed with {}",
            response.status()
        ));
    }
    let bytes = response.bytes().map_err(|error| error.to_string())?;
    let path = directory.join(format!("{stem}.preview.{extension}"));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(Some(path))
}

pub(crate) fn comfy_dir(working_dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(working_dir.trim().trim_matches(['"', '\'']));
    if path.as_os_str().is_empty() {
        return Err("Select a ComfyUI directory in Settings first.".into());
    }
    if path.join("main.py").is_file() {
        Ok(path)
    } else if path.join("ComfyUI").join("main.py").is_file() {
        Ok(path.join("ComfyUI"))
    } else {
        Err("Select a valid ComfyUI directory in Settings first.".into())
    }
}

fn is_diffusion_model(base_model: &str, file_type: &str) -> bool {
    let base = base_model.to_ascii_lowercase();
    let file = file_type.to_ascii_lowercase();
    file.contains("diffusion")
        || file.contains("unet")
        || [
            "anima",
            "auraflow",
            "chroma",
            "cogvideox",
            "flux",
            "hidream",
            "hunyuan",
            "ltxv",
            "lumina",
            "mochi",
            "pixart",
            "qwen",
            "svd",
            "wan",
            "zimage",
        ]
        .iter()
        .any(|prefix| base.starts_with(prefix))
}

fn model_folder(
    model_type: &str,
    base_model: &str,
    file_type: &str,
) -> Result<&'static str, String> {
    match model_type.to_ascii_lowercase().as_str() {
        "checkpoint" if is_diffusion_model(base_model, file_type) => Ok("diffusion_models"),
        "checkpoint" => Ok("checkpoints"),
        "unet" => Ok("diffusion_models"),
        "textencoder" | "clip" => Ok("text_encoders"),
        "clipvision" => Ok("clip_vision"),
        "lora" | "locon" | "dora" => Ok("loras"),
        "vae" => Ok("vae"),
        "textualinversion" => Ok("embeddings"),
        "controlnet" => Ok("controlnet"),
        "upscaler" => Ok("upscale_models"),
        "hypernetwork" => Ok("hypernetworks"),
        other => Err(format!("Unsupported Civitai model type: {other}")),
    }
}

pub(crate) fn safe_filename(name: &str) -> String {
    let name = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("model.safetensors");
    let cleaned: String = name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => character,
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.');
    if cleaned.is_empty() {
        "model.safetensors".into()
    } else {
        cleaned.into()
    }
}

pub(crate) fn preview_extension(url: &reqwest::Url) -> &'static str {
    match Path::new(url.path())
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "png",
        "webp" => "webp",
        "mp4" => "mp4",
        "webm" => "webm",
        "mkv" => "mkv",
        "gif" => "gif",
        _ => "jpg",
    }
}

pub(crate) fn is_civitai_host(url: &reqwest::Url) -> bool {
    url.domain()
        .is_some_and(|host| host == "civitai.com" || host.ends_with(".civitai.com"))
}

pub(crate) fn is_image_item(item: &serde_json::Value) -> bool {
    let is_video_type = item["type"].as_str() == Some("video");
    if is_video_type {
        return false;
    }
    let Some(url) = item["url"].as_str() else {
        return false;
    };
    let clean_url = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    !clean_url.ends_with(".mp4")
        && !clean_url.ends_with(".webm")
        && !clean_url.ends_with(".mov")
        && !clean_url.ends_with(".mkv")
        && !clean_url.ends_with(".ogg")
}

fn download_blocking(
    app_handle: AppHandle,
    manager: DownloadManager,
    version_id: u64,
    working_dir: String,
    api_key: String,
) -> Result<DownloadRecord, String> {
    let root = comfy_dir(&working_dir)?;
    if version_id == 0 {
        return Err("Select a valid model version before downloading.".into());
    }
    let client = client()?;
    let metadata = fetch_model_version(&app_handle, &model_version_url(version_id), &api_key)?;
    let primary_file = metadata["files"]
        .as_array()
        .and_then(|files| {
            files
                .iter()
                .find(|file| file["primary"].as_bool() == Some(true))
                .or_else(|| files.first())
        })
        .ok_or("This model version has no downloadable files.")?;
    if primary_file["virusScanResult"].as_str() == Some("Danger")
        || primary_file["pickleScanResult"].as_str() == Some("Danger")
    {
        return Err("Civitai marked this file as unsafe; download blocked.".into());
    }
    let model_type = metadata["model"]["type"]
        .as_str()
        .ok_or("Civitai did not return the model type.")?;
    let model_name = metadata["model"]["name"]
        .as_str()
        .unwrap_or("Civitai model");
    let version_name = metadata["name"].as_str().unwrap_or_default();
    let base_model = metadata["baseModel"].as_str().unwrap_or("Unknown");
    let file_type = primary_file["type"].as_str().unwrap_or("Model");
    let filename = safe_filename(primary_file["name"].as_str().unwrap_or("model.safetensors"));
    let download_url = primary_file["downloadUrl"]
        .as_str()
        .or_else(|| metadata["downloadUrl"].as_str())
        .ok_or("Civitai did not return a download URL.")?;
    let download_url = reqwest::Url::parse(download_url).map_err(|error| error.to_string())?;
    if download_url.scheme() != "https" || download_url.domain() != Some("civitai.com") {
        return Err("Civitai returned an unexpected download host.".into());
    }
    let download_url = resolve_download_url(&client, download_url, &api_key)?;

    let directory = root
        .join("models")
        .join(model_folder(model_type, base_model, file_type)?);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let model_path = directory.join(&filename);
    if model_path.exists() {
        return Err(format!("Model already exists: {}", model_path.display()));
    }

    let preview_image = metadata["images"]
        .as_array()
        .and_then(|images| images.iter().find(|image| is_image_item(image)));

    let stem = model_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("model");
    write_sidecars(&directory, stem, &metadata)?;
    if let Err(error) = download_preview(&client, &metadata, &directory, stem) {
        eprintln!("Civitai preview unavailable; continuing model download: {error}");
    }

    manager.add(
        &app_handle,
        NewDownload {
            version_id,
            name: if version_name.is_empty() {
                model_name.to_string()
            } else {
                format!("{model_name} — {version_name}")
            },
            file_name: filename,
            model_type: model_type.to_string(),
            base_model: base_model.to_string(),
            model_path,
            preview_url: preview_image
                .and_then(|image| image["url"].as_str())
                .map(str::to_string),
            url: download_url,
        },
    )
}

#[tauri::command]
pub async fn download(
    app_handle: AppHandle,
    manager: State<'_, DownloadManager>,
    version_id: u64,
    working_dir: String,
    api_key: String,
) -> Result<DownloadRecord, String> {
    let manager = (*manager).clone();
    tauri::async_runtime::spawn_blocking(move || {
        download_blocking(app_handle, manager, version_id, working_dir, api_key)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{is_civitai_host, is_image_item, model_folder, preview_extension, safe_filename};

    #[test]
    fn refreshes_forbidden_redirect_without_forwarding_credentials() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            for attempt in 0..4 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 4096];
                while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    request.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8(request).unwrap().to_lowercase();
                assert!(request.contains("range: bytes=0-0"));
                let response = if attempt % 2 == 0 {
                    assert!(request.contains("authorization: bearer test-key"));
                    if attempt == 2 {
                        assert!(request.contains("comfygui_refresh="));
                    }
                    format!("HTTP/1.1 302 Found\r\nLocation: http://localhost:{port}/cdn\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                } else {
                    assert!(!request.contains("authorization:"));
                    let status = if attempt == 1 {
                        "403 Forbidden"
                    } else {
                        "206 Partial Content"
                    };
                    format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                };
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let result = super::resolve_download_url(
            &client,
            reqwest::Url::parse(&format!("http://127.0.0.1:{port}/download")).unwrap(),
            "test-key",
        )
        .unwrap();
        assert_eq!(result, format!("http://localhost:{port}/cdn"));
        server.join().unwrap();
    }

    #[test]
    fn rejects_unconfigured_download_directory() {
        assert!(super::comfy_dir("").is_err());
        assert!(super::comfy_dir(" \"\" ").is_err());
    }

    #[test]
    fn maps_supported_types_and_sanitizes_filenames() {
        assert_eq!(model_folder("LORA", "Flux.1 D", "Model"), Ok("loras"));
        assert_eq!(model_folder("VAE", "SDXL 1.0", "Model"), Ok("vae"));
        assert_eq!(
            model_folder("TextualInversion", "SDXL 1.0", "Model"),
            Ok("embeddings")
        );
        assert_eq!(
            model_folder("UNet", "Unknown", "Model"),
            Ok("diffusion_models")
        );
        assert_eq!(
            model_folder("Checkpoint", "SDXL 1.0", "Model"),
            Ok("checkpoints")
        );
        assert_eq!(
            model_folder("Checkpoint", "Flux.1 D", "Model"),
            Ok("diffusion_models")
        );
        assert_eq!(
            model_folder("Checkpoint", "Anima", "Model"),
            Ok("diffusion_models")
        );
        assert_eq!(
            safe_filename("../bad:model?.safetensors"),
            "bad_model_.safetensors"
        );
        assert!(is_civitai_host(
            &reqwest::Url::parse("https://image.civitai.com/example.jpg").unwrap()
        ));
        assert!(!is_civitai_host(
            &reqwest::Url::parse("https://example.com/image.jpg").unwrap()
        ));
        assert_eq!(
            preview_extension(&reqwest::Url::parse("https://image.civitai.com/video.mp4").unwrap()),
            "mp4"
        );
        assert_eq!(
            preview_extension(
                &reqwest::Url::parse("https://image.civitai.com/image.webp").unwrap()
            ),
            "webp"
        );
        assert!(is_image_item(&serde_json::json!({
            "type": "image",
            "url": "https://image.civitai.com/preview.jpeg"
        })));
        assert!(!is_image_item(&serde_json::json!({
            "type": "video",
            "url": "https://image.civitai.com/video.mp4"
        })));
        assert!(!is_image_item(&serde_json::json!({
            "type": "image",
            "url": "https://image.civitai.com/video.mp4"
        })));
    }
}
