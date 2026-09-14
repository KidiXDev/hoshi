use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeOut<'a> {
    cached_at: u64,
    expires_at: u64,
    data: &'a Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeIn {
    expires_at: u64,
    data: Value,
}

/// Header-only view: serde skips `data` without building a `Value` tree.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expiry {
    expires_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetworkCacheStats {
    pub total_entries: u32,
    pub total_size_bytes: u64,
}

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn cache_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let base = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    Ok(base.join("network_cache"))
}

fn entry_path(root: &Path, namespace: &str, key: &str) -> PathBuf {
    let digest = format!("{:x}", Sha256::digest(key.as_bytes()));
    root.join(namespace).join(format!("{digest}.json"))
}

fn read_at(root: &Path, namespace: &str, key: &str) -> Option<Value> {
    let path = entry_path(root, namespace, key);
    let contents = fs::read(&path).ok()?;
    let envelope: EnvelopeIn = serde_json::from_slice(&contents).ok()?;
    if now_ms() < envelope.expires_at {
        Some(envelope.data)
    } else {
        let _ = fs::remove_file(path);
        None
    }
}

fn write_at(
    root: &Path,
    namespace: &str,
    key: &str,
    data: &Value,
    ttl_seconds: u64,
) -> Result<(), String> {
    let path = entry_path(root, namespace, key);
    let dir = path.parent().ok_or("invalid cache path")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let cached_at = now_ms();
    let envelope = EnvelopeOut {
        cached_at,
        expires_at: cached_at.saturating_add(ttl_seconds.saturating_mul(1000)),
        data,
    };
    let serialized = serde_json::to_vec(&envelope).map_err(|e| e.to_string())?;
    // Unique tmp + rename so concurrent readers/writers never observe a torn file.
    let tmp = path.with_extension(format!("{}.tmp", TMP_SEQ.fetch_add(1, Ordering::Relaxed)));
    fs::write(&tmp, serialized).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Deletes every expired or unreadable entry under `root`. Returns the number removed.
fn prune_expired_at(root: &Path) -> usize {
    let now = now_ms();
    let mut removed = 0;
    for namespace in fs::read_dir(root).into_iter().flatten().flatten() {
        for entry in fs::read_dir(namespace.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue; // never touch in-flight .tmp files
            }
            let live = fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Expiry>(&bytes).ok())
                .is_some_and(|expiry| now < expiry.expires_at);
            if !live && fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

pub fn read_cache(app_handle: &AppHandle, namespace: &str, key: &str) -> Option<Value> {
    read_at(&cache_root(app_handle).ok()?, namespace, key)
}

pub fn write_cache(
    app_handle: &AppHandle,
    namespace: &str,
    key: &str,
    data: &Value,
    ttl_seconds: u64,
) -> Result<(), String> {
    write_at(&cache_root(app_handle)?, namespace, key, data, ttl_seconds)
}

/// Sweeps expired entries in the background; call once at startup.
pub fn prune_expired_in_background(app_handle: &AppHandle) {
    if let Ok(root) = cache_root(app_handle) {
        std::thread::spawn(move || {
            prune_expired_at(&root);
        });
    }
}

/// Removes cached network files for a given namespace or the entire network_cache.
#[tauri::command]
pub async fn clear_network_cache(
    app_handle: AppHandle,
    namespace: Option<String>,
) -> Result<(), String> {
    clear_network_cache_sync(&app_handle, namespace.as_deref())
}

pub(crate) fn clear_network_cache_sync(
    app_handle: &AppHandle,
    namespace: Option<&str>,
) -> Result<(), String> {
    let root = cache_root(app_handle)?;
    let target = match namespace {
        Some(ns) => root.join(ns),
        None => root,
    };

    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_network_cache_stats(app_handle: AppHandle) -> Result<NetworkCacheStats, String> {
    let root = cache_root(&app_handle)?;
    let mut stats = NetworkCacheStats {
        total_entries: 0,
        total_size_bytes: 0,
    };
    for namespace in fs::read_dir(&root).into_iter().flatten().flatten() {
        for entry in fs::read_dir(namespace.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            if entry.path().extension().and_then(|s| s.to_str()) == Some("json") {
                stats.total_entries += 1;
                stats.total_size_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::{entry_path, prune_expired_at, read_at, write_at};
    use serde_json::json;

    #[test]
    fn round_trips_expires_and_prunes() {
        let root = std::env::temp_dir().join(format!("koharu-nc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);

        write_at(&root, "ns", "live", &json!({"a": 1}), 60).unwrap();
        write_at(&root, "ns", "dead", &json!({"b": 2}), 0).unwrap();
        std::fs::write(root.join("ns").join("junk.json"), b"not json").unwrap();

        assert_eq!(read_at(&root, "ns", "live"), Some(json!({"a": 1})));
        assert_eq!(read_at(&root, "ns", "dead"), None); // expired: removed on read
        assert!(!entry_path(&root, "ns", "dead").exists());

        write_at(&root, "ns", "dead", &json!({"b": 2}), 0).unwrap();
        assert_eq!(prune_expired_at(&root), 2); // expired + junk
        assert!(entry_path(&root, "ns", "live").exists());
        assert!(!root.join("ns").join("junk.json").exists());
        assert!(std::fs::read_dir(root.join("ns")).unwrap().all(|e| !e
            .unwrap()
            .path()
            .to_string_lossy()
            .ends_with(".tmp")));

        let _ = std::fs::remove_dir_all(&root);
    }
}
