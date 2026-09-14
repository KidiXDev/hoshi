use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PresetItem {
    pub id: String,
    pub filename: String,
    pub category: String,
    pub content: String,
    pub updated_at: u64,
}

fn presets_dir(app_handle: &AppHandle, category: &str) -> Result<PathBuf, String> {
    let sanitized_cat = category.replace(['/', '\\', '.', ':', '*'], "_");
    let dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("presets")
        .join(sanitized_cat);

    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "preset".to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub fn list_preset_files(
    app_handle: AppHandle,
    category: String,
) -> Result<Vec<PresetItem>, String> {
    let dir = presets_dir(&app_handle, &category)?;
    let mut items = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
                let filename = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if let Ok(content) = fs::read_to_string(&path) {
                    let updated_at = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);

                    items.push(PresetItem {
                        id: filename.clone(),
                        filename,
                        category: category.clone(),
                        content,
                        updated_at,
                    });
                }
            }
        }
    }

    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[tauri::command]
pub fn save_preset_file(
    app_handle: AppHandle,
    category: String,
    name: String,
    content: String,
) -> Result<String, String> {
    let dir = presets_dir(&app_handle, &category)?;
    let safe_name = sanitize_filename(&name);
    let path = dir.join(format!("{safe_name}.json"));
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(safe_name)
}

#[tauri::command]
pub fn delete_preset_file(
    app_handle: AppHandle,
    category: String,
    filename: String,
) -> Result<(), String> {
    let dir = presets_dir(&app_handle, &category)?;
    let safe_name = sanitize_filename(&filename);
    let path = dir.join(format!("{safe_name}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_presets_folder(app_handle: AppHandle, category: String) -> Result<(), String> {
    let dir = presets_dir(&app_handle, &category)?;
    crate::show_in_folder(dir.to_string_lossy().to_string())
}
