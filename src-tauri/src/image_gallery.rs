use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, State};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const MAX_PNG_CHUNK_SIZE: u32 = 32 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputImage {
    local_id: String,
    path: String,
    filename: String,
    subfolder: String,
    extension: String,
    file_size: u64,
    modified_ms: u64,
}

#[derive(Clone)]
pub struct GalleryFiles {
    files: Arc<RwLock<HashMap<String, PathBuf>>>,
    history_files: Arc<RwLock<HashMap<String, PathBuf>>>,
    index: Arc<RwLock<Option<(PathBuf, Vec<OutputImage>)>>>,
    thumbnails_in_flight: Arc<(Mutex<HashSet<String>>, Condvar)>,
    thumbnail_dir: Arc<RwLock<PathBuf>>,
}

impl Default for GalleryFiles {
    fn default() -> Self {
        Self {
            files: Arc::default(),
            history_files: Arc::default(),
            index: Arc::default(),
            thumbnails_in_flight: Arc::new((Mutex::new(HashSet::new()), Condvar::new())),
            thumbnail_dir: Arc::new(RwLock::new(
                std::env::temp_dir().join("comfy-gui-thumbnails"),
            )),
        }
    }
}

impl GalleryFiles {
    pub fn set_cache_dir(&self, path: PathBuf) -> Result<(), String> {
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        *self
            .thumbnail_dir
            .write()
            .map_err(|_| "Image gallery cache lock is unavailable")? = path;
        Ok(())
    }

    fn cache_dir(&self) -> Option<PathBuf> {
        self.thumbnail_dir.read().ok().map(|path| path.clone())
    }

    pub fn read(&self, id: &str, thumbnail: bool) -> Option<(Vec<u8>, &'static str)> {
        let path = self
            .files
            .read()
            .ok()?
            .get(id)
            .cloned()
            .or_else(|| self.history_files.read().ok()?.get(id).cloned())?;
        if thumbnail {
            let cache_dir = self.cache_dir()?;
            fs::create_dir_all(&cache_dir).ok()?;
            let cached = cache_dir.join(format!("v3-{id}.jpg"));
            if let Ok(bytes) = fs::read(&cached) {
                return Some((bytes, "image/jpeg"));
            }

            let (lock, ready) = &*self.thumbnails_in_flight;
            let mut in_flight = lock.lock().ok()?;
            if !in_flight.insert(id.to_owned()) {
                in_flight = ready
                    .wait_while(in_flight, |items| items.contains(id))
                    .ok()?;
                drop(in_flight);
                return fs::read(cached).ok().map(|bytes| (bytes, "image/jpeg"));
            }
            drop(in_flight);

            let result = (|| {
                let bytes = encode_jpeg_thumbnail(&path, 400, 82)?;
                fs::write(&cached, &bytes).ok()?;
                Some((bytes, "image/jpeg"))
            })();

            if let Ok(mut items) = lock.lock() {
                items.remove(id);
                ready.notify_all();
            }
            return result;
        }
        let content_type = match path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            _ => return None,
        };
        fs::read(path).ok().map(|bytes| (bytes, content_type))
    }

    fn thumbnail_exists(&self, id: &str) -> bool {
        self.cache_dir()
            .is_some_and(|path| path.join(format!("v3-{id}.jpg")).is_file())
    }

    fn clear(&self) -> Result<(), String> {
        let cache_dir = self
            .cache_dir()
            .ok_or("Image gallery cache lock is unavailable")?;
        if cache_dir.is_dir() {
            fs::remove_dir_all(&cache_dir).map_err(|error| error.to_string())?;
        }
        fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
        self.files
            .write()
            .map_err(|_| "Image gallery lock is unavailable")?
            .clear();
        *self
            .index
            .write()
            .map_err(|_| "Image gallery index is unavailable")? = None;
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryIndex {
    output_root: String,
    images: Vec<OutputImage>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryIndexProgress {
    stage: &'static str,
    processed: usize,
    total: usize,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    width: u32,
    height: u32,
    prompt: String,
    negative_prompt: String,
    model: String,
    sampler: String,
    scheduler: String,
    seed: String,
    steps: String,
    cfg: String,
    raw_prompt: String,
    raw_workflow: String,
}

fn comfy_dir(working_dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(working_dir.trim().trim_matches(['"', '\'']));
    if path.as_os_str().is_empty() {
        return Err("Choose your ComfyUI folder in Settings first.".into());
    }
    if path.join("main.py").is_file() {
        Ok(path)
    } else if path.join("ComfyUI").join("main.py").is_file() {
        Ok(path.join("ComfyUI"))
    } else {
        Err("Select a valid ComfyUI directory in Settings first.".into())
    }
}

#[derive(Deserialize)]
pub struct HistoryImage {
    id: String,
    filename: String,
    subfolder: String,
    #[serde(rename = "type")]
    image_type: String,
}

#[tauri::command]
pub async fn resolve_history_images(
    working_dir: String,
    args: Vec<String>,
    images: Vec<HistoryImage>,
    gallery_files: State<'_, GalleryFiles>,
) -> Result<HashMap<String, String>, String> {
    let gallery_files = gallery_files.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let work = PathBuf::from(working_dir.trim().trim_matches(['"', '\'']));
        if working_dir.trim().is_empty() {
            return Ok(HashMap::new());
        }
        let root = comfy_dir(&working_dir)?;
        let base = directory_argument(&args, "--base-directory", &work).unwrap_or(root);
        let mut resolved = HashMap::new();
        let mut files = gallery_files
            .history_files
            .write()
            .map_err(|_| "Image history lock is unavailable")?;
        for image in images {
            let root = match image.image_type.as_str() {
                "output" | "input" => {
                    directory_argument(&args, &format!("--{}-directory", image.image_type), &work)
                        .unwrap_or_else(|| base.join(&image.image_type))
                }
                "temp" => directory_argument(&args, "--temp-directory", &work)
                    .map(|path| path.join("temp"))
                    .unwrap_or_else(|| base.join("temp")),
                _ => continue,
            };
            let Some(path) = history_image_path(&root, &image.subfolder, &image.filename) else {
                continue;
            };
            let mut hasher = DefaultHasher::new();
            path.hash(&mut hasher);
            fs::metadata(&path)
                .ok()
                .and_then(|meta| meta.modified().ok())
                .hash(&mut hasher);
            let local_id = format!("history-{:x}", hasher.finish());
            files.insert(local_id.clone(), path);
            resolved.insert(image.id, local_id);
        }
        Ok(resolved)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Decodes an image and re-encodes a bounded JPEG thumbnail (shared by the
/// gallery and model-preview URI schemes).
pub(crate) fn encode_jpeg_thumbnail(path: &Path, max: u32, quality: u8) -> Option<Vec<u8>> {
    // Sniff the real format: preview files written by other tools are often
    // JPEG bytes saved as `.png`. Flatten to RGB since JPEG has no alpha.
    let decoded = image::ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;
    let thumbnail = decoded.thumbnail(max, max).to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode_image(&thumbnail)
        .ok()?;
    Some(bytes)
}

pub(crate) fn directory_argument(args: &[String], flag: &str, work: &Path) -> Option<PathBuf> {
    let value = args.iter().enumerate().rev().find_map(|(index, arg)| {
        arg.strip_prefix(&format!("{flag}=")).or_else(|| {
            (arg == flag)
                .then(|| args.get(index + 1).map(String::as_str))
                .flatten()
        })
    })?;
    Some(work.join(value))
}

fn history_image_path(root: &Path, subfolder: &str, filename: &str) -> Option<PathBuf> {
    if filename.contains(['/', '\\', ':']) || filename.is_empty() {
        return None;
    }
    let root = root.canonicalize().ok()?;
    let path = root.join(subfolder).join(filename).canonicalize().ok()?;
    let extension = path.extension()?.to_str()?.to_lowercase();
    (path.starts_with(&root) && path.is_file() && IMAGE_EXTENSIONS.contains(&extension.as_str()))
        .then_some(path)
}

fn index_path(output_root: &Path, gallery_files: &GalleryFiles) -> Option<PathBuf> {
    let mut hasher = DefaultHasher::new();
    output_root.hash(&mut hasher);
    Some(
        gallery_files
            .cache_dir()?
            .join(format!("index-{:x}.json", hasher.finish())),
    )
}

fn load_disk_index(output_root: &Path, gallery_files: &GalleryFiles) -> Option<Vec<OutputImage>> {
    let raw = fs::read(index_path(output_root, gallery_files)?).ok()?;
    let mut index: GalleryIndex = serde_json::from_slice(&raw).ok()?;
    if Path::new(&index.output_root) != output_root {
        return None;
    }
    let mut allowed_files = HashMap::new();
    index.images.retain_mut(|image| {
        if Path::new(&image.filename)
            .file_name()
            .and_then(|name| name.to_str())
            != Some(image.filename.as_str())
            || image
                .subfolder
                .split('/')
                .any(|part| part == "." || part == ".." || part.contains(['\\', ':']))
        {
            return false;
        }
        let path = image
            .subfolder
            .split('/')
            .filter(|part| !part.is_empty())
            .fold(output_root.to_path_buf(), |path, part| path.join(part))
            .join(&image.filename);
        image.path = path.to_string_lossy().into_owned();
        allowed_files.insert(image.local_id.clone(), path);
        true
    });
    *gallery_files.files.write().ok()? = allowed_files;
    *gallery_files.index.write().ok()? = Some((output_root.to_path_buf(), index.images.clone()));
    Some(index.images)
}

fn collect_images(
    dir: &Path,
    output_root: &Path,
    images: &mut Vec<OutputImage>,
    allowed_files: &mut HashMap<String, PathBuf>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_images(&path, output_root, images, allowed_files);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();
        if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or_default();
        let subfolder = path
            .parent()
            .and_then(|parent| parent.strip_prefix(output_root).ok())
            .map(|relative| relative.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let mut hasher = DefaultHasher::new();
        path.hash(&mut hasher);
        modified_ms.hash(&mut hasher);
        let local_id = format!("{:x}", hasher.finish());
        allowed_files.insert(local_id.clone(), path.clone());
        images.push(OutputImage {
            local_id,
            filename: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            subfolder,
            extension,
            file_size: metadata.len(),
            modified_ms,
        });
    }
}

#[tauri::command]
pub fn list_output_images(
    working_dir: String,
    gallery_files: State<'_, GalleryFiles>,
) -> Result<Vec<OutputImage>, String> {
    let output_root = comfy_dir(&working_dir)?.join("output");
    if !output_root.is_dir() {
        return Ok(Vec::new());
    }
    if let Some((cached_root, images)) = gallery_files
        .index
        .read()
        .ok()
        .and_then(|index| index.clone())
    {
        if cached_root == output_root {
            return Ok(images);
        }
    }
    if let Some(images) = load_disk_index(&output_root, &gallery_files) {
        return Ok(images);
    }
    scan_output_images(output_root, &gallery_files)
}

fn scan_output_images(
    output_root: PathBuf,
    gallery_files: &GalleryFiles,
) -> Result<Vec<OutputImage>, String> {
    let mut images = Vec::new();
    let mut allowed_files = HashMap::new();
    collect_images(&output_root, &output_root, &mut images, &mut allowed_files);
    images.sort_unstable_by(|left, right| {
        right
            .modified_ms
            .cmp(&left.modified_ms)
            .then_with(|| left.path.cmp(&right.path))
    });
    *gallery_files
        .files
        .write()
        .map_err(|_| "Image gallery lock is unavailable")? = allowed_files;
    *gallery_files
        .index
        .write()
        .map_err(|_| "Image gallery index is unavailable")? =
        Some((output_root.clone(), images.clone()));
    let cache_dir = gallery_files
        .cache_dir()
        .ok_or("Image gallery cache lock is unavailable")?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    let disk_index = GalleryIndex {
        output_root: output_root.to_string_lossy().into_owned(),
        images: images.clone(),
    };
    fs::write(
        index_path(&output_root, gallery_files).ok_or("Image gallery cache lock is unavailable")?,
        serde_json::to_vec(&disk_index).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(images)
}

fn prepare_output_gallery_blocking(
    app_handle: AppHandle,
    working_dir: String,
    gallery_files: GalleryFiles,
) -> Result<Vec<OutputImage>, String> {
    let output_root = comfy_dir(&working_dir)?.join("output");
    if !output_root.is_dir() {
        return Ok(Vec::new());
    }
    app_handle
        .emit(
            "gallery-index-progress",
            GalleryIndexProgress {
                stage: "Scanning output files",
                processed: 0,
                total: 0,
            },
        )
        .ok();
    let images = scan_output_images(output_root, &gallery_files)?;
    let missing: Vec<String> = images
        .iter()
        .filter(|image| !gallery_files.thumbnail_exists(&image.local_id))
        .map(|image| image.local_id.clone())
        .collect();
    let total = missing.len();
    app_handle
        .emit(
            "gallery-index-progress",
            GalleryIndexProgress {
                stage: "Generating thumbnails",
                processed: 0,
                total,
            },
        )
        .ok();

    let completed = Arc::new(AtomicUsize::new(0));
    let last_emit_ms = Arc::new(AtomicU64::new(0));
    let worker_count = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4)
        .saturating_sub(1)
        .clamp(2, 8);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(worker_count)
        .thread_name(|index| format!("gallery-index-{index}"))
        .build()
        .map_err(|error| error.to_string())?;
    let files = gallery_files.clone();
    pool.install(|| {
        missing.par_iter().for_each(|id| {
            let _ = files.read(&id, true);
            let processed = completed.fetch_add(1, Ordering::Relaxed) + 1;
            let now_ms = std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let last = last_emit_ms.load(Ordering::Relaxed);
            if processed == total
                || (now_ms.saturating_sub(last) >= 50
                    && last_emit_ms
                        .compare_exchange(last, now_ms, Ordering::Relaxed, Ordering::Relaxed)
                        .is_ok())
            {
                app_handle
                    .emit(
                        "gallery-index-progress",
                        GalleryIndexProgress {
                            stage: "Generating thumbnails",
                            processed,
                            total,
                        },
                    )
                    .ok();
            }
        });
    });
    app_handle
        .emit(
            "gallery-index-progress",
            GalleryIndexProgress {
                stage: "Ready",
                processed: images.len(),
                total: images.len(),
            },
        )
        .ok();
    Ok(images)
}

#[tauri::command]
pub async fn clear_gallery_cache(gallery_files: State<'_, GalleryFiles>) -> Result<(), String> {
    let gallery_files = gallery_files.inner().clone();
    tauri::async_runtime::spawn_blocking(move || gallery_files.clear())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn gallery_cache_directory(gallery_files: State<'_, GalleryFiles>) -> Result<String, String> {
    gallery_files
        .cache_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| "Image gallery cache lock is unavailable".to_owned())
}

#[tauri::command]
pub async fn prepare_output_gallery(
    app_handle: AppHandle,
    working_dir: String,
    gallery_files: State<'_, GalleryFiles>,
) -> Result<Vec<OutputImage>, String> {
    let gallery_files = gallery_files.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        prepare_output_gallery_blocking(app_handle, working_dir, gallery_files)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn refresh_output_images(
    working_dir: String,
    gallery_files: State<'_, GalleryFiles>,
) -> Result<Vec<OutputImage>, String> {
    let output_root = comfy_dir(&working_dir)?.join("output");
    if !output_root.is_dir() {
        return Ok(Vec::new());
    }
    scan_output_images(output_root, &gallery_files)
}

fn read_png_text(path: &Path, metadata: &mut ImageMetadata) -> Result<(), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut signature = [0_u8; 8];
    file.read_exact(&mut signature)
        .map_err(|error| error.to_string())?;
    if signature != [137, 80, 78, 71, 13, 10, 26, 10] {
        return Ok(());
    }

    loop {
        let mut length_bytes = [0_u8; 4];
        if file.read_exact(&mut length_bytes).is_err() {
            break;
        }
        let length = u32::from_be_bytes(length_bytes);
        if length > MAX_PNG_CHUNK_SIZE {
            return Err("PNG metadata chunk is too large".into());
        }
        let mut kind = [0_u8; 4];
        file.read_exact(&mut kind)
            .map_err(|error| error.to_string())?;
        if !matches!(&kind, b"IHDR" | b"tEXt" | b"iTXt" | b"IEND") {
            file.seek(SeekFrom::Current(length as i64 + 4))
                .map_err(|error| error.to_string())?;
            continue;
        }
        let mut data = vec![0_u8; length as usize];
        file.read_exact(&mut data)
            .map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Current(4))
            .map_err(|error| error.to_string())?;

        match &kind {
            b"IHDR" if data.len() >= 8 => {
                metadata.width = u32::from_be_bytes(data[0..4].try_into().unwrap());
                metadata.height = u32::from_be_bytes(data[4..8].try_into().unwrap());
            }
            b"tEXt" => {
                if let Some(separator) = data.iter().position(|byte| *byte == 0) {
                    apply_png_text(
                        &String::from_utf8_lossy(&data[..separator]),
                        &String::from_utf8_lossy(&data[separator + 1..]),
                        metadata,
                    );
                }
            }
            b"iTXt" => {
                if let Some((keyword, text)) = parse_uncompressed_itxt(&data) {
                    apply_png_text(keyword, text, metadata);
                }
            }
            b"IEND" => break,
            _ => {}
        }
    }
    Ok(())
}

fn parse_uncompressed_itxt(data: &[u8]) -> Option<(&str, &str)> {
    let keyword_end = data.iter().position(|byte| *byte == 0)?;
    let keyword = std::str::from_utf8(&data[..keyword_end]).ok()?;
    let mut position = keyword_end + 1;
    if data.get(position)? != &0 || data.get(position + 1)? != &0 {
        return None;
    }
    position += 2;
    for _ in 0..2 {
        position += data[position..].iter().position(|byte| *byte == 0)? + 1;
    }
    Some((keyword, std::str::from_utf8(&data[position..]).ok()?))
}

fn apply_png_text(keyword: &str, text: &str, metadata: &mut ImageMetadata) {
    match keyword {
        "prompt" => {
            metadata.raw_prompt = text.to_owned();
            extract_comfy_metadata(text, metadata);
        }
        "workflow" => metadata.raw_workflow = text.to_owned(),
        "parameters" => {
            metadata.raw_prompt = text.to_owned();
            if metadata.prompt.is_empty() {
                metadata.prompt = text.to_owned();
            }
        }
        _ => {}
    }
}

fn input_text(inputs: &Value, key: &str) -> String {
    let Some(value) = inputs.get(key) else {
        return String::new();
    };
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => String::new(),
    }
}

fn referenced_node<'a>(
    nodes: &'a serde_json::Map<String, Value>,
    value: &Value,
) -> Option<&'a Value> {
    let id = value.as_array()?.first()?.as_str()?;
    nodes.get(id)
}

fn referenced_input(nodes: &serde_json::Map<String, Value>, value: &Value, key: &str) -> String {
    referenced_node(nodes, value)
        .and_then(|node| node.get("inputs"))
        .map(|inputs| input_text(inputs, key))
        .unwrap_or_default()
}

fn extract_comfy_metadata(raw: &str, metadata: &mut ImageMetadata) {
    let Ok(root) = serde_json::from_str::<Value>(raw) else {
        return;
    };
    let nodes_value = root.get("prompt").unwrap_or(&root);
    let Some(nodes) = nodes_value.as_object() else {
        return;
    };

    for node in nodes.values() {
        let class = node
            .get("class_type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();
        let title = node
            .get("_meta")
            .and_then(|value| value.get("title"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();
        let Some(inputs) = node.get("inputs") else {
            continue;
        };

        if metadata.model.is_empty() {
            metadata.model = input_text(inputs, "ckpt_name");
            if metadata.model.is_empty() {
                metadata.model = input_text(inputs, "unet_name");
            }
        }
        if class.contains("sampler") {
            if metadata.sampler.is_empty() {
                metadata.sampler = input_text(inputs, "sampler_name");
            }
            if metadata.scheduler.is_empty() {
                metadata.scheduler = input_text(inputs, "scheduler");
            }
            if metadata.seed.is_empty() {
                metadata.seed = input_text(inputs, "seed");
                if metadata.seed.is_empty() {
                    metadata.seed = referenced_input(nodes, &inputs["seed"], "seed");
                }
            }
            if metadata.steps.is_empty() {
                metadata.steps = input_text(inputs, "steps");
            }
            if metadata.cfg.is_empty() {
                metadata.cfg = input_text(inputs, "cfg");
            }
        }
        if class.contains("prompt") {
            let prompt = input_text(inputs, "prompt");
            if title.contains("negative") {
                metadata.negative_prompt = prompt;
            } else if !prompt.is_empty() && metadata.prompt.is_empty() {
                metadata.prompt = prompt;
            }
        }
        if class == "yeimagemetadataconnector" {
            metadata.prompt = referenced_input(nodes, &inputs["positive"], "prompt");
            metadata.negative_prompt = referenced_input(nodes, &inputs["negative"], "prompt");
        }
    }
}

#[tauri::command]
pub fn read_output_image_metadata(
    working_dir: String,
    path: String,
) -> Result<ImageMetadata, String> {
    let output_root = comfy_dir(&working_dir)?
        .join("output")
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let image_path = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !image_path.starts_with(&output_root) || !image_path.is_file() {
        return Err("Image path must be a file inside the ComfyUI output folder".into());
    }
    let mut metadata = ImageMetadata::default();
    if image_path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
    {
        read_png_text(&image_path, &mut metadata)?;
    }
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_history_locally_and_rejects_paths_outside_root() {
        assert!(comfy_dir("").is_err());
        assert!(comfy_dir(" \"\" ").is_err());
        let root = std::env::temp_dir().join(format!("history-test-{}", std::process::id()));
        fs::create_dir_all(root.join("output/nested")).unwrap();
        assert!(comfy_dir(root.to_str().unwrap()).is_err());
        fs::write(root.join("main.py"), b"").unwrap();
        assert_eq!(comfy_dir(root.to_str().unwrap()).unwrap(), root);
        fs::write(root.join("output/nested/image.png"), b"local image").unwrap();
        fs::write(root.join("outside.png"), b"outside").unwrap();
        let output = root.join("output");
        let path = history_image_path(&output, "nested", "image.png").unwrap();
        assert!(history_image_path(&output, "..", "outside.png").is_none());
        assert!(history_image_path(&output, "", "../outside.png").is_none());
        assert!(history_image_path(&output, "", "missing.png").is_none());
        let files = GalleryFiles::default();
        files
            .history_files
            .write()
            .unwrap()
            .insert("history-test".into(), path);
        files.files.write().unwrap().clear();
        assert_eq!(
            files.read("history-test", false).unwrap(),
            (b"local image".to_vec(), "image/png")
        );
        assert_eq!(
            directory_argument(
                &["--output-directory".into(), "custom".into()],
                "--output-directory",
                &root
            ),
            Some(root.join("custom"))
        );
        assert_eq!(
            directory_argument(
                &["--output-directory=custom".into()],
                "--output-directory",
                &root
            ),
            Some(root.join("custom"))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extracts_comfy_prompt_fields() {
        let raw = r#"{"21":{"inputs":{"prompt":"blue hair"},"class_type":"YEPrompt","_meta":{"title":"Positive"}},"17":{"inputs":{"prompt":"bad hands"},"class_type":"YEPrompt","_meta":{"title":"Negative"}},"9":{"inputs":{"steps":20,"cfg":4,"sampler_name":"euler","scheduler":"simple","seed":42},"class_type":"KSampler"}}"#;
        let mut metadata = ImageMetadata::default();
        extract_comfy_metadata(raw, &mut metadata);
        assert_eq!(metadata.prompt, "blue hair");
        assert_eq!(metadata.negative_prompt, "bad hands");
        assert_eq!(metadata.sampler, "euler");
        assert_eq!(metadata.seed, "42");
    }

    #[test]
    fn caches_small_grid_thumbnail() {
        let id = format!("thumbnail-test-{}", std::process::id());
        let source = std::env::temp_dir().join(format!("{id}.png"));
        image::RgbImage::new(400, 300).save(&source).unwrap();
        let files = GalleryFiles::default();
        files
            .files
            .write()
            .unwrap()
            .insert(id.clone(), source.clone());

        let (bytes, content_type) = files.read(&id, true).unwrap();
        let thumbnail = image::load_from_memory(&bytes).unwrap();
        assert_eq!(content_type, "image/jpeg");
        assert!(thumbnail.width() <= 400 && thumbnail.height() <= 400);

        let _ = fs::remove_file(source);
        let _ = fs::remove_file(files.cache_dir().unwrap().join(format!("v3-{id}.jpg")));
    }
}
