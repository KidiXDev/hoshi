use std::fs;
use std::path::PathBuf;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

const WORD_LIST_FILES: [&str; 2] = ["large_en.msgpack.gz", "small_en.msgpack.gz"];
const MAX_WORD_LIST_BYTES: u64 = 32 * 1024 * 1024;

fn word_frequency_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("wordfreq");

    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

#[tauri::command(async)]
pub fn load_word_frequency_data(app_handle: AppHandle) -> Result<Response, String> {
    let dir = word_frequency_dir(&app_handle)?;
    let path = WORD_LIST_FILES
        .iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
        .ok_or_else(|| "No word list found".to_string())?;

    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_WORD_LIST_BYTES {
        return Err(format!("Word list is too large ({size} bytes)"));
    }

    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command(async)]
pub fn open_word_frequency_folder(app_handle: AppHandle) -> Result<(), String> {
    let dir = word_frequency_dir(&app_handle)?;
    crate::show_in_folder(dir.to_string_lossy().to_string())
}
