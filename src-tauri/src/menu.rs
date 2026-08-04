//! The macOS application menu.
//!
//! Two kinds of item live here and the difference matters. **Predefined** items
//! are the ones AppKit already knows how to perform — Cut/Copy/Paste, Hide,
//! Minimize, Quit. They are wired straight to the responder chain, so Copy
//! reaches the webview's own selection handling and every item arrives
//! localized and with the system's own key equivalents. Anything we implement
//! ourselves would have to re-derive that, badly.
//!
//! **Custom** items are the ones with no system meaning: a session is a TRMNL
//! concept, so New/Close Session can only be a custom item that emits an event
//! for the frontend to act on.
//!
//! That split is also why New/Close Session are events rather than native
//! window operations: a session is a tab in one window's rail, and the table
//! describing it lives entirely in that window's webview, so there is no native
//! operation that means "close session". The menu items route to exactly the
//! store actions ⌘T and ⌘W already call, and the accelerators are declared here
//! so the native menu owns them — a menu item with an accelerator swallows the
//! chord before the webview's keydown listener ever sees it, so declaring them
//! in both places would be double-firing, not redundancy.
//!
//! New Window is the opposite case, and the one custom item that is *not* an
//! event: a window is a native object, so it is built natively (see window.rs)
//! and no webview needs to be involved. Every other custom item is an
//! instruction to one particular window's session table, which is why routing
//! them to the focused window is load-bearing — see `handle_event`.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

use crate::config::{self, ProfileSummary};

/// Menu ids for the custom items. Constants rather than literals because the id
/// is written at construction and read again in the event handler, and a typo
/// between the two is a silently dead menu item.
const ID_SETTINGS: &str = "settings";
const ID_NEW_WINDOW: &str = "new-window";
const ID_NEW_SESSION: &str = "new-session";
const ID_CLOSE_SESSION: &str = "close-session";

/// Prefix for the per-profile items, followed by the profile's own id.
///
/// The id carries the profile rather than an index into the submenu, because an
/// index is only meaningful next to the list it was built from: rename or delete
/// a profile and a stored index silently starts a session from the wrong one.
const ID_PROFILE_PREFIX: &str = "profile:";

/// Events the frontend listens for. Namespaced like `pty://…` so a menu event
/// is recognisable at the listener side.
const EVENT_SETTINGS: &str = "menu://settings";
const EVENT_NEW_SESSION: &str = "menu://new-session";
const EVENT_CLOSE_SESSION: &str = "menu://close-session";

/// Build the app menu.
///
/// Deliberately absent:
///
/// - **Reload.** A reload discards the session table while the shells keep
///   running. That used to be unrecoverable, and is now merely lossy: sessions
///   record an owning window, so a reloaded page adopts its own shells back
///   (see `pty_adopt`) rather than reaping every shell in the app. What it
///   still cannot recover is pane layout, so ⌘R would silently collapse a
///   split. The stock WebKit context menu had its Reload removed for the older,
///   worse version of this reason; there is not enough gained by putting one
///   back with a first-class accelerator.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadataBuilder::new()
        .name(Some("TRMNL"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .build();

    let settings = MenuItem::with_id(app, ID_SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?;

    let app_menu = Submenu::with_items(
        app,
        "TRMNL",
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // ⌘N opens a window and ⌘T opens a session, matching Terminal.app and every
    // other tabbed Mac app. Session keeps ⌘T because that is what the frontend
    // has always bound, and because a session is a tab in the rail rather than a
    // window — the two are genuinely different things and now have the two
    // accelerators users expect for them.
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, ID_NEW_WINDOW, "New Window", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, ID_NEW_SESSION, "New Session", true, Some("CmdOrCtrl+T"))?,
            &MenuItem::with_id(
                app,
                ID_CLOSE_SESSION,
                "Close Session",
                true,
                Some("CmdOrCtrl+W"),
            )?,
        ],
    )?;

    // Profiles are the user's saved presets, so the menu is only worth showing
    // when there are some — an empty "New Session with Profile" submenu reads as
    // something broken rather than something unused. `profiles()` returns an
    // empty list for a missing or malformed config, which lands in the same
    // branch.
    let profiles = config::profiles();
    if !profiles.is_empty() {
        file_menu.append(&PredefinedMenuItem::separator(app)?)?;
        file_menu.append(&profile_submenu(app, &profiles)?)?;
    }

    // All predefined: these have to reach the webview's editing commands through
    // the responder chain, which is precisely what a custom item cannot do.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            // "Zoom" in AppKit terms; `maximize` is Tauri's name for the same item.
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ],
    )?;

    // Hands the submenu to NSApp so AppKit appends and maintains the live window
    // list below our items. Without this the Window menu is a static stub.
    #[cfg(target_os = "macos")]
    window_menu.set_as_windows_menu_for_nsapp()?;

    Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )
}

/// Route a custom item to the window it was meant for.
///
/// New Window is handled here rather than emitted, because a window is a native
/// object and no webview needs to be told about it.
///
/// Everything else is an instruction to exactly one session table, so it goes to
/// the focused window. This used to name `main` explicitly, which was correct
/// only while `main` was the only window there was: with a second window open,
/// ⌘T in it would have opened a session in the *first* window, and ⌘W would have
/// closed a session the user could not see. Emitting app-wide is equally wrong
/// in the other direction — every window would act on it, so one ⌘T would open
/// as many sessions as there are windows.
///
/// "New Session with Profile", one item per saved preset.
///
/// The default profile leads and is labelled as such, because it is the one ⌘T
/// already opens — showing it first makes the submenu a superset of what the
/// accelerator does rather than a competing list. The rest keep the order they
/// were defined in, which is the order the settings pane shows them.
///
/// No accelerators: there are as many items as the user has profiles, so any
/// scheme would run out or collide with a chord that already means something.
/// ⌘T stays the one keyboard path to a new session.
fn profile_submenu<R: Runtime>(
    app: &AppHandle<R>,
    profiles: &[ProfileSummary],
) -> tauri::Result<Submenu<R>> {
    let submenu = Submenu::new(app, "New Session with Profile", true)?;

    let mut ordered: Vec<&ProfileSummary> = profiles.iter().collect();
    ordered.sort_by_key(|p| !p.is_default);

    for profile in ordered {
        let label = if profile.is_default {
            format!("{} (Default)", profile.name)
        } else {
            profile.name.clone()
        };
        submenu.append(&MenuItem::with_id(
            app,
            format!("{ID_PROFILE_PREFIX}{}", profile.id),
            label,
            true,
            None::<&str>,
        )?)?;
    }

    Ok(submenu)
}

/// Send a menu event to the window the user is actually looking at.
///
/// Dropped with a log line when nothing is focused: picking an arbitrary window
/// would open or close a session somewhere the user cannot see.
fn emit_to_focused<R: Runtime>(app: &AppHandle<R>, event: &str, payload: Option<String>) {
    let Some(window) = focused(app) else {
        eprintln!("trmnl: dropped {event}, no focused window");
        return;
    };
    if let Err(e) = window.emit(event, payload) {
        eprintln!("trmnl: could not emit {event}: {e}");
    }
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    // A profile item carries its profile's id, so it routes like New Session but
    // with a payload naming which preset to open.
    if let Some(profile_id) = id.strip_prefix(ID_PROFILE_PREFIX) {
        emit_to_focused(app, EVENT_NEW_SESSION, Some(profile_id.to_string()));
        return;
    }

    if id == ID_NEW_WINDOW {
        // Cascade from the focused window so the new one lands just below and to
        // the right of the window the user was actually looking at.
        let from = focused(app);
        if let Err(e) = crate::window::open(app, from.as_ref()) {
            eprintln!("trmnl: could not open a new window: {e}");
        }
        return;
    }

    let event = match id {
        ID_SETTINGS => EVENT_SETTINGS,
        ID_NEW_SESSION => EVENT_NEW_SESSION,
        ID_CLOSE_SESSION => EVENT_CLOSE_SESSION,
        // Predefined items never reach here; anything else is a menu id we
        // added and forgot to wire, which is worth a line in the log.
        other => {
            eprintln!("trmnl: unhandled menu item '{other}'");
            return;
        }
    };

    // No profile: the frontend falls back to the default, exactly as ⌘T does.
    emit_to_focused(app, event, None);
}

/// The window the user is working in.
///
/// `Manager::get_focused_window` would be the obvious call, but it is behind
/// Tauri's `unstable` feature and returns a `Window` rather than the
/// `WebviewWindow` needed to emit — so the search is done here instead, over the
/// same map for the same result.
///
/// Falling back to `main` covers the window that AppKit leaves in a menu-bar app
/// when a menu is open but no window has key status. When even `main` is gone —
/// it can be closed like any other window now — there is nothing to fall back
/// to, and the caller decides what that means.
fn focused<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .cloned()
        .or_else(|| windows.get("main").cloned())
}
