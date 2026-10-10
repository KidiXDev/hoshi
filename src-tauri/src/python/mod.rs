use serde_json::Value;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::comfy_paths::clean_path;
use crate::process_manager::hide_command_window;

pub(crate) const LOCAL_MODEL_DISCOVERY: &str = include_str!("local_model_discovery.py");
pub(crate) const COMFY_UPDATE_CHECK: &str = include_str!("comfy_update_check.py");

const INTERPRETER_NAMES: [&str; 5] = [
    "python.exe",
    "python",
    "bin/python3",
    "bin/python",
    "Scripts/python.exe",
];

fn interpreter_at(candidate: PathBuf) -> Option<PathBuf> {
    if candidate.is_file() {
        return Some(candidate);
    }
    INTERPRETER_NAMES
        .iter()
        .map(|name| candidate.join(name))
        .find(|path| path.is_file())
}

pub(crate) fn resolve_executable(configured: &str, base_dir: &Path) -> Result<PathBuf, String> {
    let configured = clean_path(configured);
    if configured.is_empty() {
        return Err(
            "Python path is not configured. Please select the Python folder or executable in Settings."
                .to_string(),
        );
    }

    let path = Path::new(configured);
    let mut candidates = vec![path.to_path_buf()];
    if path.is_relative() {
        candidates.extend(
            [Some(base_dir), base_dir.parent()]
                .into_iter()
                .flatten()
                .map(|base| base.join(path)),
        );
    }
    if let Some(found) = candidates.into_iter().find_map(interpreter_at) {
        return Ok(found);
    }

    if !configured.contains(['/', '\\']) {
        return Ok(PathBuf::from(configured));
    }

    Err(format!(
        "Python executable not found for '{configured}'. Please verify the Python path or folder in Settings."
    ))
}

pub(crate) fn run_json(
    python: &Path,
    current_dir: &Path,
    script: &str,
    args: &[&OsStr],
) -> Result<Value, String> {
    let mut command = Command::new(python);
    command
        .current_dir(current_dir)
        .args(["-s", "-c", script])
        .args(args)
        .env("PYTHONIOENCODING", "utf-8");
    hide_command_window(&mut command);
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr
            .trim()
            .lines()
            .last()
            .unwrap_or("Python script failed without an error message.")
            .to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolves_interpreters_from_files_folders_and_portable_layouts() {
        let portable = std::env::temp_dir().join(format!("koharu-python-{}", std::process::id()));
        let comfy = portable.join("ComfyUI");
        let embedded = portable.join("python_embeded");
        fs::create_dir_all(&comfy).unwrap();
        fs::create_dir_all(&embedded).unwrap();
        let interpreter = embedded.join("python.exe");
        fs::write(&interpreter, b"").unwrap();

        assert!(resolve_executable(" ", &comfy).is_err());
        assert_eq!(
            resolve_executable(interpreter.to_str().unwrap(), &comfy).unwrap(),
            interpreter
        );
        assert_eq!(
            resolve_executable(&format!("\"{}\"", embedded.display()), &comfy).unwrap(),
            interpreter
        );
        assert_eq!(
            resolve_executable("python_embeded", &comfy).unwrap(),
            portable.join("python_embeded").join("python.exe")
        );
        assert_eq!(
            resolve_executable("python3", &comfy).unwrap(),
            PathBuf::from("python3")
        );
        assert!(resolve_executable("missing/python.exe", &comfy).is_err());

        fs::remove_dir_all(portable).unwrap();
    }
}
