use std::fs;
use std::path::PathBuf;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

const MAX_TAG_DATA_BYTES: u64 = 32 * 1024 * 1024;

fn tags_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("tags");

    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

#[tauri::command(async)]
pub fn load_tag_autocomplete_data(app_handle: AppHandle) -> Result<Response, String> {
    let dir = tags_dir(&app_handle)?;
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"))
        })
        .collect();
    files.sort();

    let mut data = Vec::new();
    for path in files {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        if data.len() as u64 + bytes.len() as u64 > MAX_TAG_DATA_BYTES {
            return Err(format!(
                "Tag CSVs exceed {} MiB",
                MAX_TAG_DATA_BYTES / 1024 / 1024
            ));
        }
        data.extend_from_slice(&bytes);
        data.push(b'\n');
    }
    Ok(Response::new(data))
}

#[tauri::command(async)]
pub fn open_tag_autocomplete_folder(app_handle: AppHandle) -> Result<(), String> {
    let dir = tags_dir(&app_handle)?;
    crate::show_in_folder(dir.to_string_lossy().to_string())
}
