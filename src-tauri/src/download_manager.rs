use reqwest::blocking::Client;
use reqwest::header::{CONTENT_RANGE, RANGE};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub gid: String,
    pub version_id: u64,
    pub name: String,
    pub file_name: String,
    pub model_type: String,
    pub base_model: String,
    pub model_path: String,
    pub preview_url: Option<String>,
    pub status: String,
    pub completed_length: u64,
    pub total_length: u64,
    pub download_speed: u64,
    pub error_message: Option<String>,
    pub created_at: u64,
    #[serde(default = "default_file_exists")]
    pub file_exists: bool,
    #[serde(default, rename = "_url", skip_serializing)]
    url: String,
}

fn default_file_exists() -> bool {
    true
}

pub struct NewDownload {
    pub version_id: u64,
    pub name: String,
    pub file_name: String,
    pub model_type: String,
    pub base_model: String,
    pub model_path: PathBuf,
    pub preview_url: Option<String>,
    pub url: String,
}

#[derive(Default)]
struct JobControl {
    cancelled: AtomicBool,
    paused: AtomicBool,
}

#[derive(Default)]
struct Inner {
    records: Vec<DownloadRecord>,
    jobs: HashMap<String, Arc<JobControl>>,
    loaded: bool,
}

#[derive(Clone, Default)]
pub struct DownloadManager {
    inner: Arc<Mutex<Inner>>,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("downloads"))
}

fn load_history(inner: &mut Inner, app: &AppHandle) -> Result<(), String> {
    if inner.loaded {
        return Ok(());
    }
    inner.records = fs::read(config_dir(app)?.join("downloads.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    inner.loaded = true;
    Ok(())
}

fn save_history(inner: &Inner, app: &AppHandle) -> Result<(), String> {
    let directory = config_dir(app)?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let records = inner
        .records
        .iter()
        .map(|record| {
            let mut value = serde_json::to_value(record).map_err(|e| e.to_string())?;
            value["_url"] = record.url.clone().into();
            Ok(value)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let bytes = serde_json::to_vec_pretty(&records).map_err(|e| e.to_string())?;
    fs::write(directory.join("downloads.json"), bytes).map_err(|e| e.to_string())
}

fn cleanup_files(model_path: &Path) {
    let _ = fs::remove_file(model_path);
    let _ = fs::remove_file(format!("{}.part", model_path.display()));
    let (Some(parent), Some(stem)) = (
        model_path.parent(),
        model_path.file_stem().and_then(|v| v.to_str()),
    ) else {
        return;
    };
    for suffix in [
        "civitai.info",
        "cm-info.json",
        "preview.jpg",
        "preview.jpeg",
        "preview.png",
        "preview.webp",
    ] {
        let _ = fs::remove_file(parent.join(format!("{stem}.{suffix}")));
    }
}

fn content_range_total(value: &str) -> Option<u64> {
    value.rsplit('/').next()?.parse().ok()
}

impl DownloadManager {
    fn update_record(
        &self,
        app: &AppHandle,
        gid: &str,
        update: impl FnOnce(&mut DownloadRecord),
        persist: bool,
    ) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        let Some(record) = inner.records.iter_mut().find(|record| record.gid == gid) else {
            return false;
        };
        update(record);
        if persist {
            let _ = save_history(&inner, app);
        }
        true
    }

    fn start(&self, app: AppHandle, record: DownloadRecord) {
        let control = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            if inner.jobs.contains_key(&record.gid) {
                return;
            }
            let control = Arc::new(JobControl::default());
            control
                .paused
                .store(record.status == "paused", Ordering::Relaxed);
            inner.jobs.insert(record.gid.clone(), control.clone());
            control
        };
        let manager = self.clone();
        thread::spawn(move || manager.run_download(app, record, control));
    }

    fn run_download(&self, app: AppHandle, record: DownloadRecord, control: Arc<JobControl>) {
        let result = self.download(&app, &record, &control);
        if control.cancelled.load(Ordering::Relaxed) {
            cleanup_files(Path::new(&record.model_path));
        } else if let Err(error) = result {
            self.update_record(
                &app,
                &record.gid,
                |item| {
                    item.status = "error".into();
                    item.download_speed = 0;
                    item.error_message = Some(error);
                },
                true,
            );
        }
        if let Ok(mut inner) = self.inner.lock() {
            inner.jobs.remove(&record.gid);
        }
    }

    fn download(
        &self,
        app: &AppHandle,
        record: &DownloadRecord,
        control: &JobControl,
    ) -> Result<(), String> {
        if record.url.is_empty() {
            return Err("This download cannot be resumed; cancel and retry it.".into());
        }
        let model_path = Path::new(&record.model_path);
        let partial_path = PathBuf::from(format!("{}.part", model_path.display()));
        let mut completed = fs::metadata(&partial_path)
            .map(|meta| meta.len())
            .unwrap_or(0);
        let client = Client::builder()
            .user_agent("Koharu/1.0")
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(60 * 60 * 6))
            .build()
            .map_err(|e| e.to_string())?;
        let mut request = client.get(&record.url);
        if completed > 0 {
            request = request.header(RANGE, format!("bytes={completed}-"));
        }
        let mut response = request.send().map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("Model download failed with {}.", response.status()));
        }
        if completed > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            completed = 0;
        }
        let total = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(content_range_total)
            .or_else(|| response.content_length().map(|n| n + completed))
            .unwrap_or(0);
        let mut hasher = Sha256::new();
        if completed > 0 {
            let mut partial = File::open(&partial_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut (&mut partial).take(completed), &mut hasher)
                .map_err(|e| e.to_string())?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(completed == 0)
            .open(&partial_path)
            .map_err(|e| e.to_string())?;
        if completed > 0 {
            file.seek(SeekFrom::Start(completed))
                .map_err(|e| e.to_string())?;
        }
        self.update_record(
            app,
            &record.gid,
            |item| {
                if item.status != "paused" {
                    item.status = "active".into();
                }
                item.completed_length = completed;
                item.total_length = total;
                item.error_message = None;
            },
            true,
        );

        let mut buffer = [0_u8; 256 * 1024];
        let mut speed_bytes = 0_u64;
        let mut speed_at = Instant::now();
        loop {
            if control.cancelled.load(Ordering::Relaxed) {
                return Ok(());
            }
            while control.paused.load(Ordering::Relaxed) {
                if control.cancelled.load(Ordering::Relaxed) {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(100));
            }
            let read = response.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            hasher.update(&buffer[..read]);
            completed += read as u64;
            speed_bytes += read as u64;
            let elapsed = speed_at.elapsed();
            let speed = if elapsed >= Duration::from_millis(500) {
                let value = (speed_bytes as f64 / elapsed.as_secs_f64()) as u64;
                speed_bytes = 0;
                speed_at = Instant::now();
                value
            } else {
                0
            };
            self.update_record(
                app,
                &record.gid,
                |item| {
                    if item.status != "paused" {
                        item.status = "active".into();
                    }
                    item.completed_length = completed;
                    if speed > 0 {
                        item.download_speed = speed;
                    }
                },
                false,
            );
        }
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&partial_path, model_path).map_err(|e| e.to_string())?;
        let sha256 = format!("{:x}", hasher.finalize());
        if let Err(error) = crate::model_manager::record_downloaded_hash(app, model_path, &sha256) {
            eprintln!(
                "Could not record hash for {}: {error}",
                model_path.display()
            );
        }
        self.update_record(
            app,
            &record.gid,
            |item| {
                item.status = "complete".into();
                item.completed_length = completed;
                if item.total_length == 0 {
                    item.total_length = completed;
                }
                item.download_speed = 0;
                item.file_exists = true;
            },
            true,
        );
        Ok(())
    }

    pub fn add(&self, app: &AppHandle, download: NewDownload) -> Result<DownloadRecord, String> {
        let record = {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            load_history(&mut inner, app)?;
            if let Some(pos) = inner.records.iter().position(|record| {
                record.version_id == download.version_id
                    && !matches!(record.status.as_str(), "error" | "removed")
            }) {
                let existing = &inner.records[pos];
                if existing.status == "complete" && !Path::new(&existing.model_path).is_file() {
                    inner.records.remove(pos);
                } else {
                    return Ok(existing.clone());
                }
            }
            let created_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let record = DownloadRecord {
                gid: format!("{}-{created_at}", download.version_id),
                version_id: download.version_id,
                name: download.name,
                file_name: download.file_name,
                model_type: download.model_type,
                base_model: download.base_model,
                model_path: download.model_path.to_string_lossy().to_string(),
                preview_url: download.preview_url,
                status: "waiting".into(),
                completed_length: 0,
                total_length: 0,
                download_speed: 0,
                error_message: None,
                created_at,
                file_exists: false,
                url: download.url,
            };
            inner.records.insert(0, record.clone());
            save_history(&inner, app)?;
            record
        };
        self.start(app.clone(), record.clone());
        Ok(record)
    }

    fn refresh(&self, app: &AppHandle) -> Result<Vec<DownloadRecord>, String> {
        let restart = {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            load_history(&mut inner, app)?;
            let restart = inner
                .records
                .iter()
                .filter(|record| {
                    matches!(record.status.as_str(), "active" | "waiting" | "paused")
                        && !inner.jobs.contains_key(&record.gid)
                })
                .cloned()
                .collect::<Vec<_>>();
            for record in &mut inner.records {
                record.file_exists =
                    record.status == "complete" && Path::new(&record.model_path).is_file();
            }
            restart
        };
        for record in restart {
            self.start(app.clone(), record);
        }
        Ok(self
            .inner
            .lock()
            .map_err(|e| e.to_string())?
            .records
            .clone())
    }

    fn change_status(&self, app: &AppHandle, gid: &str, paused: bool) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        load_history(&mut inner, app)?;
        let record = inner
            .records
            .iter_mut()
            .find(|record| record.gid == gid)
            .ok_or("Download was not found.")?;
        if !matches!(record.status.as_str(), "active" | "waiting" | "paused") {
            return Err("Only active downloads can be paused or resumed.".into());
        }
        record.status = if paused { "paused" } else { "active" }.into();
        record.download_speed = 0;
        if let Some(control) = inner.jobs.get(gid) {
            control.paused.store(paused, Ordering::Relaxed);
        }
        save_history(&inner, app)
    }

    fn cancel(&self, app: &AppHandle, gid: &str) -> Result<(), String> {
        let model_path = {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            load_history(&mut inner, app)?;
            let index = inner
                .records
                .iter()
                .position(|record| record.gid == gid)
                .ok_or("Download was not found.")?;
            if inner.records[index].status == "complete" {
                return Err("Completed models cannot be cancelled.".into());
            }
            if let Some(control) = inner.jobs.get(gid) {
                control.cancelled.store(true, Ordering::Relaxed);
                control.paused.store(false, Ordering::Relaxed);
            }
            let path = inner.records.remove(index).model_path;
            save_history(&inner, app)?;
            path
        };
        cleanup_files(Path::new(&model_path));
        Ok(())
    }

    fn clear_history(&self, app: &AppHandle, gid: Option<&str>) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        load_history(&mut inner, app)?;
        remove_history_records(&mut inner.records, gid);
        save_history(&inner, app)
    }
}

fn remove_history_records(records: &mut Vec<DownloadRecord>, gid: Option<&str>) {
    records.retain(|record| {
        gid.is_some_and(|gid| record.gid != gid)
            || !matches!(record.status.as_str(), "complete" | "error" | "removed")
    });
}

#[tauri::command]
pub async fn list(
    app_handle: AppHandle,
    manager: State<'_, DownloadManager>,
) -> Result<Vec<DownloadRecord>, String> {
    let manager = (*manager).clone();
    tauri::async_runtime::spawn_blocking(move || manager.refresh(&app_handle))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn pause(
    app_handle: AppHandle,
    manager: State<'_, DownloadManager>,
    gid: String,
) -> Result<(), String> {
    let manager = (*manager).clone();
    tauri::async_runtime::spawn_blocking(move || manager.change_status(&app_handle, &gid, true))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn resume(
    app_handle: AppHandle,
    manager: State<'_, DownloadManager>,
    gid: String,
) -> Result<(), String> {
    let manager = (*manager).clone();
    tauri::async_runtime::spawn_blocking(move || manager.change_status(&app_handle, &gid, false))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cancel(
    app_handle: AppHandle,
    manager: State<'_, DownloadManager>,
    gid: String,
) -> Result<(), String> {
    let manager = (*manager).clone();
    tauri::async_runtime::spawn_blocking(move || manager.cancel(&app_handle, &gid))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn clear_history(
    app_handle: AppHandle,
    manager: State<'_, DownloadManager>,
    gid: Option<String>,
) -> Result<(), String> {
    let manager = (*manager).clone();
    tauri::async_runtime::spawn_blocking(move || manager.clear_history(&app_handle, gid.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{cleanup_files, content_range_total};
    use std::fs;

    #[test]
    fn parses_range_total() {
        assert_eq!(content_range_total("bytes 10-19/100"), Some(100));
        assert_eq!(content_range_total("invalid"), None);
    }

    #[test]
    fn history_removal_targets_one_finished_item_and_preserves_active_downloads() {
        let mut records: Vec<super::DownloadRecord> = ["complete", "error", "removed", "active", "waiting", "paused"].into_iter().map(|status| {
            serde_json::from_value(serde_json::json!({"gid": status, "status": status, "versionId": 1, "name": "model", "fileName": "model.safetensors", "modelType": "LORA", "baseModel": "Anima", "modelPath": "model.safetensors", "completedLength": 0, "totalLength": 0, "downloadSpeed": 0, "createdAt": 0})).unwrap()
        }).collect();
        super::remove_history_records(&mut records, Some("error"));
        assert_eq!(records.len(), 5);
        assert!(serde_json::to_value(&records[0])
            .unwrap()
            .get("_url")
            .is_none());
        for gid in ["active", "waiting", "paused", "missing"] {
            super::remove_history_records(&mut records, Some(gid));
            assert_eq!(records.len(), 5);
        }
        super::remove_history_records(&mut records, None);
        assert_eq!(
            records
                .iter()
                .map(|record| record.gid.as_str())
                .collect::<Vec<_>>(),
            ["active", "waiting", "paused"]
        );
    }

    #[test]
    fn cleanup_removes_partial_download_and_sidecars() {
        let directory =
            std::env::temp_dir().join(format!("koharu-download-cleanup-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let model = directory.join("model.safetensors");
        for path in [
            model.clone(),
            directory.join("model.safetensors.part"),
            directory.join("model.civitai.info"),
            directory.join("model.cm-info.json"),
            directory.join("model.preview.jpg"),
        ] {
            fs::write(path, []).unwrap();
        }
        cleanup_files(&model);
        assert!(fs::read_dir(&directory).unwrap().next().is_none());
        fs::remove_dir(directory).unwrap();
    }
}
