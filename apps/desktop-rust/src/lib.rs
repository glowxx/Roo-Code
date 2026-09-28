pub mod commands;
pub mod ipc;
pub mod supervisor;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use commands::*;
use supervisor::EngineSupervisor;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir().unwrap_or_default();
            let script_candidates = vec![
                resource_dir.join("dist").join("cli.js"),
                resource_dir.join("cli.js"),
                PathBuf::from("../desktop/dist/cli.js"),
                PathBuf::from("./apps/desktop/dist/cli.js"),
            ];

            let script_path = script_candidates
                .into_iter()
                .find(|p| p.exists())
                .unwrap_or_else(|| PathBuf::from("../desktop/dist/cli.js"));

            let node_binary = std::env::var("NODE_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("node"));

            let workspace = std::env::var("ROO_WORKSPACE")
                .map(PathBuf::from)
                .unwrap_or_default();

            let port = std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(4500);

            let token = std::env::var("ROO_AUTH_TOKEN").unwrap_or_default();

            if script_path.exists() {
                match EngineSupervisor::new(node_binary, script_path, workspace, port, token) {
                    Ok(supervisor) => {
                        let sup_arc = Arc::new(supervisor);
                        let sup_clone = Arc::clone(&sup_arc);
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = sup_clone.start().await {
                                eprintln!("[Supervisor] Failed to start Node engine: {}", e);
                            }
                        });
                        app.manage(sup_arc);
                    }
                    Err(e) => {
                        eprintln!("[Supervisor] Initialization error: {}", e);
                    }
                }
            } else {
                println!("[Supervisor] Running in detached server mode (script not found at {:?})", script_path);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_window_minimize,
            desktop_window_maximize,
            desktop_window_close,
            desktop_window_is_maximized,
            desktop_window_start_dragging,
            desktop_open_external,
            desktop_show_item_in_folder,
            desktop_open_path,
            desktop_select_folder,
            desktop_clipboard_read,
            desktop_clipboard_write,
            desktop_client_message,
            desktop_scan_workspace,
            desktop_read_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building Roo Code Desktop Rust application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(sup) = app_handle.try_state::<Arc<EngineSupervisor>>() {
                    let sup = Arc::clone(&sup);
                    tauri::async_runtime::block_on(async move {
                        sup.shutdown().await;
                    });
                }
            }
        });
}

