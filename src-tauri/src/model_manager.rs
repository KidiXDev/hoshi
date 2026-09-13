//! Local model index for the Model Manager page and the LoRA trigger-word
//! assistant: scans ComfyUI model folders (including `extra_model_paths.yaml`),
//! reads `.civitai.info` sidecars and safetensors headers, hashes files on
//! demand, syncs metadata/previews from Civitai and serves previews through the
//! `comfygui-model://` URI scheme.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

use crate::civitai;
use crate::image_gallery::{directory_argument, encode_jpeg_thumbnail};

/// v1 → v2 added `CivitaiSummary.verified` (migrated in `load_disk_index`).
const INDEX_VERSION: u32 = 2;
const MIN_LOADABLE_INDEX_VERSION: u32 = 1;
const MODEL_EXTENSIONS: &[&str] = &[
    "safetensors",
    "ckpt",
    "pt",
    "pth",
    "bin",
    "sft",
    "gguf",
    "onnx",
];
const PREVIEW_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
/// ComfyUI `folder_paths` categories that hold model files (folder name under `models/`).
const DEFAULT_CATEGORIES: &[&str] = &[
    "checkpoints",
    "diffusion_models",
    "loras",
    "vae",
    "text_encoders",
    "clip_vision",
    "controlnet",
    "upscale_models",
    "embeddings",
    "hypernetworks",
    "style_models",
    "gligen",
    "photomaker",
    "vae_approx",
    "audio_encoders",
    "model_patches",
];
/// Legacy folder names ComfyUI still scans, mapped to their canonical category.
const CATEGORY_ALIASES: &[(&str, &str)] = &[
    ("unet", "diffusion_models"),
    ("clip", "text_encoders"),
    ("t2i_adapter", "controlnet"),
];
const IGNORED_YAML_KEYS: &[&str] = &[
    "base_path",
    "is_default",
    "custom_nodes",
    "download_model_base",
];
const MAX_SIDECAR_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SAFETENSORS_HEADER: u64 = 32 * 1024 * 1024;
const HASH_BUFFER: usize = 4 * 1024 * 1024;
const MAX_SUGGESTED_WORDS: usize = 24;
const SYNC_SPACING: Duration = Duration::from_millis(250);
const MAX_CONCURRENT_THUMBNAILS: usize = 4;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CivitaiSummary {
    pub model_id: Option<u64>,
    pub version_id: Option<u64>,
    pub model_name: String,
    pub version_name: String,
    pub model_type: String,
    pub base_model: String,
    pub trained_words: Vec<String>,
    pub nsfw: bool,
    pub image_count: usize,
    #[serde(default)]
    pub latest_version_id: Option<u64>,
    /// `true` once the file hash was confirmed against Civitai (by a sync, or
    /// because the sidecar's own file hash matches a computed hash). Sidecar
    /// metadata alone is unverified: another tool may have written it.
    #[serde(default)]
    pub verified: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub id: String,
    pub category: String,
    pub relative_name: String,
    pub filename: String,
    pub path: String,
    pub root: String,
    pub extension: String,
    pub file_size: u64,
    pub modified_ms: u64,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub hash_size: Option<u64>,
    #[serde(default)]
    pub hash_modified_ms: Option<u64>,
    #[serde(default)]
    pub preview_path: Option<String>,
    /// Modified time of `preview_path`; lets the UI bust cached preview URLs.
    #[serde(default)]
    pub preview_modified_ms: Option<u64>,
    #[serde(default)]
    pub sidecar: Option<String>,
    #[serde(default)]
    pub civitai: Option<CivitaiSummary>,
    #[serde(default)]
    pub sync_attempted_ms: u64,
}

impl LocalModel {
    /// Whether the Civitai metadata was confirmed by file hash.
    fn is_verified(&self) -> bool {
        self.civitai
            .as_ref()
            .is_some_and(|summary| summary.verified)
    }

    /// The cached hash is only valid while the file is unchanged.
    fn valid_hash(&self) -> Option<&str> {
        match (&self.sha256, self.hash_size, self.hash_modified_ms) {
            (Some(hash), Some(size), Some(modified))
                if size == self.file_size && modified == self.modified_ms =>
            {
                Some(hash)
            }
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRoot {
    pub category: String,
    pub path: String,
    pub is_default: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelsIndex {
    pub comfy_root: String,
    pub roots: Vec<CategoryRoot>,
    pub models: Vec<LocalModel>,
    pub warnings: Vec<String>,
    pub scanned_at_ms: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexFile {
    version: u32,
    comfy_root: String,
    roots: Vec<CategoryRoot>,
    models: Vec<LocalModel>,
    warnings: Vec<String>,
    scanned_at_ms: u64,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelHeaderInfo {
    pub metadata: BTreeMap<String, String>,
    pub suggested_words: Vec<String>,
    pub base_model: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexProgress {
    stage: &'static str,
    processed: usize,
    total: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HashProgress {
    id: String,
    processed: u64,
    total: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncProgress {
    stage: &'static str,
    processed: usize,
    total: usize,
    current: String,
    error: Option<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAllResult {
    synced: usize,
    failed: usize,
    skipped: usize,
    cancelled: bool,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PreviewSource {
    Url { url: String },
    LocalPath { path: String },
}

#[derive(Default)]
struct IndexState {
    comfy_root: Option<PathBuf>,
    roots: Vec<CategoryRoot>,
    models: HashMap<String, LocalModel>,
    warnings: Vec<String>,
    scanned_at_ms: u64,
}

/// Managed Tauri state. Cheap to clone; all clones share the same index.
#[derive(Clone)]
pub struct ModelIndex {
    state: Arc<RwLock<IndexState>>,
    config_dir: Arc<RwLock<Option<PathBuf>>>,
    thumbnails_in_flight: Arc<(Mutex<HashSet<String>>, Condvar)>,
    /// Counting semaphore so a freshly rendered grid page does not decode
    /// dozens of full-size preview images at once.
    encode_slots: Arc<(Mutex<usize>, Condvar)>,
    scan_lock: Arc<Mutex<()>>,
    cancel_sync: Arc<AtomicBool>,
}

impl Default for ModelIndex {
    fn default() -> Self {
        Self {
            state: Arc::default(),
            config_dir: Arc::default(),
            thumbnails_in_flight: Arc::new((Mutex::new(HashSet::new()), Condvar::new())),
            encode_slots: Arc::new((Mutex::new(MAX_CONCURRENT_THUMBNAILS), Condvar::new())),
            scan_lock: Arc::default(),
            cancel_sync: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn lock_error<T>(_: T) -> String {
    "Model index lock is unavailable".into()
}

impl ModelIndex {
    pub fn configure(&self, config_dir: PathBuf) -> Result<(), String> {
        fs::create_dir_all(config_dir.join("models")).map_err(|error| error.to_string())?;
        fs::create_dir_all(config_dir.join(".cache").join("models"))
            .map_err(|error| error.to_string())?;
        *self.config_dir.write().map_err(lock_error)? = Some(config_dir);
        Ok(())
    }

    fn index_path(&self) -> Option<PathBuf> {
        Some(
            self.config_dir
                .read()
                .ok()?
                .clone()?
                .join("models")
                .join("index.json"),
        )
    }

    fn thumbnail_dir(&self) -> Option<PathBuf> {
        Some(
            self.config_dir
                .read()
                .ok()?
                .clone()?
                .join(".cache")
                .join("models"),
        )
    }

    pub fn snapshot(&self) -> Result<LocalModelsIndex, String> {
        let state = self.state.read().map_err(lock_error)?;
        let mut models: Vec<LocalModel> = state.models.values().cloned().collect();
        models.sort_by(|a, b| {
            a.category.cmp(&b.category).then_with(|| {
                a.relative_name
                    .to_lowercase()
                    .cmp(&b.relative_name.to_lowercase())
            })
        });
        Ok(LocalModelsIndex {
            comfy_root: state
                .comfy_root
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_default(),
            roots: state.roots.clone(),
            models,
            warnings: state.warnings.clone(),
            scanned_at_ms: state.scanned_at_ms,
        })
    }

    pub fn get(&self, id: &str) -> Option<LocalModel> {
        self.state.read().ok()?.models.get(id).cloned()
    }

    fn update(&self, model: LocalModel) -> Result<(), String> {
        self.state
            .write()
            .map_err(lock_error)?
            .models
            .insert(model.id.clone(), model);
        self.persist()
    }

    fn remove(&self, id: &str) -> Result<(), String> {
        self.state.write().map_err(lock_error)?.models.remove(id);
        self.persist()
    }

    fn persist(&self) -> Result<(), String> {
        let Some(path) = self.index_path() else {
            return Ok(());
        };
        let file = {
            let state = self.state.read().map_err(lock_error)?;
            let Some(comfy_root) = &state.comfy_root else {
                return Ok(());
            };
            IndexFile {
                version: INDEX_VERSION,
                comfy_root: comfy_root.to_string_lossy().into_owned(),
                roots: state.roots.clone(),
                models: state.models.values().cloned().collect(),
                warnings: state.warnings.clone(),
                scanned_at_ms: state.scanned_at_ms,
            }
        };
        let bytes = serde_json::to_vec(&file).map_err(|error| error.to_string())?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, bytes).map_err(|error| error.to_string())?;
        fs::rename(&tmp, &path).map_err(|error| error.to_string())
    }

    fn load_disk_index(&self, comfy_root: &Path) -> Option<()> {
        let raw = fs::read(self.index_path()?).ok()?;
        let mut file: IndexFile = serde_json::from_slice(&raw).ok()?;
        if !(MIN_LOADABLE_INDEX_VERSION..=INDEX_VERSION).contains(&file.version)
            || Path::new(&file.comfy_root) != comfy_root
        {
            return None;
        }
        if file.version < 2 {
            // Before `verified` existed, a successful by-hash sync was the only
            // way to get `civitai` together with a sync timestamp.
            for model in &mut file.models {
                if let Some(summary) = model.civitai.as_mut() {
                    summary.verified = model.sync_attempted_ms > 0;
                }
            }
        }
        let mut state = self.state.write().ok()?;
        state.comfy_root = Some(comfy_root.to_path_buf());
        state.roots = file.roots;
        state.models = file
            .models
            .into_iter()
            .map(|model| (model.id.clone(), model))
            .collect();
        state.warnings = file.warnings;
        state.scanned_at_ms = file.scanned_at_ms;
        Some(())
    }

    /// Memory → disk index → fresh scan. Does not clone the index; call
    /// `snapshot()` or `find()` afterwards.
    fn ensure_loaded(
        &self,
        app: &AppHandle,
        working_dir: &str,
        args: &[String],
    ) -> Result<(), String> {
        let comfy_root = civitai::comfy_dir(working_dir)?;
        if self.is_loaded_for(&comfy_root)? {
            return Ok(());
        }
        // Serialize with other loaders so concurrent callers (e.g. several LoRA
        // rows resolving at once) share one scan instead of each running their own.
        let _guard = self.scan_lock.lock().map_err(lock_error)?;
        if self.is_loaded_for(&comfy_root)? || self.load_disk_index(&comfy_root).is_some() {
            return Ok(());
        }
        self.scan_locked(app, working_dir, args).map(|_| ())
    }

    /// Resolves a ComfyUI-style name (`sub/name.safetensors`) within a category
    /// without cloning the index: exact relative name, then basename in the
    /// category, then basename anywhere.
    fn find(&self, category: &str, relative_name: &str) -> Result<Option<LocalModel>, String> {
        let category = canonical_category(category);
        let wanted = normalize_relative_name(relative_name);
        let basename = wanted.rsplit('/').next().unwrap_or(&wanted).to_string();
        let state = self.state.read().map_err(lock_error)?;
        // Basename fallbacks are ranked deterministically: same category first,
        // then the shallowest path, then name order (HashMap order is random).
        let rank = |model: &LocalModel| {
            (
                model.category != category,
                model.relative_name.matches('/').count(),
                model.relative_name.to_lowercase(),
            )
        };
        let mut fallback: Option<&LocalModel> = None;
        for model in state.models.values() {
            if model.category == category && normalize_relative_name(&model.relative_name) == wanted
            {
                return Ok(Some(model.clone()));
            }
            if model.filename.eq_ignore_ascii_case(&basename)
                && fallback.is_none_or(|best| rank(model) < rank(best))
            {
                fallback = Some(model);
            }
        }
        Ok(fallback.cloned())
    }

    fn is_loaded_for(&self, comfy_root: &Path) -> Result<bool, String> {
        let state = self.state.read().map_err(lock_error)?;
        Ok(state.comfy_root.as_deref() == Some(comfy_root) && state.scanned_at_ms > 0)
    }

    fn scan(
        &self,
        app: &AppHandle,
        working_dir: &str,
        args: &[String],
    ) -> Result<LocalModelsIndex, String> {
        let _guard = self.scan_lock.lock().map_err(lock_error)?;
        self.scan_locked(app, working_dir, args)
    }

    /// Caller must hold `scan_lock`.
    fn scan_locked(
        &self,
        app: &AppHandle,
        working_dir: &str,
        args: &[String],
    ) -> Result<LocalModelsIndex, String> {
        let comfy_root = civitai::comfy_dir(working_dir)?;
        let work = PathBuf::from(working_dir.trim().trim_matches(['"', '\'']));
        let (roots, mut warnings) = resolve_category_roots(&comfy_root, &work, args);

        let previous: HashMap<String, LocalModel> = self
            .state
            .read()
            .map_err(lock_error)?
            .models
            .values()
            .map(|model| (model.path.clone(), model.clone()))
            .collect();

        let progress = ProgressEmitter::new(app.clone());
        let mut files: Vec<(CategoryRoot, PathBuf)> = Vec::new();
        let mut seen_paths: HashSet<(String, PathBuf)> = HashSet::new();
        // The same directory can be listed twice (default folder + yaml entry with
        // different slashes/case); walk each physical directory once per category.
        let mut walked_roots: HashSet<(String, PathBuf)> = HashSet::new();
        for root in &roots {
            let root_path = PathBuf::from(&root.path);
            if !root_path.is_dir() {
                continue;
            }
            let canonical = root_path
                .canonicalize()
                .unwrap_or_else(|_| root_path.clone());
            if !walked_roots.insert((root.category.clone(), canonical)) {
                continue;
            }
            let mut visited = HashSet::new();
            collect_model_files(&root_path, &mut visited, &mut |path| {
                if seen_paths.insert((root.category.clone(), path.clone())) {
                    files.push((root.clone(), path));
                }
                progress.emit_index("scanning", files.len(), 0);
            });
        }

        let total = files.len();
        let mut models = HashMap::with_capacity(total);
        for (index, (root, path)) in files.into_iter().enumerate() {
            match describe_model(
                &root,
                &path,
                previous.get(&path.to_string_lossy().to_string()),
            ) {
                Ok(model) => {
                    models.insert(model.id.clone(), model);
                }
                Err(error) => warnings.push(format!("{}: {error}", path.display())),
            }
            progress.emit_index("indexing", index + 1, total);
        }
        progress.emit_index_now("done", total, total);

        {
            let mut state = self.state.write().map_err(lock_error)?;
            state.comfy_root = Some(comfy_root);
            state.roots = roots;
            state.models = models;
            state.warnings = warnings;
            state.scanned_at_ms = now_ms();
        }
        self.persist()?;
        self.snapshot()
    }

    /// Serves `<stem>.preview.*` (or a cached JPEG thumbnail) for the URI scheme.
    pub fn read_preview(&self, id: &str, thumbnail: bool) -> Option<(Vec<u8>, &'static str)> {
        let model = self.get(id)?;
        let preview = PathBuf::from(model.preview_path.as_ref()?);
        if thumbnail {
            let cache_dir = self.thumbnail_dir()?;
            fs::create_dir_all(&cache_dir).ok()?;
            let cached = cache_dir.join(thumbnail_name(id, &preview));
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
            let result = self.with_encode_slot(|| {
                let bytes = encode_jpeg_thumbnail(&preview, 400, 82)?;
                fs::write(&cached, &bytes).ok()?;
                Some((bytes, "image/jpeg"))
            });
            if let Ok(mut items) = lock.lock() {
                items.remove(id);
                ready.notify_all();
            }
            return result;
        }
        let bytes = fs::read(&preview).ok()?;
        let content_type = match image::guess_format(&bytes).ok()? {
            image::ImageFormat::Png => "image/png",
            image::ImageFormat::Jpeg => "image/jpeg",
            image::ImageFormat::WebP => "image/webp",
            image::ImageFormat::Gif => "image/gif",
            _ => return None,
        };
        Some((bytes, content_type))
    }

    /// Runs `encode` while holding one of the bounded thumbnail-encode slots.
    fn with_encode_slot<T>(&self, encode: impl FnOnce() -> Option<T>) -> Option<T> {
        let (slots, ready) = &*self.encode_slots;
        let mut free = slots.lock().ok()?;
        free = ready.wait_while(free, |free| *free == 0).ok()?;
        *free -= 1;
        drop(free);
        let result = encode();
        if let Ok(mut free) = slots.lock() {
            *free += 1;
            ready.notify_one();
        }
        result
    }

    fn clear_thumbnails(&self, id: &str) {
        let Some(dir) = self.thumbnail_dir() else {
            return;
        };
        let prefix = format!("v1-{id}-");
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with(&prefix) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
}

fn file_modified_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn thumbnail_name(id: &str, preview: &Path) -> String {
    format!(
        "v1-{id}-{}.jpg",
        file_modified_ms(preview).unwrap_or_default()
    )
}

/// Throttled progress events (50 ms) so large libraries do not flood the UI.
struct ProgressEmitter {
    app: AppHandle,
    last_emit_ms: AtomicU64,
}

impl ProgressEmitter {
    fn new(app: AppHandle) -> Self {
        Self {
            app,
            last_emit_ms: AtomicU64::new(0),
        }
    }

    fn should_emit(&self, min_interval_ms: u64) -> bool {
        let now = now_ms();
        let last = self.last_emit_ms.load(Ordering::Relaxed);
        now.saturating_sub(last) >= min_interval_ms
            && self
                .last_emit_ms
                .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
    }

    fn emit_index(&self, stage: &'static str, processed: usize, total: usize) {
        if self.should_emit(50) {
            self.emit_index_now(stage, processed, total);
        }
    }

    fn emit_index_now(&self, stage: &'static str, processed: usize, total: usize) {
        let _ = self.app.emit(
            "model-index-progress",
            IndexProgress {
                stage,
                processed,
                total,
            },
        );
    }

    fn emit_hash(&self, id: &str, processed: u64, total: u64, force: bool) {
        if force || self.should_emit(100) {
            let _ = self.app.emit(
                "model-hash-progress",
                HashProgress {
                    id: id.to_owned(),
                    processed,
                    total,
                },
            );
        }
    }
}

// ─── path resolution ──────────────────────────────────────────────────────────

fn canonical_category(name: &str) -> String {
    let lower = name.trim().to_ascii_lowercase();
    CATEGORY_ALIASES
        .iter()
        .find(|(alias, _)| *alias == lower)
        .map(|(_, canonical)| (*canonical).to_string())
        .unwrap_or(lower)
}

/// Lexically normalizes `.`/`..` components without touching the filesystem.
fn normalize_path(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !result.pop() {
                    result.push("..");
                }
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

/// `~` and `$VAR` / `%VAR%` expansion, mirroring Python's expanduser/expandvars.
fn expand_path(value: &str) -> String {
    let mut text = value.trim().to_string();
    if text == "~" || text.starts_with("~/") || text.starts_with("~\\") {
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            text = format!("{}{}", home.to_string_lossy(), &text[1..]);
        }
    }
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(char) = chars.next() {
        match char {
            '$' => {
                let name: String = if chars.peek() == Some(&'{') {
                    chars.next();
                    let name = chars.by_ref().take_while(|c| *c != '}').collect();
                    name
                } else {
                    let mut name = String::new();
                    while let Some(next) = chars.peek() {
                        if next.is_ascii_alphanumeric() || *next == '_' {
                            name.push(*next);
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    name
                };
                match std::env::var(&name) {
                    Ok(value) if !name.is_empty() => output.push_str(&value),
                    _ => {
                        output.push('$');
                        output.push_str(&name);
                    }
                }
            }
            '%' => {
                let rest: String = chars.clone().collect();
                if let Some(end) = rest.find('%') {
                    let name = &rest[..end];
                    if let Ok(value) = std::env::var(name) {
                        output.push_str(&value);
                        for _ in 0..=end {
                            chars.next();
                        }
                        continue;
                    }
                }
                output.push('%');
            }
            other => output.push(other),
        }
    }
    output
}

/// Parses an `extra_model_paths.yaml` document the way ComfyUI's
/// `utils/extra_config.py` does. Relative paths resolve against `yaml_dir`.
pub(crate) fn parse_extra_model_paths(
    text: &str,
    yaml_dir: &Path,
) -> Result<Vec<CategoryRoot>, String> {
    let document: serde_yaml::Value =
        serde_yaml::from_str(text).map_err(|error| format!("invalid YAML: {error}"))?;
    let Some(sections) = document.as_mapping() else {
        return Ok(Vec::new());
    };
    let mut roots = Vec::new();
    for (_name, section) in sections {
        let Some(section) = section.as_mapping() else {
            continue;
        };
        let base_path = section
            .get("base_path")
            .and_then(serde_yaml::Value::as_str)
            .map(|raw| {
                let expanded = PathBuf::from(expand_path(raw));
                if expanded.is_absolute() {
                    expanded
                } else {
                    yaml_dir.join(expanded)
                }
            });
        let is_default = match section.get("is_default") {
            Some(serde_yaml::Value::Bool(value)) => *value,
            Some(serde_yaml::Value::String(value)) => value.eq_ignore_ascii_case("true"),
            _ => false,
        };
        for (key, value) in section {
            let Some(key) = key.as_str() else {
                continue;
            };
            if IGNORED_YAML_KEYS.contains(&key) {
                continue;
            }
            let entries: Vec<String> = match value {
                serde_yaml::Value::String(text) => text
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(str::to_string)
                    .collect(),
                serde_yaml::Value::Sequence(items) => items
                    .iter()
                    .filter_map(serde_yaml::Value::as_str)
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(str::to_string)
                    .collect(),
                _ => continue,
            };
            let category = canonical_category(key);
            for entry in entries {
                let expanded = PathBuf::from(expand_path(&entry));
                let path = match &base_path {
                    Some(base) => base.join(&expanded),
                    None if expanded.is_absolute() => expanded,
                    None => yaml_dir.join(expanded),
                };
                roots.push(CategoryRoot {
                    category: category.clone(),
                    path: normalize_path(&path).to_string_lossy().into_owned(),
                    is_default,
                });
            }
        }
    }
    Ok(roots)
}

/// Every value following a repeatable flag (`--flag a b`, `--flag=a`).
fn multi_value_argument(args: &[String], flag: &str, work: &Path) -> Vec<PathBuf> {
    let mut values = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if let Some(value) = arg.strip_prefix(&format!("{flag}=")) {
            values.push(work.join(value.trim_matches(['"', '\''])));
        } else if arg == flag {
            index += 1;
            while index < args.len() && !args[index].starts_with("--") {
                values.push(work.join(args[index].trim_matches(['"', '\''])));
                index += 1;
            }
            continue;
        }
        index += 1;
    }
    values
}

/// Default `models/<category>` folders plus every `extra_model_paths.yaml` entry.
pub(crate) fn resolve_category_roots(
    comfy_root: &Path,
    work: &Path,
    args: &[String],
) -> (Vec<CategoryRoot>, Vec<String>) {
    let mut warnings = Vec::new();
    let base_dir = directory_argument(args, "--base-directory", work)
        .unwrap_or_else(|| comfy_root.to_path_buf());
    let models_dir = directory_argument(args, "--models-directory", work)
        .unwrap_or_else(|| base_dir.join("models"));

    let mut roots: Vec<CategoryRoot> = Vec::new();
    let push = |root: CategoryRoot, roots: &mut Vec<CategoryRoot>| {
        if !roots.iter().any(|existing| {
            existing.category == root.category && Path::new(&existing.path) == Path::new(&root.path)
        }) {
            roots.push(root);
        }
    };
    for category in DEFAULT_CATEGORIES {
        push(
            CategoryRoot {
                category: (*category).to_string(),
                path: models_dir.join(category).to_string_lossy().into_owned(),
                is_default: true,
            },
            &mut roots,
        );
    }
    for (legacy, canonical) in CATEGORY_ALIASES {
        let path = models_dir.join(legacy);
        if path.is_dir() {
            push(
                CategoryRoot {
                    category: (*canonical).to_string(),
                    path: path.to_string_lossy().into_owned(),
                    is_default: true,
                },
                &mut roots,
            );
        }
    }

    let mut yaml_files = Vec::new();
    let default_yaml = comfy_root.join("extra_model_paths.yaml");
    if default_yaml.is_file() {
        yaml_files.push(default_yaml);
    }
    yaml_files.extend(multi_value_argument(
        args,
        "--extra-model-paths-config",
        work,
    ));
    for yaml in yaml_files {
        let yaml_dir = yaml.parent().unwrap_or(comfy_root).to_path_buf();
        match fs::read_to_string(&yaml) {
            Ok(text) => match parse_extra_model_paths(&text, &yaml_dir) {
                Ok(extra) => {
                    for root in extra {
                        push(root, &mut roots);
                    }
                }
                Err(error) => warnings.push(format!("{}: {error}", yaml.display())),
            },
            Err(error) => warnings.push(format!("{}: {error}", yaml.display())),
        }
    }
    (roots, warnings)
}

// ─── scanning ─────────────────────────────────────────────────────────────────

fn collect_model_files(
    dir: &Path,
    visited: &mut HashSet<PathBuf>,
    on_file: &mut dyn FnMut(PathBuf),
) {
    let Ok(canonical) = dir.canonicalize() else {
        return;
    };
    if !visited.insert(canonical) {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.is_dir() {
            collect_model_files(&path, visited, on_file);
        } else if metadata.is_file() && is_model_file(&path) {
            on_file(path);
        }
    }
}

fn is_model_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.ends_with(".part") {
        return false;
    }
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| MODEL_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn model_id_for(path: &Path) -> String {
    let digest = Sha256::digest(path.to_string_lossy().as_bytes());
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn sibling_with(path: &Path, suffix: &str) -> Option<PathBuf> {
    let stem = path.file_stem()?.to_str()?;
    Some(path.with_file_name(format!("{stem}{suffix}")))
}

fn find_sidecar(path: &Path) -> Option<PathBuf> {
    [".civitai.info", ".cm-info.json"]
        .iter()
        .filter_map(|suffix| sibling_with(path, suffix))
        .find(|candidate| candidate.is_file())
}

fn find_preview(path: &Path) -> Option<PathBuf> {
    for extension in PREVIEW_EXTENSIONS {
        if let Some(candidate) = sibling_with(path, &format!(".preview.{extension}")) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for extension in PREVIEW_EXTENSIONS {
        if let Some(candidate) = sibling_with(path, &format!(".{extension}")) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn read_sidecar_value(path: &Path) -> Option<Value> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > MAX_SIDECAR_BYTES {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

pub(crate) fn summarize_civitai(value: &Value) -> CivitaiSummary {
    CivitaiSummary {
        model_id: value["modelId"].as_u64(),
        version_id: value["id"].as_u64(),
        model_name: value["model"]["name"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        version_name: value["name"].as_str().unwrap_or_default().to_string(),
        model_type: value["model"]["type"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        base_model: value["baseModel"].as_str().unwrap_or_default().to_string(),
        trained_words: value["trainedWords"]
            .as_array()
            .map(|words| {
                words
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|word| !word.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        nsfw: value["model"]["nsfw"].as_bool().unwrap_or(false),
        image_count: value["images"].as_array().map_or(0, Vec::len),
        latest_version_id: None,
        verified: false,
    }
}

/// SHA-256 hashes declared by a model-version record (`files[].hashes.SHA256`).
fn sidecar_hashes(value: &Value) -> Vec<String> {
    value["files"]
        .as_array()
        .map(|files| {
            files
                .iter()
                .filter_map(|file| file["hashes"]["SHA256"].as_str())
                .map(|hash| hash.to_ascii_lowercase())
                .collect()
        })
        .unwrap_or_default()
}

fn describe_model(
    root: &CategoryRoot,
    path: &Path,
    previous: Option<&LocalModel>,
) -> Result<LocalModel, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    let relative_name = path
        .strip_prefix(&root.path)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
    let sidecar = find_sidecar(path);
    let preview = find_preview(path);
    let sidecar_value = sidecar
        .as_ref()
        .and_then(|sidecar| read_sidecar_value(sidecar));
    let mut civitai = sidecar_value.as_ref().map(summarize_civitai);
    let unchanged = previous
        .is_some_and(|prev| prev.file_size == metadata.len() && prev.modified_ms == modified_ms);
    if let Some(summary) = civitai.as_mut() {
        if let Some(prev_summary) = previous
            .filter(|_| unchanged)
            .and_then(|prev| prev.civitai.as_ref())
        {
            if prev_summary.version_id == summary.version_id {
                summary.latest_version_id = prev_summary.latest_version_id;
                summary.verified = prev_summary.verified;
            }
        }
        // A cached hash that matches the sidecar's declared file hash proves the
        // sidecar belongs to this exact file, no network needed.
        if let (false, Some(hash), Some(value)) = (
            summary.verified,
            previous
                .filter(|_| unchanged)
                .and_then(LocalModel::valid_hash),
            sidecar_value.as_ref(),
        ) {
            summary.verified = sidecar_hashes(value)
                .iter()
                .any(|declared| declared == hash);
        }
    }
    Ok(LocalModel {
        id: model_id_for(path),
        category: root.category.clone(),
        relative_name,
        filename: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        root: root.path.clone(),
        extension: path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase(),
        file_size: metadata.len(),
        modified_ms,
        sha256: previous
            .filter(|_| unchanged)
            .and_then(|prev| prev.sha256.clone()),
        hash_size: previous
            .filter(|_| unchanged)
            .and_then(|prev| prev.hash_size),
        hash_modified_ms: previous
            .filter(|_| unchanged)
            .and_then(|prev| prev.hash_modified_ms),
        preview_path: preview.as_ref().map(|p| p.to_string_lossy().into_owned()),
        preview_modified_ms: preview.as_deref().and_then(file_modified_ms),
        sidecar: sidecar.map(|sidecar| sidecar.to_string_lossy().into_owned()),
        civitai,
        sync_attempted_ms: previous
            .filter(|_| unchanged)
            .map_or(0, |prev| prev.sync_attempted_ms),
    })
}

// ─── safetensors header ───────────────────────────────────────────────────────

pub(crate) fn read_safetensors_header(path: &Path) -> Result<Value, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let file_len = file.metadata().map_err(|error| error.to_string())?.len();
    let mut length = [0u8; 8];
    file.read_exact(&mut length)
        .map_err(|_| "File is too small to be a safetensors file.".to_string())?;
    let header_len = u64::from_le_bytes(length);
    if header_len == 0 || header_len > MAX_SAFETENSORS_HEADER || header_len + 8 > file_len {
        return Err("Invalid safetensors header length.".into());
    }
    let mut buffer = vec![0u8; header_len as usize];
    file.seek(SeekFrom::Start(8))
        .map_err(|error| error.to_string())?;
    file.read_exact(&mut buffer)
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&buffer).map_err(|error| format!("Invalid safetensors header: {error}"))
}

fn stringify(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// Top tags from Kohya's `ss_tag_frequency` (`{dataset: {tag: count}}`), with
/// `N_` repeat prefixes stripped.
pub(crate) fn suggested_words_from_tag_frequency(raw: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let mut counts: HashMap<String, u64> = HashMap::new();
    if let Some(datasets) = value.as_object() {
        for tags in datasets.values() {
            let Some(tags) = tags.as_object() else {
                continue;
            };
            for (tag, count) in tags {
                let tag = tag.trim();
                let tag = tag
                    .split_once('_')
                    .filter(|(prefix, _)| {
                        !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit())
                    })
                    .map_or(tag, |(_, rest)| rest)
                    .trim();
                if tag.is_empty() {
                    continue;
                }
                *counts.entry(tag.to_string()).or_default() += count.as_u64().unwrap_or(1);
            }
        }
    }
    let mut ranked: Vec<(String, u64)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ranked
        .into_iter()
        .take(MAX_SUGGESTED_WORDS)
        .map(|(tag, _)| tag)
        .collect()
}

pub(crate) fn header_info(header: &Value) -> ModelHeaderInfo {
    let mut info = ModelHeaderInfo::default();
    let Some(metadata) = header.get("__metadata__").and_then(Value::as_object) else {
        return info;
    };
    for (key, value) in metadata {
        info.metadata.insert(key.clone(), stringify(value));
    }
    if let Some(raw) = info.metadata.get("ss_tag_frequency") {
        info.suggested_words = suggested_words_from_tag_frequency(raw);
    }
    info.base_model = [
        "modelspec.architecture",
        "ss_base_model_version",
        "ss_sd_model_name",
    ]
    .iter()
    .find_map(|key| info.metadata.get(*key))
    .filter(|value| !value.trim().is_empty())
    .cloned();
    info
}

// ─── hashing ──────────────────────────────────────────────────────────────────

/// Error sentinel returned when the user cancels a hash/sync in progress.
pub(crate) const CANCELLED: &str = "CANCELLED";

/// Streams the file through SHA-256. `on_progress` returns `false` to abort.
fn hash_file(path: &Path, mut on_progress: impl FnMut(u64, u64) -> bool) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let total = file.metadata().map_err(|error| error.to_string())?.len();
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; HASH_BUFFER];
    let mut processed = 0u64;
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        processed += read as u64;
        if !on_progress(processed, total) {
            return Err(CANCELLED.into());
        }
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn ensure_hash(
    app: &AppHandle,
    index: &ModelIndex,
    model: &mut LocalModel,
) -> Result<String, String> {
    if let Some(hash) = model.valid_hash() {
        return Ok(hash.to_string());
    }
    let path = PathBuf::from(&model.path);
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    let progress = ProgressEmitter::new(app.clone());
    let id = model.id.clone();
    let cancel = index.cancel_sync.clone();
    let hash = hash_file(&path, |processed, total| {
        progress.emit_hash(&id, processed, total, processed == total);
        !cancel.load(Ordering::Relaxed)
    })?;
    model.sha256 = Some(hash.clone());
    model.hash_size = Some(metadata.len());
    model.hash_modified_ms = Some(
        metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or_default(),
    );
    model.file_size = metadata.len();
    model.modified_ms = model.hash_modified_ms.unwrap_or_default();
    index.update(model.clone())?;
    Ok(hash)
}

// ─── civitai sync ─────────────────────────────────────────────────────────────

fn resolve_api_key(app: &AppHandle, api_key: &str) -> String {
    if !api_key.trim().is_empty() {
        return api_key.trim().to_string();
    }
    crate::load_app_data_entry(app, "config", "civitai_settings")
        .ok()
        .flatten()
        .and_then(|settings| {
            settings["apiKey"]
                .as_str()
                .map(str::trim)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn model_file_parts(model: &LocalModel) -> Result<(PathBuf, PathBuf, String), String> {
    let path = PathBuf::from(&model.path);
    if !path.is_file() {
        return Err("Model file no longer exists. Rescan the library.".into());
    }
    let directory = path
        .parent()
        .ok_or("Model file has no parent directory.")?
        .to_path_buf();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Model file has no name.")?
        .to_string();
    Ok((path, directory, stem))
}

fn sync_blocking(
    app: &AppHandle,
    index: &ModelIndex,
    id: &str,
    api_key: &str,
) -> Result<LocalModel, String> {
    let mut model = index.get(id).ok_or("Model not found in the index.")?;
    let (_path, directory, stem) = model_file_parts(&model)?;
    let hash = ensure_hash(app, index, &mut model)?;
    let url = civitai::model_version_by_hash_url(&hash)?;
    model.sync_attempted_ms = now_ms();
    let metadata = match civitai::fetch_model_version(app, &url, api_key) {
        Ok(metadata) => metadata,
        Err(error) => {
            index.update(model)?;
            return Err(error);
        }
    };
    civitai::write_sidecars(&directory, &stem, &metadata)?;
    if model.preview_path.is_none() {
        match civitai::client()
            .and_then(|client| civitai::download_preview(&client, &metadata, &directory, &stem))
        {
            Ok(Some(preview)) => {
                model.preview_modified_ms = file_modified_ms(&preview);
                model.preview_modified_ms = file_modified_ms(&preview);
                model.preview_path = Some(preview.to_string_lossy().into_owned());
            }
            Ok(None) => {}
            Err(error) => eprintln!("Civitai preview unavailable for {stem}: {error}"),
        }
    }
    model.sidecar = Some(
        directory
            .join(format!("{stem}.civitai.info"))
            .to_string_lossy()
            .into_owned(),
    );
    let previous_latest = model
        .civitai
        .as_ref()
        .and_then(|summary| summary.latest_version_id);
    let mut summary = summarize_civitai(&metadata);
    summary.latest_version_id = previous_latest;
    summary.verified = true;
    model.civitai = Some(summary);
    index.clear_thumbnails(id);
    index.update(model.clone())?;
    Ok(model)
}

// ─── commands ─────────────────────────────────────────────────────────────────

fn run_blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> impl std::future::Future<Output = Result<T, String>> {
    async move {
        tauri::async_runtime::spawn_blocking(task)
            .await
            .map_err(|error| error.to_string())?
    }
}

#[tauri::command]
pub async fn list_local_models_index(
    app_handle: AppHandle,
    working_dir: String,
    args: Vec<String>,
    index: State<'_, ModelIndex>,
) -> Result<LocalModelsIndex, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        index.ensure_loaded(&app_handle, &working_dir, &args)?;
        index.snapshot()
    })
    .await
}

#[tauri::command]
pub async fn rescan_models(
    app_handle: AppHandle,
    working_dir: String,
    args: Vec<String>,
    index: State<'_, ModelIndex>,
) -> Result<LocalModelsIndex, String> {
    let index = index.inner().clone();
    run_blocking(move || index.scan(&app_handle, &working_dir, &args)).await
}

fn normalize_relative_name(name: &str) -> String {
    name.trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_lowercase()
}

#[tauri::command]
pub async fn find_local_model(
    app_handle: AppHandle,
    working_dir: String,
    args: Vec<String>,
    category: String,
    relative_name: String,
    index: State<'_, ModelIndex>,
) -> Result<Option<LocalModel>, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        index.ensure_loaded(&app_handle, &working_dir, &args)?;
        index.find(&category, &relative_name)
    })
    .await
}

#[tauri::command]
pub async fn read_model_metadata(
    id: String,
    index: State<'_, ModelIndex>,
) -> Result<ModelHeaderInfo, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        let model = index.get(&id).ok_or("Model not found in the index.")?;
        if model.extension != "safetensors" {
            return Ok(ModelHeaderInfo::default());
        }
        let header = read_safetensors_header(Path::new(&model.path))?;
        Ok(header_info(&header))
    })
    .await
}

#[tauri::command]
pub async fn read_model_sidecar(
    id: String,
    index: State<'_, ModelIndex>,
) -> Result<Option<Value>, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        let model = index.get(&id).ok_or("Model not found in the index.")?;
        Ok(model
            .sidecar
            .as_deref()
            .and_then(|sidecar| read_sidecar_value(Path::new(sidecar))))
    })
    .await
}

#[tauri::command]
pub async fn hash_model(
    app_handle: AppHandle,
    id: String,
    index: State<'_, ModelIndex>,
) -> Result<String, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        index.cancel_sync.store(false, Ordering::Relaxed);
        let mut model = index.get(&id).ok_or("Model not found in the index.")?;
        ensure_hash(&app_handle, &index, &mut model)
    })
    .await
}

#[tauri::command]
pub async fn sync_model_with_civitai(
    app_handle: AppHandle,
    id: String,
    api_key: String,
    index: State<'_, ModelIndex>,
) -> Result<LocalModel, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        index.cancel_sync.store(false, Ordering::Relaxed);
        let api_key = resolve_api_key(&app_handle, &api_key);
        sync_blocking(&app_handle, &index, &id, &api_key)
    })
    .await
}

#[tauri::command]
pub async fn sync_all_models(
    app_handle: AppHandle,
    working_dir: String,
    args: Vec<String>,
    api_key: String,
    only_unsynced: bool,
    index: State<'_, ModelIndex>,
) -> Result<SyncAllResult, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        let api_key = resolve_api_key(&app_handle, &api_key);
        index.ensure_loaded(&app_handle, &working_dir, &args)?;
        let snapshot = index.snapshot()?;
        index.cancel_sync.store(false, Ordering::Relaxed);
        let targets: Vec<LocalModel> = snapshot
            .models
            .into_iter()
            .filter(|model| {
                !only_unsynced || (!model.is_verified() && model.sync_attempted_ms == 0)
            })
            .collect();
        let total = targets.len();
        let mut result = SyncAllResult::default();
        let emit = |stage: &'static str, processed: usize, current: &str, error: Option<String>| {
            let _ = app_handle.emit(
                "model-sync-progress",
                SyncProgress {
                    stage,
                    processed,
                    total,
                    current: current.to_string(),
                    error,
                },
            );
        };
        for (position, model) in targets.iter().enumerate() {
            if index.cancel_sync.load(Ordering::Relaxed) {
                result.cancelled = true;
                break;
            }
            emit("syncing", position, &model.filename, None);
            match sync_blocking(&app_handle, &index, &model.id, &api_key) {
                Ok(_) => result.synced += 1,
                Err(error) if error == CANCELLED => {
                    result.cancelled = true;
                    break;
                }
                Err(error) if error == "NOT_FOUND" => {
                    result.skipped += 1;
                    emit(
                        "syncing",
                        position + 1,
                        &model.filename,
                        Some("Not on Civitai".into()),
                    );
                }
                Err(error) => {
                    result.failed += 1;
                    emit(
                        "syncing",
                        position + 1,
                        &model.filename,
                        Some(error.clone()),
                    );
                    if error.contains("429") {
                        result.error = Some("Civitai rate limit reached; try again later.".into());
                        break;
                    }
                }
            }
            std::thread::sleep(SYNC_SPACING);
        }
        emit("done", total, "", None);
        Ok(result)
    })
    .await
}

#[tauri::command]
pub fn cancel_model_sync(index: State<'_, ModelIndex>) {
    index.cancel_sync.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub async fn check_model_update(
    app_handle: AppHandle,
    id: String,
    api_key: String,
    index: State<'_, ModelIndex>,
) -> Result<Option<u64>, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        let api_key = resolve_api_key(&app_handle, &api_key);
        let mut model = index.get(&id).ok_or("Model not found in the index.")?;
        let Some(summary) = model.civitai.as_mut() else {
            return Ok(None);
        };
        let Some(model_id) = summary.model_id else {
            return Ok(None);
        };
        let remote = civitai::fetch_model_by_id(&app_handle, model_id, &api_key)?;
        let latest = remote["modelVersions"]
            .as_array()
            .and_then(|versions| versions.first())
            .and_then(|version| version["id"].as_u64());
        summary.latest_version_id = latest;
        index.update(model)?;
        Ok(latest)
    })
    .await
}

fn is_within_roots(path: &Path, roots: &[CategoryRoot]) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    roots.iter().any(|root| {
        Path::new(&root.path)
            .canonicalize()
            .is_ok_and(|root| canonical.starts_with(root))
    })
}

fn sidecar_candidates(path: &Path) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = [".civitai.info", ".cm-info.json"]
        .iter()
        .filter_map(|suffix| sibling_with(path, suffix))
        .collect();
    for extension in PREVIEW_EXTENSIONS {
        candidates.extend(sibling_with(path, &format!(".preview.{extension}")));
        candidates.extend(sibling_with(path, &format!(".{extension}")));
    }
    candidates
}

#[tauri::command]
pub async fn delete_model(id: String, index: State<'_, ModelIndex>) -> Result<Vec<String>, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        let model = index.get(&id).ok_or("Model not found in the index.")?;
        let roots = index.state.read().map_err(lock_error)?.roots.clone();
        let path = PathBuf::from(&model.path);
        if !is_within_roots(&path, &roots) {
            return Err("Refusing to delete a file outside the known model folders.".into());
        }
        let mut deleted = Vec::new();
        if path.is_file() {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
            deleted.push(path.to_string_lossy().into_owned());
        }
        for candidate in sidecar_candidates(&path) {
            if candidate.is_file() && fs::remove_file(&candidate).is_ok() {
                deleted.push(candidate.to_string_lossy().into_owned());
            }
        }
        index.clear_thumbnails(&id);
        index.remove(&id)?;
        Ok(deleted)
    })
    .await
}

fn image_extension(bytes: &[u8]) -> Result<&'static str, String> {
    let format = image::guess_format(bytes).map_err(|_| "Unsupported image format.".to_string())?;
    Ok(match format {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::WebP => "webp",
        image::ImageFormat::Gif => "gif",
        _ => return Err("Only PNG, JPEG, WebP and GIF previews are supported.".into()),
    })
}

#[tauri::command]
pub async fn set_model_preview(
    id: String,
    source: PreviewSource,
    index: State<'_, ModelIndex>,
) -> Result<LocalModel, String> {
    let index = index.inner().clone();
    run_blocking(move || {
        let mut model = index.get(&id).ok_or("Model not found in the index.")?;
        let (path, directory, stem) = model_file_parts(&model)?;
        let bytes = match source {
            PreviewSource::Url { url } => {
                let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
                if parsed.scheme() != "https" || !civitai::is_civitai_host(&parsed) {
                    return Err("Preview images can only be fetched from civitai.com.".into());
                }
                let response = civitai::client()?
                    .get(parsed)
                    .send()
                    .map_err(|error| error.to_string())?;
                if !response.status().is_success() {
                    return Err(format!(
                        "Preview download failed with {}",
                        response.status()
                    ));
                }
                response
                    .bytes()
                    .map_err(|error| error.to_string())?
                    .to_vec()
            }
            PreviewSource::LocalPath { path } => fs::read(path.trim().trim_matches(['"', '\'']))
                .map_err(|error| error.to_string())?,
        };
        let extension = image_extension(&bytes)?;
        image::load_from_memory(&bytes)
            .map_err(|_| "The selected file is not a valid image.".to_string())?;
        for old in PREVIEW_EXTENSIONS {
            if let Some(candidate) = sibling_with(&path, &format!(".preview.{old}")) {
                let _ = fs::remove_file(candidate);
            }
        }
        let preview = directory.join(format!("{stem}.preview.{extension}"));
        fs::write(&preview, bytes).map_err(|error| error.to_string())?;
        index.clear_thumbnails(&id);
        model.preview_path = Some(preview.to_string_lossy().into_owned());
        index.update(model.clone())?;
        Ok(model)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("comfygui-mm-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_extra_model_paths_like_comfyui() {
        let yaml_dir = temp_dir("yaml");
        let text = "a111:\n  base_path: C:/sd\n  checkpoints: models/Stable-diffusion\n  loras: |\n    models/Lora\n    models/LyCORIS\n  unet: models/unet\n  custom_nodes: extensions\nlist_style:\n  clip:\n    - C:/abs/clip\n    - rel/clip\nrelative:\n  base_path: ../shared\n  is_default: true\n  vae: vae\nempty:\n";
        let roots = parse_extra_model_paths(text, &yaml_dir).unwrap();
        let find = |category: &str| -> Vec<String> {
            roots
                .iter()
                .filter(|root| root.category == category)
                .map(|root| root.path.replace('\\', "/"))
                .collect()
        };
        assert_eq!(find("checkpoints"), vec!["C:/sd/models/Stable-diffusion"]);
        assert_eq!(
            find("loras"),
            vec!["C:/sd/models/Lora", "C:/sd/models/LyCORIS"]
        );
        assert_eq!(find("diffusion_models"), vec!["C:/sd/models/unet"]);
        assert!(find("custom_nodes").is_empty());
        let clip = find("text_encoders");
        assert_eq!(clip[0], "C:/abs/clip");
        assert!(clip[1].ends_with("/rel/clip"));
        let vae = roots.iter().find(|root| root.category == "vae").unwrap();
        assert!(vae.is_default);
        assert!(!vae.path.contains(".."));
        assert!(vae.path.replace('\\', "/").ends_with("shared/vae"));
        assert!(parse_extra_model_paths("a: [unclosed", &yaml_dir).is_err());
        let _ = fs::remove_dir_all(yaml_dir);
    }

    #[test]
    fn resolves_roots_from_launch_args() {
        let work = temp_dir("roots");
        fs::write(work.join("main.py"), "").unwrap();
        fs::create_dir_all(work.join("custom").join("loras")).unwrap();
        fs::write(work.join("a.yaml"), "x:\n  loras: extra_a\n").unwrap();
        fs::write(work.join("b.yaml"), "y:\n  loras: extra_b\n").unwrap();
        fs::write(
            work.join("extra_model_paths.yaml"),
            "z:\n  loras: extra_z\n",
        )
        .unwrap();
        let args = vec![
            "--models-directory".to_string(),
            "custom".to_string(),
            "--extra-model-paths-config".to_string(),
            "a.yaml".to_string(),
            "b.yaml".to_string(),
            "--listen".to_string(),
        ];
        let (roots, warnings) = resolve_category_roots(&work, &work, &args);
        assert!(warnings.is_empty());
        let loras: Vec<String> = roots
            .iter()
            .filter(|root| root.category == "loras")
            .map(|root| root.path.replace('\\', "/"))
            .collect();
        assert!(loras[0].ends_with("custom/loras"));
        assert!(loras.iter().any(|path| path.ends_with("extra_z")));
        assert!(loras.iter().any(|path| path.ends_with("extra_a")));
        assert!(loras.iter().any(|path| path.ends_with("extra_b")));
        let _ = fs::remove_dir_all(work);
    }

    #[test]
    fn scans_models_with_sidecars_and_previews() {
        let root = temp_dir("scan");
        let loras = root.join("models").join("loras");
        fs::create_dir_all(loras.join("sub")).unwrap();
        fs::write(loras.join("sub").join("x.safetensors"), b"data").unwrap();
        fs::write(
            loras.join("sub").join("x.civitai.info"),
            r#"{"id":11,"modelId":22,"name":"v1","baseModel":"Illustrious","trainedWords":["foo","bar"],"model":{"name":"X","type":"LORA","nsfw":false},"images":[{"url":"a"}]}"#,
        )
        .unwrap();
        fs::write(loras.join("sub").join("x.preview.png"), b"png").unwrap();
        fs::write(loras.join("partial.safetensors.part"), b"").unwrap();
        fs::write(loras.join("plain.ckpt"), b"ckpt").unwrap();
        let category = CategoryRoot {
            category: "loras".into(),
            path: loras.to_string_lossy().into_owned(),
            is_default: true,
        };
        let mut files = Vec::new();
        collect_model_files(&loras, &mut HashSet::new(), &mut |path| files.push(path));
        assert_eq!(files.len(), 2);
        let model =
            describe_model(&category, &loras.join("sub").join("x.safetensors"), None).unwrap();
        assert_eq!(model.relative_name, "sub/x.safetensors");
        assert_eq!(
            model.civitai.as_ref().unwrap().trained_words,
            vec!["foo", "bar"]
        );
        assert_eq!(model.civitai.as_ref().unwrap().version_id, Some(11));
        assert!(model
            .preview_path
            .as_ref()
            .unwrap()
            .ends_with("x.preview.png"));
        let again = describe_model(
            &category,
            &loras.join("sub").join("x.safetensors"),
            Some(&model),
        )
        .unwrap();
        assert_eq!(again.id, model.id);
        // Sidecar metadata alone is unverified …
        assert!(!again.civitai.as_ref().unwrap().verified);
        // … until a cached hash matches the hash the sidecar declares.
        let data_hash = hash_file(&loras.join("sub").join("x.safetensors"), |_, _| true).unwrap();
        fs::write(
            loras.join("sub").join("x.civitai.info"),
            format!(
                r#"{{"id":11,"modelId":22,"name":"v1","trainedWords":["foo","bar"],"model":{{"name":"X","type":"LORA"}},"files":[{{"hashes":{{"SHA256":"{}"}}}}]}}"#,
                data_hash.to_uppercase()
            ),
        )
        .unwrap();
        let mut hashed = again.clone();
        hashed.sha256 = Some(data_hash);
        hashed.hash_size = Some(hashed.file_size);
        hashed.hash_modified_ms = Some(hashed.modified_ms);
        let verified = describe_model(
            &category,
            &loras.join("sub").join("x.safetensors"),
            Some(&hashed),
        )
        .unwrap();
        assert!(verified.civitai.as_ref().unwrap().verified);
        let mut mismatched = hashed.clone();
        mismatched.sha256 = Some("0".repeat(64));
        let unverified = describe_model(
            &category,
            &loras.join("sub").join("x.safetensors"),
            Some(&mismatched),
        )
        .unwrap();
        assert!(!unverified.civitai.as_ref().unwrap().verified);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reads_safetensors_header_and_suggests_words() {
        let dir = temp_dir("header");
        let header = serde_json::json!({
            "__metadata__": {
                "ss_tag_frequency": "{\"ds\":{\"1_1girl\":30,\"foo\":5,\"1girl\":2}}",
                "modelspec.architecture": "sdxl",
                "ss_epoch": 10
            },
            "w": {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]}
        })
        .to_string();
        let path = dir.join("m.safetensors");
        let mut bytes = (header.len() as u64).to_le_bytes().to_vec();
        bytes.extend_from_slice(header.as_bytes());
        bytes.extend_from_slice(&[0, 0]);
        fs::write(&path, &bytes).unwrap();
        let info = header_info(&read_safetensors_header(&path).unwrap());
        assert_eq!(info.suggested_words, vec!["1girl", "foo"]);
        assert_eq!(info.base_model.as_deref(), Some("sdxl"));
        assert_eq!(
            info.metadata.get("ss_epoch").map(String::as_str),
            Some("10")
        );
        let oversized = dir.join("bad.safetensors");
        fs::write(&oversized, (u64::MAX).to_le_bytes()).unwrap();
        assert!(read_safetensors_header(&oversized).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn hashes_files_and_validates_cache() {
        let dir = temp_dir("hash");
        let path = dir.join("m.safetensors");
        fs::write(&path, b"hello world").unwrap();
        let mut calls = 0;
        let hash = hash_file(&path, |_, _| {
            calls += 1;
            true
        })
        .unwrap();
        assert_eq!(
            hash_file(&path, |_, _| false).unwrap_err(),
            CANCELLED,
            "progress callback returning false aborts"
        );
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
        assert!(calls >= 1);
        let root = CategoryRoot {
            category: "loras".into(),
            path: dir.to_string_lossy().into_owned(),
            is_default: true,
        };
        let mut model = describe_model(&root, &path, None).unwrap();
        assert!(model.valid_hash().is_none());
        model.sha256 = Some(hash.clone());
        model.hash_size = Some(model.file_size);
        model.hash_modified_ms = Some(model.modified_ms);
        assert_eq!(model.valid_hash(), Some(hash.as_str()));
        model.hash_size = Some(model.file_size + 1);
        assert!(model.valid_hash().is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn refuses_paths_outside_roots_and_matches_names() {
        let dir = temp_dir("roots-check");
        let inside = dir.join("models").join("loras");
        fs::create_dir_all(&inside).unwrap();
        fs::write(inside.join("a.safetensors"), b"a").unwrap();
        let outside = dir.join("elsewhere.safetensors");
        fs::write(&outside, b"b").unwrap();
        let roots = vec![CategoryRoot {
            category: "loras".into(),
            path: inside.to_string_lossy().into_owned(),
            is_default: true,
        }];
        assert!(is_within_roots(&inside.join("a.safetensors"), &roots));
        assert!(!is_within_roots(&outside, &roots));
        assert_eq!(
            normalize_relative_name("Sub\\Name.safetensors"),
            "sub/name.safetensors"
        );
        assert_eq!(canonical_category("UNET"), "diffusion_models");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn finds_models_by_relative_name_then_basename() {
        let index = ModelIndex::default();
        let mk = |id: &str, category: &str, relative: &str| LocalModel {
            id: id.into(),
            category: category.into(),
            relative_name: relative.into(),
            filename: relative.rsplit('/').next().unwrap().into(),
            path: format!("C:/m/{category}/{relative}"),
            root: format!("C:/m/{category}"),
            extension: "safetensors".into(),
            file_size: 1,
            modified_ms: 1,
            sha256: None,
            hash_size: None,
            hash_modified_ms: None,
            preview_path: None,
            preview_modified_ms: None,
            sidecar: None,
            civitai: None,
            sync_attempted_ms: 0,
        };
        {
            let mut state = index.state.write().unwrap();
            for model in [
                mk("a", "loras", "style/Foo.safetensors"),
                mk("b", "loras", "Foo.safetensors"),
                mk("c", "checkpoints", "Bar.safetensors"),
            ] {
                state.models.insert(model.id.clone(), model);
            }
        }
        let find = |category: &str, name: &str| index.find(category, name).unwrap().map(|m| m.id);
        assert_eq!(find("loras", "style\\foo.safetensors"), Some("a".into()));
        assert_eq!(find("loras", "Foo.safetensors"), Some("b".into()));
        assert_eq!(find("loras", "other/foo.safetensors"), Some("b".into()));
        assert_eq!(find("loras", "bar.safetensors"), Some("c".into()));
        assert_eq!(find("unet", "missing.safetensors"), None);
    }

    #[test]
    fn multi_value_arguments_and_expansion() {
        let work = PathBuf::from("W");
        let args: Vec<String> = [
            "--extra-model-paths-config=one.yaml",
            "--extra-model-paths-config",
            "two.yaml",
            "three.yaml",
            "--port",
            "1",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let values = multi_value_argument(&args, "--extra-model-paths-config", &work);
        assert_eq!(values.len(), 3);
        std::env::set_var("COMFYGUI_TEST_VAR", "expanded");
        assert_eq!(expand_path("$COMFYGUI_TEST_VAR/x"), "expanded/x");
        assert_eq!(expand_path("${COMFYGUI_TEST_VAR}/x"), "expanded/x");
        assert_eq!(expand_path("%COMFYGUI_TEST_VAR%/x"), "expanded/x");
        assert_eq!(expand_path("$MISSING_VAR_XYZ/x"), "$MISSING_VAR_XYZ/x");
        assert_eq!(
            normalize_path(Path::new("a/b/../c/./d")),
            PathBuf::from("a/c/d")
        );
    }
}
