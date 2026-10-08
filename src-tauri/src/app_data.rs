use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const LEGACY_KEY: &[u8] = b"koharu";
const PROTECTED_MAGIC: &[u8] = b"KHR1";
static APP_DATA_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temporary, path).map_err(|e| e.to_string())
}

fn legacy_xor(bytes: &[u8]) -> Vec<u8> {
    bytes
        .iter()
        .enumerate()
        .map(|(i, byte)| byte ^ LEGACY_KEY[i % LEGACY_KEY.len()])
        .collect()
}

#[cfg(windows)]
fn dpapi(input: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        if protect {
            CryptProtectData(
                &input,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|e| e.to_string())?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(bytes)
    }
}

#[cfg(windows)]
fn encode(plain: &str) -> Result<Vec<u8>, String> {
    Ok([PROTECTED_MAGIC, &dpapi(plain.as_bytes(), true)?].concat())
}

#[cfg(not(windows))]
fn encode(plain: &str) -> Result<Vec<u8>, String> {
    Ok(legacy_xor(plain.as_bytes()))
}

fn decode(data: &[u8]) -> Result<String, String> {
    let plain = match data.strip_prefix(PROTECTED_MAGIC) {
        #[cfg(windows)]
        Some(protected) => dpapi(protected, false)?,
        #[cfg(not(windows))]
        Some(_) => return Err("App data was encrypted on another platform".into()),
        None => legacy_xor(data),
    };
    String::from_utf8(plain).map_err(|e| e.to_string())
}

fn app_data_path(app_handle: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Invalid app data name".into());
    }
    Ok(app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(format!("{name}.dat")))
}

fn read_object(app_handle: &AppHandle, name: &str) -> Result<serde_json::Value, String> {
    let path = app_data_path(app_handle, name)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let raw = decode(&fs::read(path).map_err(|e| e.to_string())?)?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_object(
    app_handle: &AppHandle,
    name: &str,
    data: &serde_json::Value,
) -> Result<(), String> {
    let path = app_data_path(app_handle, name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string(data).map_err(|e| e.to_string())?;
    write_atomic(&path, &encode(&raw)?)
}

fn with_lock<T>(task: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = APP_DATA_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    task()
}

fn update_entry(
    app_handle: &AppHandle,
    name: &str,
    update: impl FnOnce(&mut serde_json::Map<String, serde_json::Value>),
) -> Result<(), String> {
    with_lock(|| {
        let mut data = read_object(app_handle, name)?;
        update(
            data.as_object_mut()
                .ok_or_else(|| format!("{name}.dat root must be an object"))?,
        );
        write_object(app_handle, name, &data)
    })
}

pub(crate) fn load_app_data_entry(
    app_handle: &AppHandle,
    name: &str,
    key: &str,
) -> Result<Option<serde_json::Value>, String> {
    with_lock(|| Ok(read_object(app_handle, name)?.get(key).cloned()))
}

pub(crate) fn save_app_data_entry(
    app_handle: &AppHandle,
    name: &str,
    key: &str,
    value: serde_json::Value,
) -> Result<(), String> {
    update_entry(app_handle, name, |object| {
        object.insert(key.to_string(), value);
    })
}

#[tauri::command(async)]
pub fn get_app_data_entry(
    app_handle: AppHandle,
    name: String,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    load_app_data_entry(&app_handle, &name, &key)
}

#[tauri::command(async)]
pub fn set_app_data_entry(
    app_handle: AppHandle,
    name: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    save_app_data_entry(&app_handle, &name, &key, value)
}

#[tauri::command(async)]
pub fn remove_app_data_entry(
    app_handle: AppHandle,
    name: String,
    key: String,
) -> Result<(), String> {
    update_entry(&app_handle, &name, |object| {
        object.remove(&key);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_legacy_files_and_round_trips_new_ones() {
        let legacy = legacy_xor(br#"{"a":1}"#);
        assert_eq!(decode(&legacy).unwrap(), r#"{"a":1}"#);
        let encoded = encode(r#"{"b":2}"#).unwrap();
        assert_eq!(decode(&encoded).unwrap(), r#"{"b":2}"#);
        #[cfg(windows)]
        assert!(encoded.starts_with(PROTECTED_MAGIC));
    }

    #[test]
    fn writes_atomically() {
        let path = std::env::temp_dir().join(format!("koharu-atomic-{}.dat", std::process::id()));
        write_atomic(&path, b"first").unwrap();
        write_atomic(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert!(!path.with_extension("tmp").exists());
        fs::remove_file(path).unwrap();
    }
}
