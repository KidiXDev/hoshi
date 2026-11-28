use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::comfy_paths::clean_path;
use crate::process_manager::{emit_log, emit_sys_log, hide_command_window, kill_process_tree};
use crate::python;

const FIELD_RULES: &str = "field_rules.jsonc";
const BUILD_SETTINGS: &str = "build_settings.jsonc";
const DEFAULT_CONFIG: [(&str, &str); 2] = [
    (FIELD_RULES, include_str!("field_rules.jsonc")),
    (BUILD_SETTINGS, include_str!("build_settings.jsonc")),
];
const DATA: &str = "data";
const STAGING: &str = "data.new";
const PREVIOUS: &str = "data.old";
const BUILD_SCRIPT: &str = "build_db.py";
const WORK_FOLDER: &str = "character-helper-build";
const FIELD_REPORT: &str = "field_report.txt";
const POLL_INTERVAL: Duration = Duration::from_millis(500);
const PROGRESS_EVENT: &str = "character-data-progress";
const WARNING_EVENT: &str = "character-data-warning";
const ALREADY_RUNNING: &str = "A dataset rebuild is already running.";
const STOPPED: &str = "Build stopped. The downloaded files are kept, so the next build continues from them. Use Delete downloads to free the space.";

static REBUILD: Mutex<Option<Child>> = Mutex::new(None);

fn running() -> MutexGuard<'static, Option<Child>> {
    REBUILD.lock().unwrap_or_else(PoisonError::into_inner)
}

// Paths
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("character_helper"))
}

pub(super) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join(DATA))
}

fn default_download_dir() -> PathBuf {
    std::env::temp_dir()
}

fn write_config(dir: &Path, overwrite: bool) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for (name, text) in DEFAULT_CONFIG {
        let path = dir.join(name);
        if overwrite || !path.exists() {
            fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
        }
    }
    Ok(())
}

pub(crate) fn ensure_config(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = root(app)?;
    write_config(&dir, false)?;
    Ok(dir)
}

fn work_dir(download_dir: &str, root: &Path) -> Result<PathBuf, String> {
    let download = match clean_path(download_dir) {
        "" => default_download_dir(),
        dir => PathBuf::from(dir),
    };
    if !download.is_absolute() {
        return Err(format!(
            "Use a full path for the download folder, like D:\\Temp (got \"{}\").",
            download.display()
        ));
    }
    if [DATA, STAGING, PREVIOUS]
        .iter()
        .any(|managed| download.starts_with(root.join(managed)))
    {
        return Err(format!(
            "Pick a download folder outside {}: that folder holds the built dataset.",
            root.join(DATA).display()
        ));
    }
    Ok(download.join(WORK_FOLDER))
}

fn remove_work_dir(work: &Path) -> Result<(), String> {
    match fs::remove_dir_all(work) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(format!(
            "Could not delete {}: {error}. Delete it by hand.",
            work.display()
        )),
        _ => Ok(()),
    }
}

// Script output
#[derive(Debug, PartialEq)]
enum Line {
    Progress(Value),
    Warning(String),
    Error(String),
    Summary(Value),
    Log(String),
}

fn parse_line(line: &str) -> Line {
    let tagged = |tag: &str| {
        line.strip_prefix(tag)
            .and_then(|json| serde_json::from_str(json).ok())
    };
    if let Some(value) = tagged("@@progress ") {
        return Line::Progress(value);
    }
    if let Some(Value::String(message)) = tagged("@@warning ") {
        return Line::Warning(message);
    }
    if let Some(Value::String(message)) = tagged("@@error ") {
        return Line::Error(message);
    }
    if let Some(value) = tagged("@@summary ") {
        return Line::Summary(value);
    }
    Line::Log(line.to_string())
}

#[derive(Default)]
struct Report {
    error: Option<String>,
    summary: Option<Value>,
    last_stderr: Option<String>,
}

fn forward_output<R: Read + Send + 'static>(
    reader: R,
    app: AppHandle,
    stream: &'static str,
    report: Arc<Mutex<Report>>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        for bytes in BufReader::new(reader).split(b'\n').map_while(Result::ok) {
            let text = String::from_utf8_lossy(&bytes);
            let line = text.trim_end();
            if line.is_empty() {
                continue;
            }
            let mut report = report.lock().unwrap_or_else(PoisonError::into_inner);
            match parse_line(line) {
                Line::Progress(value) => {
                    let _ = app.emit(PROGRESS_EVENT, value);
                }
                Line::Warning(message) => {
                    let _ = app.emit(WARNING_EVENT, message);
                }
                Line::Error(message) => {
                    emit_log(&app, "stderr", message.clone());
                    report.error = Some(message);
                }
                Line::Summary(value) => report.summary = Some(value),
                Line::Log(message) => {
                    if stream == "stderr" {
                        report.last_stderr = Some(message.clone());
                    }
                    emit_log(&app, stream, message);
                }
            }
        }
    })
}

fn failure_message(report: Report, status: ExitStatus) -> String {
    if let Some(error) = report.error {
        return error;
    }
    match report.last_stderr {
        Some(line) => {
            format!("The rebuild failed: {line}. See the server terminal for the full log.")
        }
        None => format!(
            "The rebuild failed (exit code {}). See the server terminal for the full log.",
            status.code().map_or("unknown".into(), |c| c.to_string())
        ),
    }
}

// Rebuild process
fn run_tracked(app: &AppHandle, mut command: Command, python: &Path) -> Result<Value, String> {
    let report = Arc::new(Mutex::new(Report::default()));
    let mut slot = running();
    if slot.is_some() {
        return Err(ALREADY_RUNNING.into());
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start Python at {}: {e}", python.display()))?;
    let readers = [
        child
            .stdout
            .take()
            .map(|out| forward_output(out, app.clone(), "stdout", report.clone())),
        child
            .stderr
            .take()
            .map(|err| forward_output(err, app.clone(), "stderr", report.clone())),
    ];
    *slot = Some(child);
    drop(slot);

    let outcome = loop {
        let mut slot = running();
        let Some(child) = slot.as_mut() else {
            break Err(STOPPED.to_string());
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                slot.take();
                break Ok(status);
            }
            Ok(None) => {}
            Err(error) => {
                slot.take();
                break Err(format!("Lost track of the rebuild process: {error}"));
            }
        }
        drop(slot);
        thread::sleep(POLL_INTERVAL);
    };
    for reader in readers.into_iter().flatten() {
        let _ = reader.join();
    }
    let status = outcome?;
    let report = std::mem::take(&mut *report.lock().unwrap_or_else(PoisonError::into_inner));
    if !status.success() {
        return Err(failure_message(report, status));
    }
    Ok(report.summary.unwrap_or(Value::Null))
}

fn install(staging: &Path, target: &Path, previous: &Path) -> Result<(), String> {
    super::validate(staging).map_err(|e| {
        format!("The rebuilt files could not be read ({e}). The previous dataset is still in use.")
    })?;
    if previous.exists() {
        fs::remove_dir_all(previous).map_err(|e| e.to_string())?;
    }
    if target.exists() {
        fs::rename(target, previous).map_err(|e| {
            format!(
                "Could not replace {}: {e}. Close anything using it and rebuild.",
                target.display()
            )
        })?;
    }
    if let Err(error) = fs::rename(staging, target) {
        let _ = fs::rename(previous, target);
        return Err(format!("Could not install the rebuilt dataset: {error}"));
    }
    let _ = fs::remove_dir_all(previous);
    Ok(())
}

fn rebuild(
    app: &AppHandle,
    working_dir: &str,
    python_path: &str,
    download_dir: &str,
) -> Result<Value, String> {
    if running().is_some() {
        return Err(ALREADY_RUNNING.into());
    }
    let python = python::resolve_executable(python_path, Path::new(clean_path(working_dir)))?;
    let config = ensure_config(app)?;
    let dataset = work_dir(download_dir, &config)?;
    fs::create_dir_all(&dataset).map_err(|e| {
        format!(
            "Could not create the download folder {}: {e}",
            dataset.display()
        )
    })?;
    let script = dataset.join(BUILD_SCRIPT);
    fs::write(&script, python::CHARACTER_DB_BUILD).map_err(|e| {
        format!(
            "Could not write to the download folder {}: {e}",
            dataset.display()
        )
    })?;
    let staging = config.join(STAGING);
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }

    emit_sys_log(
        app,
        format!(
            "Rebuilding the Character Helper dataset in {}",
            dataset.display()
        ),
    );
    let mut command = Command::new(&python);
    command
        .current_dir(&dataset)
        .arg("-s")
        .arg(&script)
        .arg("--work")
        .arg(&dataset)
        .arg("--out")
        .arg(&staging)
        .arg("--rules")
        .arg(config.join(FIELD_RULES))
        .arg("--settings")
        .arg(config.join(BUILD_SETTINGS))
        .arg("--report")
        .arg(config.join(FIELD_REPORT))
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_command_window(&mut command);

    let result = run_tracked(app, command, &python).and_then(|summary| {
        install(&staging, &config.join(DATA), &config.join(PREVIOUS))?;
        Ok(summary)
    });
    let _ = fs::remove_dir_all(&staging);
    let mut summary = match result {
        Ok(summary) => summary,
        Err(error) => {
            emit_log(app, "stderr", format!("Character Helper rebuild: {error}"));
            return Err(error);
        }
    };
    super::reset();
    emit_sys_log(app, "Character Helper dataset rebuilt.".into());
    match remove_work_dir(&dataset) {
        Ok(()) => emit_sys_log(
            app,
            format!("Deleted the downloads in {}", dataset.display()),
        ),
        Err(error) => {
            emit_log(app, "stderr", error.clone());
            if let Value::Object(fields) = &mut summary {
                fields.insert("cleanupError".into(), Value::String(error));
            }
        }
    }
    Ok(summary)
}

pub(crate) fn stop() {
    if let Some(mut child) = running().take() {
        let _ = kill_process_tree(&mut child);
        let _ = child.wait();
    }
}

// Commands
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetStatus {
    installed: bool,
    built: Option<String>,
    load_error: Option<String>,
    config_dir: String,
    default_download_dir: String,
    rebuilding: bool,
}

#[tauri::command(async)]
pub fn character_data_status(app: AppHandle) -> Result<DatasetStatus, String> {
    let rebuilding = running().is_some();
    let installed = super::installed_dir(&app)?.is_some();
    let loaded = (installed && !rebuilding).then(|| super::db(&app));
    Ok(DatasetStatus {
        installed,
        built: loaded
            .as_ref()
            .and_then(|db| db.as_ref().ok()?.built().map(str::to_string)),
        load_error: loaded.and_then(Result::err),
        config_dir: ensure_config(&app)?.to_string_lossy().into_owned(),
        default_download_dir: default_download_dir().to_string_lossy().into_owned(),
        rebuilding,
    })
}

#[tauri::command(async)]
pub fn character_data_reset_config(app: AppHandle) -> Result<(), String> {
    write_config(&root(&app)?, true)
}

#[tauri::command(async)]
pub fn character_data_clear_downloads(app: AppHandle, download_dir: String) -> Result<(), String> {
    if running().is_some() {
        return Err("Stop the rebuild before deleting its downloads.".into());
    }
    remove_work_dir(&work_dir(&download_dir, &root(&app)?)?)
}

#[tauri::command(async)]
pub fn character_data_rebuild(
    app: AppHandle,
    working_dir: String,
    python_path: String,
    download_dir: String,
) -> Result<Value, String> {
    rebuild(&app, &working_dir, &python_path, &download_dir)
}

#[tauri::command(async)]
pub fn character_data_cancel_rebuild() -> Result<(), String> {
    let Some(mut child) = running().take() else {
        return Ok(());
    };
    kill_process_tree(&mut child).map_err(|e| format!("Could not stop the rebuild: {e}"))?;
    let _ = child.wait();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_config_keeps_user_edits_unless_overwriting() {
        let dir =
            std::env::temp_dir().join(format!("koharu-character-config-{}", std::process::id()));
        write_config(&dir, false).unwrap();
        fs::write(dir.join(FIELD_RULES), "{}").unwrap();

        write_config(&dir, false).unwrap();
        assert_eq!(fs::read_to_string(dir.join(FIELD_RULES)).unwrap(), "{}");

        write_config(&dir, true).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join(FIELD_RULES)).unwrap(),
            DEFAULT_CONFIG[0].1
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn default_config_is_valid_jsonc() {
        for (name, text) in DEFAULT_CONFIG {
            let json: String = text
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            serde_json::from_str::<Value>(&json).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(text.lines().any(|line| line.trim_start().starts_with("//")));
        }
    }

    #[test]
    fn parse_line_splits_tagged_output_from_logs() {
        assert_eq!(
            parse_line(r#"@@progress {"step":2,"label":"Downloading"}"#),
            Line::Progress(serde_json::json!({"step": 2, "label": "Downloading"}))
        );
        assert_eq!(
            parse_line(r#"@@error "Disk full""#),
            Line::Error("Disk full".into())
        );
        assert_eq!(
            parse_line(r#"@@warning "Low RAM""#),
            Line::Warning("Low RAM".into())
        );
        assert_eq!(
            parse_line("@@progress not json"),
            Line::Log("@@progress not json".into())
        );
        assert_eq!(
            parse_line("12:00:00 scan done"),
            Line::Log("12:00:00 scan done".into())
        );
    }

    #[test]
    fn work_dir_is_a_subfolder_of_the_download_folder() {
        let root = std::env::temp_dir().join("koharu-character-root");
        assert_eq!(
            work_dir(" ", &root).unwrap(),
            default_download_dir().join(WORK_FOLDER)
        );
        let elsewhere = std::env::temp_dir().join("koharu-danbooru");
        assert_eq!(
            work_dir(elsewhere.to_str().unwrap(), &root).unwrap(),
            elsewhere.join(WORK_FOLDER)
        );
    }

    #[test]
    fn work_dir_rejects_relative_and_dataset_folders() {
        let root = std::env::temp_dir().join("koharu-character-root");
        assert!(work_dir("relative/folder", &root).is_err());
        let inside_data = root.join(DATA).join("downloads");
        assert!(work_dir(inside_data.to_str().unwrap(), &root).is_err());
    }

    #[test]
    fn remove_work_dir_ignores_a_missing_folder() {
        let work = std::env::temp_dir().join(format!("koharu-missing-{}", std::process::id()));
        assert!(remove_work_dir(&work).is_ok());
        fs::create_dir_all(work.join("python-packages")).unwrap();
        remove_work_dir(&work).unwrap();
        assert!(!work.exists());
    }

    #[test]
    fn install_keeps_previous_dataset_when_new_files_are_broken() {
        let root =
            std::env::temp_dir().join(format!("koharu-character-install-{}", std::process::id()));
        let (staging, target, previous) =
            (root.join(STAGING), root.join(DATA), root.join(PREVIOUS));
        fs::create_dir_all(&staging).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("marker"), "old").unwrap();

        let error = install(&staging, &target, &previous).unwrap_err();

        assert!(error.contains("previous dataset is still in use"));
        assert_eq!(fs::read_to_string(target.join("marker")).unwrap(), "old");
        fs::remove_dir_all(root).unwrap();
    }
}
