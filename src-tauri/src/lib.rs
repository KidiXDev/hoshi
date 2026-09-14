mod animadex;
mod booru;
mod civitai;
mod danbooru_wiki;
mod download_manager;
mod image_gallery;
mod library_manager;
mod model_manager;
mod network_cache;
mod preset_manager;
mod process_manager;
mod prompt_suggestions;

use process_manager::ProcessManager;
use std::fs;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, State};

#[cfg(windows)]
fn style_native_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use std::{ffi::c_void, mem::size_of_val};
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let hwnd = window.hwnd()?;
    let corner_preference = DWMWCP_ROUND;
    let border_color = 0x003D2C26_u32;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &raw const corner_preference as *const c_void,
            size_of_val(&corner_preference) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &raw const border_color as *const c_void,
            size_of_val(&border_color) as u32,
        );
    }
    Ok(())
}

const DATA_KEY: &[u8] = b"comfy-gui";
static APP_DATA_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn app_data_path(app_handle: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Invalid app data name".into());
    }
    Ok(app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(format!("{name}.dat")))
}

fn save_app_data_unlocked(app_handle: &AppHandle, name: &str, value: &str) -> Result<(), String> {
    let path = app_data_path(app_handle, name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data: Vec<u8> = value
        .bytes()
        .enumerate()
        .map(|(i, byte)| byte ^ DATA_KEY[i % DATA_KEY.len()])
        .collect();
    fs::write(path, data).map_err(|e| e.to_string())
}

fn load_app_data_unlocked(app_handle: &AppHandle, name: &str) -> Result<Option<String>, String> {
    let path = app_data_path(app_handle, name)?;
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let decoded: Vec<u8> = data
        .into_iter()
        .enumerate()
        .map(|(i, byte)| byte ^ DATA_KEY[i % DATA_KEY.len()])
        .collect();
    String::from_utf8(decoded)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub(crate) fn load_app_data_entry(
    app_handle: &AppHandle,
    name: &str,
    key: &str,
) -> Result<Option<serde_json::Value>, String> {
    let _guard = APP_DATA_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    let Some(value) = load_app_data_unlocked(app_handle, name)? else {
        return Ok(None);
    };
    let data: serde_json::Value = serde_json::from_str(&value).map_err(|e| e.to_string())?;
    Ok(data.get(key).cloned())
}

pub(crate) fn save_app_data_entry(
    app_handle: &AppHandle,
    name: &str,
    key: &str,
    value: serde_json::Value,
) -> Result<(), String> {
    let _guard = APP_DATA_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    let mut data = load_app_data_unlocked(app_handle, name)?
        .map(|raw| serde_json::from_str(&raw))
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| serde_json::json!({}));
    let object = data
        .as_object_mut()
        .ok_or_else(|| format!("{name}.dat root must be an object"))?;
    object.insert(key.to_string(), value);
    save_app_data_unlocked(
        app_handle,
        name,
        &serde_json::to_string(&data).map_err(|e| e.to_string())?,
    )
}

fn delete_app_data_entry_value(
    app_handle: &AppHandle,
    name: &str,
    key: &str,
) -> Result<(), String> {
    let _guard = APP_DATA_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    let Some(raw) = load_app_data_unlocked(app_handle, name)? else {
        return Ok(());
    };
    let mut data: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    data.as_object_mut()
        .ok_or_else(|| format!("{name}.dat root must be an object"))?
        .remove(key);
    save_app_data_unlocked(
        app_handle,
        name,
        &serde_json::to_string(&data).map_err(|e| e.to_string())?,
    )
}

#[tauri::command]
fn get_app_data_entry(
    app_handle: AppHandle,
    name: String,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    load_app_data_entry(&app_handle, &name, &key)
}

#[tauri::command]
fn set_app_data_entry(
    app_handle: AppHandle,
    name: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    save_app_data_entry(&app_handle, &name, &key, value)
}

#[tauri::command]
fn remove_app_data_entry(app_handle: AppHandle, name: String, key: String) -> Result<(), String> {
    delete_app_data_entry_value(&app_handle, &name, &key)
}

#[tauri::command]
fn save_app_data(app_handle: AppHandle, name: String, value: String) -> Result<(), String> {
    let _guard = APP_DATA_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    save_app_data_unlocked(&app_handle, &name, &value)
}

#[tauri::command]
fn load_app_data(app_handle: AppHandle, name: String) -> Result<Option<String>, String> {
    let _guard = APP_DATA_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    load_app_data_unlocked(&app_handle, &name)
}

#[tauri::command]
fn delete_app_data(app_handle: AppHandle, name: String) -> Result<(), String> {
    let _guard = APP_DATA_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    let path = app_data_path(&app_handle, &name)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn pick_directory(title: Option<String>, default_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(t) = title {
        dialog = dialog.set_title(&t);
    }
    if let Some(p) = default_path {
        let p_trimmed = p.trim().trim_matches('"').trim_matches('\'');
        if !p_trimmed.is_empty() {
            let path = std::path::Path::new(p_trimmed);
            if path.exists() {
                if path.is_dir() {
                    dialog = dialog.set_directory(path);
                } else if let Some(parent) = path.parent() {
                    dialog = dialog.set_directory(parent);
                }
            }
        }
    }
    dialog
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_file(
    title: Option<String>,
    default_path: Option<String>,
    filter_name: Option<String>,
    filter_extensions: Option<Vec<String>>,
) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(t) = title {
        dialog = dialog.set_title(&t);
    }
    if let Some(p) = default_path {
        let p_trimmed = p.trim().trim_matches('"').trim_matches('\'');
        if !p_trimmed.is_empty() {
            let path = std::path::Path::new(p_trimmed);
            if path.exists() {
                if path.is_dir() {
                    dialog = dialog.set_directory(path);
                } else if let Some(parent) = path.parent() {
                    dialog = dialog.set_directory(parent);
                }
            }
        }
    }
    if let (Some(name), Some(exts)) = (filter_name, filter_extensions) {
        let exts_ref: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(&name, &exts_ref);
    }
    dialog.pick_file().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn start_comfyui(
    app_handle: AppHandle,
    state: State<'_, ProcessManager>,
    working_dir: String,
    python_path: String,
    args: Vec<String>,
) -> Result<(), String> {
    state.start(app_handle, working_dir, python_path, args)
}

#[tauri::command]
async fn stop_comfyui(
    app_handle: AppHandle,
    state: State<'_, ProcessManager>,
    graceful_requested: bool,
) -> Result<(), String> {
    let manager = (*state).clone();
    tauri::async_runtime::spawn_blocking(move || manager.stop(app_handle, graceful_requested))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_comfyui_status(state: State<'_, ProcessManager>) -> bool {
    state.is_running()
}

#[tauri::command]
fn inject_bridge_custom_node(app_handle: AppHandle, working_dir: String) -> Result<String, String> {
    process_manager::inject_bridge(&working_dir, &app_handle)
}

#[tauri::command]
async fn install_custom_node(
    repository_url: String,
    working_dir: String,
    python_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        process_manager::install_custom_node(&repository_url, &working_dir, &python_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    let trimmed = path.trim().trim_matches(['"', '\'']);
    let path_buf = std::path::PathBuf::from(trimmed);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path_buf.display()));
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let mut cmd = Command::new("explorer");
        if path_buf.is_file() {
            cmd.args(["/select,", &path_buf.to_string_lossy()]);
        } else {
            cmd.arg(&path_buf.to_string_lossy().to_string());
        }
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .args(["-R", &path_buf.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        use std::process::Command;
        let target = if path_buf.is_file() {
            path_buf.parent().unwrap_or(&path_buf)
        } else {
            &path_buf
        };
        Command::new("xdg-open")
            .arg(target.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let process_manager = ProcessManager::new();
    let download_manager = download_manager::DownloadManager::default();
    let gallery_files = image_gallery::GalleryFiles::default();
    let protocol_files = gallery_files.clone();
    let model_index = model_manager::ModelIndex::default();
    let protocol_models = model_index.clone();
    let window_state_flags = tauri_plugin_window_state::StateFlags::SIZE
        | tauri_plugin_window_state::StateFlags::POSITION
        | tauri_plugin_window_state::StateFlags::MAXIMIZED
        | tauri_plugin_window_state::StateFlags::FULLSCREEN;

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags)
                .build(),
        )
        .manage(process_manager)
        .manage(download_manager)
        .manage(gallery_files)
        .manage(model_index)
        .register_asynchronous_uri_scheme_protocol(
            "comfygui-model",
            move |_context, request, responder| {
                let mut parts = request.uri().path().trim_matches('/').split('/');
                let thumbnail = parts.next() == Some("thumb");
                let id = parts.next().unwrap_or_default().to_owned();
                let models = protocol_models.clone();
                std::thread::spawn(move || {
                    let response = match models.read_preview(&id, thumbnail) {
                        Some((bytes, content_type)) => tauri::http::Response::builder()
                            .header(tauri::http::header::CONTENT_TYPE, content_type)
                            .header(tauri::http::header::CACHE_CONTROL, "private, max-age=3600")
                            .body(bytes)
                            .unwrap(),
                        None => tauri::http::Response::builder()
                            .status(404)
                            .body(Vec::new())
                            .unwrap(),
                    };
                    responder.respond(response);
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "comfygui-image",
            move |_context, request, responder| {
                let mut parts = request.uri().path().trim_matches('/').split('/');
                let thumbnail = parts.next() == Some("thumb");
                let id = parts.next().unwrap_or_default().to_owned();
                let files = protocol_files.clone();
                std::thread::spawn(move || {
                    let response = match files.read(&id, thumbnail) {
                        Some((bytes, content_type)) => tauri::http::Response::builder()
                            .header(tauri::http::header::CONTENT_TYPE, content_type)
                            .header(tauri::http::header::CACHE_CONTROL, "private, max-age=3600")
                            .body(bytes)
                            .unwrap(),
                        None => tauri::http::Response::builder()
                            .status(404)
                            .body(Vec::new())
                            .unwrap(),
                    };
                    responder.respond(response);
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "comfygui-library",
            move |context, request, responder| {
                let path = request.uri().path().to_string();
                let app = context.app_handle().clone();
                std::thread::spawn(move || {
                    let response = match library_manager::handle_library_uri(&app, &path) {
                        Some((bytes, content_type)) => tauri::http::Response::builder()
                            .header(tauri::http::header::CONTENT_TYPE, content_type)
                            .header(tauri::http::header::CACHE_CONTROL, "private, max-age=3600")
                            .body(bytes)
                            .unwrap(),
                        None => tauri::http::Response::builder()
                            .status(404)
                            .body(Vec::new())
                            .unwrap(),
                    };
                    responder.respond(response);
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "booru-image",
            move |context, request, responder| {
                let uri = request.uri().to_string();
                let app = context.app_handle().clone();
                std::thread::spawn(move || {
                    let response = match booru::handle_media_uri(&app, &uri) {
                        Ok((bytes, content_type)) => tauri::http::Response::builder()
                            .header(tauri::http::header::CONTENT_TYPE, content_type)
                            .header(tauri::http::header::CACHE_CONTROL, "private, max-age=86400")
                            .header("X-Content-Type-Options", "nosniff")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(bytes)
                            .unwrap(),
                        Err(_) => tauri::http::Response::builder()
                            .status(404)
                            .body(Vec::new())
                            .unwrap(),
                    };
                    responder.respond(response);
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "danbooru-image",
            move |_context, request, responder| {
                let path = request.uri().path().trim_matches('/').to_string();
                std::thread::spawn(move || {
                    let client = match reqwest::blocking::Client::builder()
                        .user_agent("ComfyGUI/1.0 (Danbooru Tag Wiki)")
                        .timeout(std::time::Duration::from_secs(15))
                        .build()
                    {
                        Ok(c) => c,
                        Err(_) => {
                            responder.respond(
                                tauri::http::Response::builder()
                                    .status(500)
                                    .body(Vec::new())
                                    .unwrap(),
                            );
                            return;
                        }
                    };
                    let url = format!("https://cdn.donmai.us/{path}");
                    let response = match client.get(&url).send() {
                        Ok(resp) if resp.status().is_success() => {
                            let content_type = resp
                                .headers()
                                .get(reqwest::header::CONTENT_TYPE)
                                .and_then(|h| h.to_str().ok())
                                .unwrap_or("image/jpeg")
                                .to_string();
                            let bytes = resp.bytes().unwrap_or_default().to_vec();
                            tauri::http::Response::builder()
                                .header(tauri::http::header::CONTENT_TYPE, content_type)
                                .header(
                                    tauri::http::header::CACHE_CONTROL,
                                    "public, max-age=604800",
                                )
                                .header("Access-Control-Allow-Origin", "*")
                                .body(bytes)
                                .unwrap()
                        }
                        _ => tauri::http::Response::builder()
                            .status(404)
                            .body(Vec::new())
                            .unwrap(),
                    };
                    responder.respond(response);
                });
            },
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let gallery_cache_dir = app.path().app_config_dir()?.join(".cache");
            app.state::<image_gallery::GalleryFiles>()
                .set_cache_dir(gallery_cache_dir)
                .map_err(std::io::Error::other)?;
            app.state::<model_manager::ModelIndex>()
                .configure(app.path().app_config_dir()?)
                .map_err(std::io::Error::other)?;
            network_cache::prune_expired_in_background(app.handle());
            if let (Some(window), Some(icon)) =
                (app.get_webview_window("main"), app.default_window_icon())
            {
                window.set_icon(icon.clone())?;
                #[cfg(windows)]
                style_native_window(&window)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            save_app_data,
            load_app_data,
            delete_app_data,
            get_app_data_entry,
            set_app_data_entry,
            remove_app_data_entry,
            pick_directory,
            pick_file,
            start_comfyui,
            stop_comfyui,
            get_comfyui_status,
            inject_bridge_custom_node,
            install_custom_node,
            show_in_folder,
            danbooru_wiki::danbooru_wiki_request,
            booru::booru_sources,
            booru::booru_search,
            booru::booru_ranking,
            booru::booru_detail,
            booru::booru_settings_get,
            booru::booru_settings_save,
            booru::booru_test_credentials,
            booru::booru_solve_cloudflare,
            booru::booru_favorites,
            booru::booru_favorite_set,
            booru::booru_clear_cache,
            civitai::models,
            civitai::model_by_id,
            civitai::model_version_by_id,
            civitai::model_version_by_hash,
            civitai::enums,
            civitai::download,
            model_manager::list_local_models_index,
            model_manager::rescan_models,
            model_manager::find_local_model,
            model_manager::read_model_metadata,
            model_manager::read_model_sidecar,
            model_manager::hash_model,
            model_manager::sync_model_with_civitai,
            model_manager::sync_all_models,
            model_manager::cancel_model_sync,
            model_manager::check_model_update,
            model_manager::delete_model,
            model_manager::set_model_preview,
            download_manager::list,
            download_manager::pause,
            download_manager::resume,
            download_manager::cancel,
            download_manager::clear_history,
            image_gallery::list_output_images,
            image_gallery::resolve_history_images,
            process_manager::discover_local_models,
            image_gallery::prepare_output_gallery,
            image_gallery::clear_gallery_cache,
            image_gallery::gallery_cache_directory,
            image_gallery::refresh_output_images,
            image_gallery::read_output_image_metadata,
            preset_manager::list_preset_files,
            preset_manager::save_preset_file,
            preset_manager::delete_preset_file,
            preset_manager::open_presets_folder,
            library_manager::library_list_items,
            library_manager::library_get_item,
            library_manager::library_save_item,
            library_manager::library_delete_item,
            library_manager::library_save_thumbnail_from_path,
            library_manager::library_save_thumbnail_from_data_url,
            library_manager::library_save_thumbnail_from_url,
            library_manager::library_read_thumbnail,
            library_manager::library_open_folder,
            prompt_suggestions::load_prompt_suggestions,
            prompt_suggestions::open_prompt_suggestions_folder,
            animadex::animadex_request,
            network_cache::clear_network_cache,
            network_cache::get_network_cache_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
