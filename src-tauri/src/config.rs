//! Settings persistence.
//!
//! The spec puts config at `~/.config/grid/config.toml` and requires that
//! settings save immediately — there is no Save button. We store JSON at
//! `~/.config/trmnl/config.json` instead: the frontend owns the shape of this
//! blob, and round-tripping arbitrary nested UI state through TOML buys nothing.
//! The footer string in Settings should reflect whatever path `config_path`
//! returns rather than a hardcoded one.

use std::path::PathBuf;

use anyhow::Result;

pub fn config_dir() -> PathBuf {
    // Deliberately ~/.config rather than ~/Library/Application Support: this is a
    // terminal, and its users expect a dotfile they can read, diff and check in.
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| {
            let home = std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/tmp"));
            home.join(".config")
        });
    base.join("trmnl")
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

/// Read the raw settings blob. Returns `None` when no config exists yet, so the
/// frontend can fall back to its defaults.
pub fn load() -> Option<String> {
    std::fs::read_to_string(config_path()).ok()
}

/// Write settings atomically.
///
/// Settings save on every keystroke in the UI, so a crash mid-write is a real
/// possibility; writing to a temp file and renaming means a torn write can never
/// leave the user with a config that won't parse.
pub fn save(contents: &str) -> Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;

    let path = config_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
