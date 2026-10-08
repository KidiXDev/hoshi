use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::comfy_paths::{clean_path, comfy_root};

const BRIDGE_NODE_INIT: &str = include_str!("../../comfyui-koharu-bridge/__init__.py");
const BRIDGE_WORKSPACE_JS: &str = include_str!("../../comfyui-koharu-bridge/web/workspace.js");
const BRIDGE_DIR_NAME: &str = "comfyui-koharu-bridge";
const LEGACY_BRIDGE_DIR_NAME: &str = "comfyui-comfygui-bridge";

#[derive(Clone, serde::Serialize)]
pub struct LogPayload {
    pub stream: String,
    pub message: String,
    pub timestamp: u64,
}

fn emit_sys_log(app_handle: &AppHandle, message: String) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let _ = app_handle.emit(
        "comfyui-log",
        LogPayload {
            stream: "system".to_string(),
            message,
            timestamp: now,
        },
    );
}

fn auto_inject_bridge_node(comfy_dir: &Path, app_handle: &AppHandle) {
    let custom_nodes_dir = comfy_dir.join("custom_nodes");
    if !custom_nodes_dir.exists() {
        if let Err(err) = fs::create_dir_all(&custom_nodes_dir) {
            emit_sys_log(
                app_handle,
                format!("Failed to create custom_nodes directory: {}", err),
            );
            return;
        }
    }

    let _ = fs::remove_dir_all(custom_nodes_dir.join(LEGACY_BRIDGE_DIR_NAME));
    let target_bridge_dir = custom_nodes_dir.join(BRIDGE_DIR_NAME);
    if let Err(err) = fs::create_dir_all(&target_bridge_dir) {
        emit_sys_log(
            app_handle,
            format!("Failed to create bridge node directory: {}", err),
        );
        return;
    }

    let target_init_py = target_bridge_dir.join("__init__.py");

    let web_dir = target_bridge_dir.join("web");
    if let Err(err) = fs::create_dir_all(&web_dir).and_then(|_| {
        let target = web_dir.join("workspace.js");
        if fs::read_to_string(&target).ok().as_deref() != Some(BRIDGE_WORKSPACE_JS) {
            fs::write(target, BRIDGE_WORKSPACE_JS)?;
        }
        Ok(())
    }) {
        emit_sys_log(
            app_handle,
            format!("Failed to inject ComfyUI workspace extension: {}", err),
        );
    }

    let should_write = match fs::read_to_string(&target_init_py) {
        Ok(existing) => existing != BRIDGE_NODE_INIT,
        Err(_) => true,
    };

    if should_write {
        match fs::write(&target_init_py, BRIDGE_NODE_INIT) {
            Ok(_) => {
                emit_sys_log(
                    app_handle,
                    format!(
                        "Injected Koharu Bridge custom node -> {}",
                        target_init_py.display()
                    ),
                );
            }
            Err(err) => {
                emit_sys_log(
                    app_handle,
                    format!("Failed to inject bridge node __init__.py: {}", err),
                );
            }
        }
    } else {
        emit_sys_log(
            app_handle,
            format!(
                "Koharu Bridge custom node verified -> {}",
                target_bridge_dir.display()
            ),
        );
    }
}

pub fn inject_bridge(working_dir: &str, app_handle: &AppHandle) -> Result<String, String> {
    let comfy_dir = comfy_root(working_dir)?;
    auto_inject_bridge_node(&comfy_dir, app_handle);
    let target_bridge_dir = comfy_dir.join("custom_nodes").join(BRIDGE_DIR_NAME);
    Ok(target_bridge_dir.to_string_lossy().to_string())
}

const CORS_FLAG: &str = "--enable-cors-header";

fn app_origin(app_handle: &AppHandle) -> Option<String> {
    let url = app_handle.get_webview_window("main")?.url().ok()?;
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("{}://{host}:{port}", url.scheme()),
        None => format!("{}://{host}", url.scheme()),
    })
}

fn with_cors_origin(mut args: Vec<String>, origin: Option<&str>) -> Vec<String> {
    let flag = match origin {
        Some(origin) => format!("{CORS_FLAG}={origin}"),
        None => CORS_FLAG.to_string(),
    };
    let position = args
        .iter()
        .position(|arg| arg == CORS_FLAG || arg.starts_with(&format!("{CORS_FLAG}=")));
    match position {
        None => args.push(flag),
        Some(index)
            if args[index] == CORS_FLAG
                && args
                    .get(index + 1)
                    .is_none_or(|next| next.starts_with("--")) =>
        {
            args[index] = flag
        }
        Some(_) => {}
    }
    args
}

#[derive(Clone, serde::Serialize)]
pub struct StatusPayload {
    pub status: String,
    pub code: Option<i32>,
}

#[derive(Clone)]
pub struct ProcessManager {
    child: Arc<Mutex<Option<Child>>>,
}

fn wait_for_exit(
    child: &mut Child,
    attempts: usize,
    interval: Duration,
) -> Result<Option<ExitStatus>, String> {
    for _ in 0..attempts {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(Some(status));
        }
        thread::sleep(interval);
    }
    Ok(None)
}

fn resolve_python_executable(py_input: &str, comfy_dir: &Path) -> Result<PathBuf, String> {
    let py_trimmed = clean_path(py_input);
    if py_trimmed.is_empty() {
        return Err(
            "Python path is not configured. Please select the Python folder or executable in Settings."
                .to_string(),
        );
    }

    let p = PathBuf::from(py_trimmed);

    if p.is_file() {
        return Ok(p);
    }

    if p.is_dir() {
        for sub in &[
            "python.exe",
            "python",
            "bin/python3",
            "bin/python",
            "Scripts/python.exe",
        ] {
            let candidate = p.join(sub);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    if p.is_relative() {
        let mut bases = vec![comfy_dir.to_path_buf()];
        if let Some(parent) = comfy_dir.parent() {
            bases.push(parent.to_path_buf());
        }

        for base in &bases {
            let direct = base.join(&p);
            if direct.is_file() {
                return Ok(direct);
            }
            if direct.is_dir() {
                for sub in &[
                    "python.exe",
                    "python",
                    "bin/python3",
                    "bin/python",
                    "Scripts/python.exe",
                ] {
                    let sub_cand = direct.join(sub);
                    if sub_cand.is_file() {
                        return Ok(sub_cand);
                    }
                }
            }
        }
    }

    if !py_trimmed.contains('/') && !py_trimmed.contains('\\') {
        return Ok(PathBuf::from(py_trimmed));
    }

    Err(format!(
        "Python executable not found for '{}'. Please verify the Python path or folder in Settings.",
        py_trimmed
    ))
}

#[tauri::command]
pub async fn discover_local_models(
    working_dir: String,
    python_path: String,
    args: Vec<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let work = PathBuf::from(clean_path(&working_dir));
        let root = comfy_root(&working_dir)?
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let mut command = Command::new(resolve_python_executable(&python_path, &work)?);
        command
            .current_dir(&work)
            .args(["-s", "-c", include_str!("local_model_discovery.py")])
            .arg(root)
            .arg(serde_json::to_string(&args).map_err(|error| error.to_string())?)
            .env("PYTHONIOENCODING", "utf-8");
        hide_command_window(&mut command);
        let output = command.output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn github_repo_name(url: &str) -> Result<&str, String> {
    let path = url
        .trim()
        .strip_prefix("https://github.com/")
        .ok_or("Enter a GitHub HTTPS repository URL.")?
        .trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.split('/');
    let owner = parts.next().unwrap_or_default();
    let repo = parts.next().unwrap_or_default();
    let valid = |value: &str| {
        !value.is_empty()
            && value != "."
            && value != ".."
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if !valid(owner) || !valid(repo) || parts.next().is_some() {
        return Err("Enter a GitHub repository URL like https://github.com/owner/repo.".into());
    }
    Ok(repo)
}

#[cfg(windows)]
fn hide_command_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_command_window(_command: &mut Command) {}

fn kill_process_tree(child: &mut Child) -> std::io::Result<()> {
    if cfg!(windows) {
        let mut taskkill = Command::new("taskkill");
        taskkill
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_command_window(&mut taskkill);
        if taskkill.status().is_ok_and(|status| status.success()) {
            return Ok(());
        }
    }
    child.kill()
}

pub fn install_custom_node(
    repository_url: &str,
    working_dir: &str,
    python_path: &str,
) -> Result<String, String> {
    let repo_name = github_repo_name(repository_url)?;
    let comfy_dir = comfy_root(working_dir)?;
    let custom_nodes_dir = comfy_dir.join("custom_nodes");
    fs::create_dir_all(&custom_nodes_dir).map_err(|e| e.to_string())?;
    let target_dir = custom_nodes_dir.join(repo_name);
    if target_dir.exists() {
        return Err(format!(
            "A custom node named '{repo_name}' is already installed."
        ));
    }

    let mut clone = Command::new("git");
    clone
        .args(["clone", "--depth", "1", repository_url.trim()])
        .stdout(Stdio::null());
    clone.arg(&target_dir);
    hide_command_window(&mut clone);
    let output = clone
        .output()
        .map_err(|e| format!("Failed to start git: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Git clone failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let requirements = target_dir.join("requirements.txt");
    if requirements.is_file() {
        let python = resolve_python_executable(python_path, &comfy_dir)?;
        let mut pip = Command::new(python);
        pip.args(["-m", "pip", "install", "-r"])
            .arg(&requirements)
            .current_dir(&target_dir)
            .stdout(Stdio::null());
        hide_command_window(&mut pip);
        let output = pip
            .output()
            .map_err(|e| format!("Failed to start pip: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "Custom node cloned, but pip failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    }

    Ok(format!(
        "Installed {repo_name}. Restart ComfyUI to load it."
    ))
}

fn spawn_stream_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    app_handle: AppHandle,
    stream_name: &'static str,
) {
    thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match buf_reader.read_until(b'\n', &mut buffer) {
                Ok(0) => break,
                Ok(_) => {
                    let text = String::from_utf8_lossy(&buffer);
                    let trimmed = text.trim_end_matches(&['\r', '\n'][..]).to_string();
                    if !trimmed.is_empty() {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        let _ = app_handle.emit(
                            "comfyui-log",
                            LogPayload {
                                stream: stream_name.to_string(),
                                message: trimmed,
                                timestamp: now,
                            },
                        );
                    }
                }
                Err(_) => break,
            }
        }
    });
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_running(&self) -> bool {
        self.child
            .lock()
            .ok()
            .and_then(|mut guard| {
                guard
                    .as_mut()
                    .map(|child| matches!(child.try_wait(), Ok(None)))
            })
            .unwrap_or(false)
    }

    pub fn start(
        &self,
        app_handle: AppHandle,
        working_dir: String,
        python_path: String,
        args: Vec<String>,
    ) -> Result<(), String> {
        if self.is_running() {
            return Err("ComfyUI process is already running".to_string());
        }

        let work_path = PathBuf::from(clean_path(&working_dir));
        let comfy_dir = comfy_root(&working_dir)?;
        let main_py_path = comfy_dir.join("main.py");
        let exec_work_dir = work_path.clone();

        let resolved_python = resolve_python_executable(&python_path, &work_path)?;

        auto_inject_bridge_node(&comfy_dir, &app_handle);

        let launch_args = if args.iter().any(|a| a.ends_with("main.py")) {
            args
        } else {
            ["-s".to_string(), main_py_path.to_string_lossy().to_string()]
                .into_iter()
                .chain(args.into_iter().filter(|arg| arg != "-s"))
                .collect()
        };

        let final_args: Vec<String> =
            with_cors_origin(launch_args, app_origin(&app_handle).as_deref())
                .into_iter()
                .filter(|arg| cfg!(windows) || arg != "--windows-standalone-build")
                .collect();

        let mut cmd = Command::new(&resolved_python);
        cmd.current_dir(&exec_work_dir);
        cmd.args(&final_args);
        cmd.env("PYTHONUNBUFFERED", "1");
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        hide_command_window(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn process '{}' in '{}': {e}",
                resolved_python.display(),
                exec_work_dir.display()
            )
        })?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        *self
            .child
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))? = Some(child);

        if let Some(stdout) = stdout {
            spawn_stream_reader(stdout, app_handle.clone(), "stdout");
        }

        if let Some(stderr) = stderr {
            spawn_stream_reader(stderr, app_handle.clone(), "stderr");
        }

        let app_watcher = app_handle.clone();
        let child_watcher = Arc::clone(&self.child);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(500));
            let Ok(mut guard) = child_watcher.lock() else {
                break;
            };
            let Some(child) = guard.as_mut() else {
                break;
            };
            let code = match child.try_wait() {
                Ok(None) => continue,
                Ok(Some(exit_status)) => exit_status.code(),
                Err(_) => None,
            };
            *guard = None;
            let _ = app_watcher.emit(
                "comfyui-status",
                StatusPayload {
                    status: "stopped".to_string(),
                    code,
                },
            );
            break;
        });

        let _ = app_handle.emit(
            "comfyui-status",
            StatusPayload {
                status: "running".to_string(),
                code: None,
            },
        );

        Ok(())
    }

    pub fn stop(&self, app_handle: AppHandle, graceful_requested: bool) -> Result<(), String> {
        let mut guard = self
            .child
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;

        if let Some(mut child) = guard.take() {
            drop(guard);

            if graceful_requested {
                emit_sys_log(
                    &app_handle,
                    "Waiting for ComfyUI to shut down gracefully...".into(),
                );
                if let Some(status) = wait_for_exit(&mut child, 50, Duration::from_millis(200))? {
                    let _ = app_handle.emit(
                        "comfyui-status",
                        StatusPayload {
                            status: "stopped".to_string(),
                            code: status.code(),
                        },
                    );
                    return Ok(());
                }
                emit_sys_log(
                    &app_handle,
                    "Graceful shutdown timed out; forcing ComfyUI to stop.".into(),
                );
            }

            kill_process_tree(&mut child).map_err(|e| e.to_string())?;
            let status = child.wait().map_err(|e| e.to_string())?;
            let _ = app_handle.emit(
                "comfyui-status",
                StatusPayload {
                    status: "stopped".to_string(),
                    code: status.code(),
                },
            );
            Ok(())
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wait_for_exit_detects_completed_child() {
        #[cfg(target_os = "windows")]
        let mut child = Command::new("cmd")
            .args(["/C", "exit", "0"])
            .spawn()
            .unwrap();
        #[cfg(not(target_os = "windows"))]
        let mut child = Command::new("sh").args(["-c", "true"]).spawn().unwrap();

        let status = wait_for_exit(&mut child, 20, Duration::from_millis(10))
            .unwrap()
            .expect("child should exit before the timeout");
        assert!(status.success());
    }

    #[test]
    fn restricts_bare_cors_flag_to_the_app_origin() {
        let args = |values: &[&str]| values.iter().map(|v| v.to_string()).collect::<Vec<_>>();
        let origin = Some("http://tauri.localhost");
        assert_eq!(
            with_cors_origin(args(&["--fast", "--enable-cors-header"]), origin),
            args(&["--fast", "--enable-cors-header=http://tauri.localhost"])
        );
        assert_eq!(
            with_cors_origin(args(&["--enable-cors-header", "--port", "8189"]), origin),
            args(&[
                "--enable-cors-header=http://tauri.localhost",
                "--port",
                "8189"
            ])
        );
        assert_eq!(
            with_cors_origin(args(&["--enable-cors-header", "*"]), origin),
            args(&["--enable-cors-header", "*"])
        );
        assert_eq!(
            with_cors_origin(args(&["--enable-cors-header=http://x"]), origin),
            args(&["--enable-cors-header=http://x"])
        );
        assert_eq!(
            with_cors_origin(args(&[]), origin),
            args(&["--enable-cors-header=http://tauri.localhost"])
        );
        assert_eq!(
            with_cors_origin(args(&[]), None),
            args(&["--enable-cors-header"])
        );
    }

    #[test]
    fn validates_github_repository_urls() {
        assert_eq!(
            github_repo_name("https://github.com/owner/custom-node.git").unwrap(),
            "custom-node"
        );
        assert!(github_repo_name("https://example.com/owner/repo").is_err());
        assert!(github_repo_name("https://github.com/owner/repo/tree/main").is_err());
    }
}
