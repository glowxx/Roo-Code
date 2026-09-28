//! Fast Filesystem Operations and Scoped Path Validation

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceScanResult {
    pub files: Vec<String>,
    pub directories: Vec<String>,
}

/// Strips Windows verbatim prefix (\\?\ or \\?\UNC\) to ensure uniform path comparison
pub fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

/// Validates that a path is strictly located within the workspace boundary (jail root)
pub fn validate_path_within_root(target_path: &str, allowed_root: &str) -> Result<PathBuf, String> {
    if target_path.is_empty() {
        return Err("Target path cannot be empty".to_string());
    }
    if allowed_root.is_empty() {
        return Err("Allowed root cannot be empty".to_string());
    }

    let root = Path::new(allowed_root);
    let canonical_root = strip_verbatim_prefix(
        &root
            .canonicalize()
            .map_err(|e| format!("Cannot canonicalize root directory: {}", e))?,
    );

    let resolved_target = if Path::new(target_path).is_absolute() {
        strip_verbatim_prefix(Path::new(target_path))
    } else {
        canonical_root.join(target_path)
    };

    let canonical_target = if resolved_target.exists() {
        strip_verbatim_prefix(
            &resolved_target
                .canonicalize()
                .map_err(|e| format!("Cannot canonicalize target path: {}", e))?,
        )
    } else {
        // If file does not exist yet (e.g. for write), verify parent exists within root
        let mut ancestor = resolved_target.as_path();
        while !ancestor.exists() && ancestor.parent().is_some() {
            ancestor = ancestor.parent().unwrap();
        }
        let canonical_ancestor = strip_verbatim_prefix(
            &ancestor
                .canonicalize()
                .map_err(|e| format!("Cannot canonicalize ancestor path: {}", e))?,
        );

        if !canonical_ancestor.starts_with(&canonical_root) {
            return Err("Target ancestor escapes workspace root boundary".to_string());
        }
        resolved_target
    };

    if !canonical_target.starts_with(&canonical_root) {
        return Err("Path traversal detected: target escapes workspace root".to_string());
    }

    Ok(canonical_target)
}

#[tauri::command]
pub async fn desktop_scan_workspace(workspace_path: String) -> Result<WorkspaceScanResult, String> {
    let root = Path::new(&workspace_path);
    if !root.exists() || !root.is_dir() {
        return Err("Invalid workspace directory".to_string());
    }

    let canonical_root = strip_verbatim_prefix(
        &root.canonicalize().map_err(|e| e.to_string())?
    );
    let mut files = Vec::new();
    let mut directories = Vec::new();

    let mut stack = vec![canonical_root.clone()];
    let max_files = 25_000;
    let ignored_names = [
        ".git",
        "node_modules",
        "dist",
        "build",
        ".turbo",
        "target",
        ".vscode",
    ];

    while let Some(current_dir) = stack.pop() {
        let entries = match fs::read_dir(&current_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name_str = file_name.to_string_lossy();

            if ignored_names.iter().any(|ignored| name_str == *ignored) {
                continue;
            }

            let path = entry.path();
            let relative = match path.strip_prefix(&canonical_root) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            if path.is_dir() {
                directories.push(relative);
                stack.push(path);
            } else if path.is_file() {
                files.push(relative);
                if files.len() >= max_files {
                    break;
                }
            }
        }

        if files.len() >= max_files {
            break;
        }
    }

    Ok(WorkspaceScanResult { files, directories })
}

#[tauri::command]
pub async fn desktop_read_file(
    workspace_path: String,
    file_path: String,
) -> Result<String, String> {
    let validated = validate_path_within_root(&file_path, &workspace_path)?;
    fs::read_to_string(&validated).map_err(|e| format!("Failed to read file: {}", e))
}
