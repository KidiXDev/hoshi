use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::{AppHandle, State};

use crate::comfy_paths::{clean_path, comfy_root};
use crate::process_manager::{
    emit_sys_log, hide_command_window, spawn_stream_reader, ProcessManager,
};
use crate::python;

#[tauri::command]
pub async fn check_comfyui_update(
    working_dir: String,
    python_path: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = comfy_root(&working_dir)?;
        let python = python::resolve_executable(&python_path, Path::new(clean_path(&working_dir)))?;
        python::run_json(
            &python,
            &root,
            python::COMFY_UPDATE_CHECK,
            &[root.as_os_str()],
        )
        .map_err(|error| format!("Update check failed: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn update_comfyui(
    app_handle: AppHandle,
    state: State<'_, ProcessManager>,
    working_dir: String,
    python_path: String,
) -> Result<(), String> {
    if state.is_running() {
        return Err("Stop ComfyUI before updating it.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        update_portable(&app_handle, &working_dir, &python_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn update_portable(
    app_handle: &AppHandle,
    working_dir: &str,
    python_path: &str,
) -> Result<(), String> {
    let comfy_dir = comfy_root(working_dir)?;
    let update_dir = comfy_dir
        .parent()
        .map(|portable| portable.join("update"))
        .filter(|dir| dir.join("update.py").is_file())
        .ok_or(
            "update/update.py was not found next to the ComfyUI folder. Updating is supported for the Windows portable build.",
        )?;
    let python = python::resolve_executable(python_path, Path::new(clean_path(working_dir)))?;

    emit_sys_log(
        app_handle,
        format!("Updating ComfyUI in {}", comfy_dir.display()),
    );
    run_updater(app_handle, &python, &update_dir, &comfy_dir, false)?;

    let new_updater = update_dir.join("update_new.py");
    if new_updater.is_file() {
        fs::rename(&new_updater, update_dir.join("update.py"))
            .map_err(|error| error.to_string())?;
        emit_sys_log(
            app_handle,
            "Running updater again since it got updated.".into(),
        );
        run_updater(app_handle, &python, &update_dir, &comfy_dir, true)?;
    }
    Ok(())
}

fn run_updater(
    app_handle: &AppHandle,
    python: &Path,
    update_dir: &Path,
    comfy_dir: &Path,
    skip_self_update: bool,
) -> Result<(), String> {
    let mut command = Command::new(python);
    command
        .current_dir(update_dir)
        .arg("update.py")
        .arg(comfy_dir)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if skip_self_update {
        command.arg("--skip_self_update");
    }
    hide_command_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start the ComfyUI updater: {error}"))?;
    let readers = [
        child
            .stdout
            .take()
            .map(|out| spawn_stream_reader(out, app_handle.clone(), "stdout")),
        child
            .stderr
            .take()
            .map(|err| spawn_stream_reader(err, app_handle.clone(), "stderr")),
    ];
    let status = child.wait().map_err(|error| error.to_string())?;
    for reader in readers.into_iter().flatten() {
        let _ = reader.join();
    }
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "ComfyUI update failed (exit code {}). See the server terminal for details.",
            status
                .code()
                .map_or("unknown".into(), |code| code.to_string())
        ))
    }
}
