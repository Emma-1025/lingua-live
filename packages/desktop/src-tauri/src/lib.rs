mod capture;

use capture::{AudioSourceDto, CaptureManager};
use std::fs;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    capture: CaptureManager,
}

#[tauri::command]
fn list_audio_sources(state: State<'_, Mutex<AppState>>) -> Result<Vec<AudioSourceDto>, String> {
    let guard = state.inner().lock().map_err(|e| e.to_string())?;
    guard.capture.list_sources()
}

#[tauri::command]
fn start_audio_capture(
    app: tauri::AppHandle,
    state: State<'_, Mutex<AppState>>,
    session_id: String,
    source_kind: String,
    device_id: Option<String>,
) -> Result<(), String> {
    let guard = state.inner().lock().map_err(|e| e.to_string())?;
    guard
        .capture
        .start(app, session_id, source_kind, device_id)
}

#[tauri::command]
fn stop_audio_capture(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let guard = state.inner().lock().map_err(|e| e.to_string())?;
    guard.capture.stop()
}

#[tauri::command]
fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_file_accessible(path: String) -> Result<bool, String> {
    Ok(fs::metadata(path).map(|meta| meta.is_file()).unwrap_or(false))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Linux WebKit + some GPU drivers render a blank webview without this (tauri-apps/tauri#13074).
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    tauri::Builder::default()
        .manage(Mutex::new(AppState {
            capture: CaptureManager::new(),
        }))
        .invoke_handler(tauri::generate_handler![
            list_audio_sources,
            start_audio_capture,
            stop_audio_capture,
            read_audio_file,
            is_file_accessible
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
