use tauri::{Emitter, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
};
use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
use windows::core::{Interface, PWSTR};

const DROPPED_FILE_PATHS_EVENT: &str = "dropped-file-paths";

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let emitter = window.clone();
    window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let objects = args
                .cast::<ICoreWebView2WebMessageReceivedEventArgs2>()?
                .AdditionalObjects()?;
            let mut count = 0;
            objects.Count(&mut count)?;
            if count == 0 {
                return Ok(());
            }
            let mut paths = Vec::new();
            for index in 0..count {
                if let Ok(file) = objects.GetValueAtIndex(index)?.cast::<ICoreWebView2File>() {
                    let mut path = PWSTR::null();
                    file.Path(&mut path)?;
                    paths.push(take_pwstr(path));
                }
            }
            let _ = emitter.emit(DROPPED_FILE_PATHS_EVENT, paths);
            Ok(())
        }));
        let mut token = 0;
        if let Err(error) = core.add_WebMessageReceived(&handler, &mut token) {
            eprintln!("Could not listen for dropped files: {error}");
        }
    })
}
