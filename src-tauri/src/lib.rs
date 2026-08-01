//! TRMNL — a TRON-inspired terminal for macOS.
//!
//! This crate is the native half: real PTYs, shell integration, telemetry and
//! config. All rendering and the block model live in the frontend.

mod config;
mod detect;
mod pty;
mod shell_integration;
mod telemetry;

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use pty::{PtyManager, SpawnOptions};
use telemetry::{Telemetry, TelemetrySampler};

struct AppState {
    pty: PtyManager,
    telemetry: TelemetrySampler,
    integration_dir: PathBuf,
}

/// What the frontend needs to know about the host on boot.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostInfo {
    version: String,
    os_version: String,
    arch: String,
    hostname: String,
    home: String,
    shell: String,
    /// Directory holding the shell-integration scripts.
    integration_dir: String,
    /// The line to add to an rc file, for the settings UI to display.
    source_line: String,
    config_path: String,
}

#[tauri::command]
fn host_info(state: State<'_, AppState>) -> HostInfo {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let shell_kind = PathBuf::from(&shell)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "zsh".into());

    HostInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os_version: sysinfo::System::os_version().unwrap_or_else(|| "unknown".into()),
        arch: std::env::consts::ARCH.to_string(),
        hostname: sysinfo::System::host_name().unwrap_or_else(|| "localhost".into()),
        home: std::env::var("HOME").unwrap_or_default(),
        shell,
        integration_dir: state.integration_dir.to_string_lossy().to_string(),
        source_line: shell_integration::source_line(&state.integration_dir, &shell_kind),
        config_path: config::config_path().to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    options: SpawnOptions,
) -> Result<(), String> {
    state
        .pty
        .spawn(&app, id, options)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    state.pty.write(&id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .pty
        .resize(&id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.pty.kill(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_exists(state: State<'_, AppState>, id: String) -> bool {
    state.pty.exists(&id)
}

#[tauri::command]
fn sample_telemetry(state: State<'_, AppState>) -> Telemetry {
    state.telemetry.sample()
}

#[tauri::command]
fn detect_dir(path: String) -> detect::Detection {
    let expanded = if let Some(rest) = path.strip_prefix('~') {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}{rest}")
    } else {
        path
    };
    detect::detect(std::path::Path::new(&expanded))
}

#[tauri::command]
fn config_load() -> Option<String> {
    config::load()
}

#[tauri::command]
fn config_save(contents: String) -> Result<(), String> {
    config::save(&contents).map_err(|e| e.to_string())
}

/// Resolve a binary on `$PATH`, for the composer's right-aligned hint.
#[tauri::command]
fn which(cmd: String) -> Option<String> {
    let cmd = cmd.trim();
    if cmd.is_empty() || cmd.contains('/') {
        return None;
    }
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(cmd);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

/// Every executable name on `$PATH`, for palette ranking and did-you-mean.
#[tauri::command]
fn path_commands() -> Vec<String> {
    let mut names = std::collections::BTreeSet::new();
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    if let Ok(ft) = entry.file_type() {
                        if ft.is_dir() {
                            continue;
                        }
                    }
                    names.insert(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
    }
    names.into_iter().collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Install (or refresh) the shell-integration scripts on every launch so
            // an upgraded TRMNL always ships current hooks.
            let dir = config::config_dir();
            let integration_dir = shell_integration::install(&dir).unwrap_or_else(|e| {
                eprintln!("trmnl: could not install shell integration: {e}");
                dir.join("shell-integration")
            });

            app.manage(AppState {
                pty: PtyManager::new(),
                telemetry: TelemetrySampler::new(),
                integration_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_info,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_exists,
            sample_telemetry,
            detect_dir,
            config_load,
            config_save,
            which,
            path_commands,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TRMNL");
}
