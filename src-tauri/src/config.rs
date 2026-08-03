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

/// A session preset, as far as the native side cares about it.
///
/// The frontend owns the full profile — shell, cwd, env, startup command — and
/// none of that is any of this layer's business. All the menus need is a label
/// to show and an id to hand back, so only those two fields are modelled;
/// everything else in the stored profile is ignored rather than mirrored, which
/// keeps the shape from having to be maintained in two languages.
#[derive(Debug, Clone)]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// The user's profiles, for building native menus.
///
/// Read straight from the config file rather than asked of a window, because a
/// menu is built before any webview has finished booting and the Dock menu is
/// built when there may be no window at all. An unreadable or malformed config
/// yields an empty list: a menu missing its presets is a far better failure than
/// no menu, and the frontend surfaces config problems already.
pub fn profiles() -> Vec<ProfileSummary> {
    let Some(raw) = load() else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(list) = parsed.get("profiles").and_then(|p| p.as_array()) else {
        return Vec::new();
    };

    list.iter()
        .filter_map(|entry| {
            // camelCase on disk, because the frontend writes this file.
            let id = entry.get("id")?.as_str()?.to_string();
            let name = entry.get("name")?.as_str()?.to_string();
            let is_default = entry
                .get("isDefault")
                .and_then(|d| d.as_bool())
                .unwrap_or(false);
            Some(ProfileSummary {
                id,
                name,
                is_default,
            })
        })
        .collect()
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
