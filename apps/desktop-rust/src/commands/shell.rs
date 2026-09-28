//! Native Shell, Dialog, Clipboard and IPC Integration Commands

use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
pub async fn desktop_open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") && !url.starts_with("mailto:") {
        return Err("Disallowed scheme for external navigation".to_string());
    }

    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open external URL: {}", e))
}

#[tauri::command]
pub async fn desktop_show_item_in_folder(app: AppHandle, file_path: String) -> Result<bool, String> {
    let p = Path::new(&file_path);
    if !p.exists() {
        return Ok(false);
    }

    app.opener()
        .reveal_item_in_dir(p)
        .map_err(|e| format!("Failed to reveal item: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub async fn desktop_open_path(app: AppHandle, file_path: String) -> Result<bool, String> {
    let p = Path::new(&file_path);
    if !p.exists() {
        return Ok(false);
    }

    app.opener()
        .open_path(&file_path, None::<&str>)
        .map_err(|e| format!("Failed to open path: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub async fn desktop_select_folder(
    app: AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(ref dp) = default_path {
        builder = builder.set_directory(dp);
    }

    let folder_opt = builder.blocking_pick_folder();
    match folder_opt {
        Some(path) => {
            let path_buf = path.into_path().map_err(|e| e.to_string())?;
            Ok(Some(path_buf.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn desktop_clipboard_read(app: AppHandle) -> Result<String, String> {
    app.clipboard()
        .read_text()
        .map_err(|e| format!("Clipboard read error: {}", e))
}

#[tauri::command]
pub fn desktop_clipboard_write(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Clipboard write error: {}", e))
}

#[tauri::command]
pub async fn desktop_client_message(
    _app: AppHandle,
    message: serde_json::Value,
) -> Result<(), String> {
    let _ = message;
    Ok(())
}
