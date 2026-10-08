mod animadex;
mod app_data;
mod booru;
mod civitai;
mod comfy_paths;
mod danbooru_wiki;
mod download_manager;
mod image_gallery;
mod library_manager;
mod model_manager;
mod network_cache;
mod process_manager;
mod prompt_suggestions;

use comfy_paths::clean_path;
use process_manager::ProcessManager;
use std::sync::OnceLock;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let mut tray = TrayIconBuilder::new()
        .tooltip(&app.package_info().name)
        .menu(&Menu::with_items(app, &[&show, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                show_main_window(app);
                let _ = app.emit("tray-quit", ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

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

fn file_dialog(title: Option<String>, default_path: Option<String>) -> rfd::FileDialog {
    let mut dialog = rfd::FileDialog::new();
    if let Some(title) = title {
        dialog = dialog.set_title(&title);
    }
    let start = default_path
        .as_deref()
        .map(clean_path)
        .filter(|path| !path.is_empty())
        .map(std::path::Path::new)
        .filter(|path| path.exists());
    if let Some(path) = start {
        let directory = if path.is_dir() { Some(path) } else { path.parent() };
        if let Some(directory) = directory {
            dialog = dialog.set_directory(directory);
        }
    }
    dialog
}

#[tauri::command]
fn pick_directory(title: Option<String>, default_path: Option<String>) -> Option<String> {
    file_dialog(title, default_path)
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
    let mut dialog = file_dialog(title, default_path);
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
    let trimmed = clean_path(&path);
    #[cfg(not(windows))]
    let path_buf = {
        let p = std::path::PathBuf::from(trimmed);
        if !p.exists() && trimmed.contains('\\') {
            let normalized = trimmed.replace('\\', "/");
            let alt = std::path::PathBuf::from(&normalized);
            if alt.exists() {
                alt
            } else {
                p
            }
        } else {
            p
        }
    };
    #[cfg(windows)]
    let path_buf = std::path::PathBuf::from(trimmed);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path_buf.display()));
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let mut cmd = Command::new("explorer");
        let win_path = path_buf.to_string_lossy().replace('/', "\\");
        if path_buf.is_file() {
            cmd.args(["/select,", &win_path]);
        } else {
            cmd.arg(&win_path);
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

fn protocol_response(
    media: Option<(Vec<u8>, String)>,
    cache_control: &str,
) -> tauri::http::Response<Vec<u8>> {
    let builder = tauri::http::Response::builder()
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    match media {
        Some((bytes, content_type)) => builder
            .header(tauri::http::header::CONTENT_TYPE, content_type)
            .header(tauri::http::header::CACHE_CONTROL, cache_control)
            .header("X-Content-Type-Options", "nosniff")
            .body(bytes),
        None => builder.status(404).body(Vec::new()),
    }
    .unwrap_or_default()
}

fn respond_in_background(
    responder: tauri::UriSchemeResponder,
    cache_control: &'static str,
    load: impl FnOnce() -> Option<(Vec<u8>, String)> + Send + 'static,
) {
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(protocol_response(load(), cache_control));
    });
}

fn media_id(path: &str) -> (bool, String) {
    let mut parts = path.trim_matches('/').split('/');
    let thumbnail = parts.next() == Some("thumb");
    (thumbnail, parts.next().unwrap_or_default().to_owned())
}

fn danbooru_media(path: &str) -> Option<(Vec<u8>, String)> {
    static CLIENT: OnceLock<Option<reqwest::blocking::Client>> = OnceLock::new();
    let client = CLIENT
        .get_or_init(|| {
            reqwest::blocking::Client::builder()
                .user_agent("Koharu/1.0 (Danbooru Tag Wiki)")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .ok()
        })
        .as_ref()?;
    let response = client
        .get(format!("https://cdn.donmai.us/{path}"))
        .send()
        .ok()
        .filter(|response| response.status().is_success())?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    Some((response.bytes().ok()?.to_vec(), content_type))
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
            show_main_window(app)
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
            "koharu-model",
            move |_context, request, responder| {
                let (thumbnail, id) = media_id(request.uri().path());
                let models = protocol_models.clone();
                respond_in_background(responder, "private, max-age=3600", move || {
                    models
                        .read_preview(&id, thumbnail)
                        .map(|(bytes, content_type)| (bytes, content_type.to_string()))
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "koharu-image",
            move |_context, request, responder| {
                let (thumbnail, id) = media_id(request.uri().path());
                let files = protocol_files.clone();
                respond_in_background(responder, "private, max-age=3600", move || {
                    files
                        .read(&id, thumbnail)
                        .map(|(bytes, content_type)| (bytes, content_type.to_string()))
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "koharu-library",
            move |context, request, responder| {
                let path = request.uri().path().to_string();
                let app = context.app_handle().clone();
                respond_in_background(responder, "private, max-age=3600", move || {
                    library_manager::handle_library_uri(&app, &path)
                        .map(|(bytes, content_type)| (bytes, content_type.to_string()))
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "booru-image",
            move |context, request, responder| {
                let uri = request.uri().to_string();
                let app = context.app_handle().clone();
                respond_in_background(responder, "private, max-age=86400", move || {
                    booru::handle_media_uri(&app, &uri)
                        .ok()
                        .map(|(bytes, content_type)| (bytes, content_type.to_string()))
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "danbooru-image",
            move |_context, request, responder| {
                let path = request.uri().path().trim_matches('/').to_string();
                respond_in_background(responder, "public, max-age=604800", move || {
                    danbooru_media(&path)
                });
            },
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let gallery_cache_dir = app.path().app_config_dir()?.join(".cache").join("gallery");
            app.state::<image_gallery::GalleryFiles>()
                .set_cache_dir(gallery_cache_dir)
                .map_err(std::io::Error::other)?;
            app.state::<model_manager::ModelIndex>()
                .configure(app.path().app_config_dir()?)
                .map_err(std::io::Error::other)?;
            network_cache::prune_expired_in_background(app.handle());
            build_tray(app)?;
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
            app_data::get_app_data_entry,
            app_data::set_app_data_entry,
            app_data::remove_app_data_entry,
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
            civitai::image_generation_data,
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
            image_gallery::open_comfy_output_folder,
            image_gallery::save_image_as,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<download_manager::DownloadManager>()
                    .suspend_all(app, std::time::Duration::from_secs(5));
            }
        });
}
