//! CRGGR.sh — a terminal for macOS, built on the GRID design system.
//!
//! This crate is the native half: real PTYs, shell integration, telemetry and
//! config. All rendering and the block model live in the frontend.

mod config;
mod detect;
mod menu;
mod proctree;
mod pty;
mod shell_integration;
mod telemetry;
mod window;

use std::path::PathBuf;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use pty::{PtyManager, SpawnOptions};
use telemetry::{Telemetry, TelemetrySampler};

struct AppState {
    pty: PtyManager,
    telemetry: TelemetrySampler,
    integration_dir: PathBuf,
    /// Reused across polls so a scan is one refresh rather than a fresh
    /// process-table snapshot each time.
    scanner: Mutex<sysinfo::System>,
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
    /// Protocol version the installed hooks announce; see shell_integration.
    hook_version: u32,
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
        hook_version: shell_integration::HOOK_VERSION,
    }
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, AppState>,
    id: String,
    options: SpawnOptions,
) -> Result<(), String> {
    state
        .pty
        .spawn(&app, window.label(), id, options)
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

/// Ids of the sessions this window already owns, oldest first.
///
/// Called once by a page as it boots. A non-empty result means the page is a
/// reload rather than a fresh window: the shells it described are still running
/// and still owned by this window, so the store re-attaches to them instead of
/// spawning replacements. This is what replaced the old `pty_kill_all`, which
/// reaped every session in the process and so could not survive a second window.
#[tauri::command]
fn pty_adopt(window: tauri::Window, state: State<'_, AppState>) -> Vec<String> {
    state.pty.ids_for_window(window.label())
}

/// Kill every session owned by a window, when that window really closes.
#[tauri::command]
fn pty_kill_window(window: tauri::Window, state: State<'_, AppState>) -> usize {
    state.pty.kill_for_window(window.label())
}

#[tauri::command]
fn sample_telemetry(state: State<'_, AppState>) -> Telemetry {
    state.telemetry.sample()
}

/// Command words of everything running under a session's shell.
///
/// This is what lets a chained tool claim the accent: `bun run start` says
/// nothing about Shopify, but `shopify` is right there in the process tree four
/// levels down. Ordered outermost-first; the frontend applies its own rules.
#[tauri::command]
fn pty_tools(state: State<'_, AppState>, id: String) -> Vec<String> {
    let Some(root) = state.pty.pid(&id) else {
        return Vec::new();
    };
    let mut scanner = state.scanner.lock();
    proctree::scan(&mut scanner, root)
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
        .plugin(tauri_plugin_dialog::init())
        .menu(menu::build)
        .on_menu_event(|app, event| menu::handle_event(app, event.id().as_ref()))
        // A closing window takes its shells with it. Nothing else reaps them:
        // `pty_adopt` deliberately keeps sessions alive across a reload, so
        // without this a closed window would leak every PTY it owned — the very
        // leak the old `kill_all` existed to prevent, now scoped to one window.
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    let killed = state.pty.kill_for_window(window.label());
                    if killed > 0 {
                        eprintln!(
                            "crggr: reaped {killed} session(s) with window '{}'",
                            window.label()
                        );
                    }
                }
            }
        })
        .setup(|app| {
            // Before anything reads config: the app was TRMNL before it was
            // CRGGR.sh, and this moves ~/.config/trmnl across once. Without it
            // a rename looks like a fresh install with every profile gone.
            config::migrate_legacy_config();

            // Install (or refresh) the shell-integration scripts on every launch so
            // an upgraded build always ships current hooks.
            let dir = config::config_dir();
            let integration_dir = shell_integration::install(&dir).unwrap_or_else(|e| {
                eprintln!("crggr: could not install shell integration: {e}");
                dir.join("shell-integration")
            });

            app.manage(AppState {
                pty: PtyManager::new(),
                telemetry: TelemetrySampler::new(),
                integration_dir,
                scanner: Mutex::new(proctree::scanner()),
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
            pty_adopt,
            pty_kill_window,
            pty_tools,
            sample_telemetry,
            detect_dir,
            config_load,
            config_save,
            which,
            path_commands,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CRGGR.sh");
}
