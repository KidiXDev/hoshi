use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn wildcards_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("wildcards");

    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn wildcard_name(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?.with_extension("");
    Some(relative.to_string_lossy().replace('\\', "/").to_lowercase())
}

fn collect_wildcards(root: &Path, dir: &Path, wildcards: &mut HashMap<String, Vec<String>>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for path in entries.flatten().map(|entry| entry.path()) {
        if path.is_dir() {
            collect_wildcards(root, &path, wildcards);
            continue;
        }
        let is_text = path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("txt"));
        let (true, Some(name), Ok(text)) =
            (is_text, wildcard_name(root, &path), fs::read_to_string(&path))
        else {
            continue;
        };
        let options: Vec<String> = text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect();
        if !options.is_empty() {
            wildcards.insert(name, options);
        }
    }
}

#[tauri::command(async)]
pub fn load_wildcards(app_handle: AppHandle) -> Result<HashMap<String, Vec<String>>, String> {
    let dir = wildcards_dir(&app_handle)?;
    let mut wildcards = HashMap::new();
    collect_wildcards(&dir, &dir, &mut wildcards);
    Ok(wildcards)
}

#[tauri::command(async)]
pub fn open_wildcards_folder(app_handle: AppHandle) -> Result<(), String> {
    let dir = wildcards_dir(&app_handle)?;
    crate::show_in_folder(dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_nested_text_files_as_lowercase_names() {
        let root = std::env::temp_dir().join(format!("koharu-wildcards-{}", std::process::id()));
        fs::create_dir_all(root.join("Clothing")).unwrap();
        fs::write(root.join("Clothing").join("Dress.txt"), "red dress\n\n  blue dress \n").unwrap();
        fs::write(root.join("empty.txt"), "\n").unwrap();
        fs::write(root.join("notes.md"), "ignored").unwrap();

        let mut wildcards = HashMap::new();
        collect_wildcards(&root, &root, &mut wildcards);
        fs::remove_dir_all(&root).unwrap();

        assert_eq!(
            wildcards,
            HashMap::from([(
                "clothing/dress".to_string(),
                vec!["red dress".to_string(), "blue dress".to_string()]
            )])
        );
    }
}
