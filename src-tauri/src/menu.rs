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
//! window operations. The app is a single window whose session table lives
//! entirely in the webview (see `pty_kill_all` in lib.rs for what that costs
//! us), so a native "close window" would take the whole app down with every
//! session in it. The menu items therefore route to exactly the store actions
//! ⌘T and ⌘W already call, and the accelerators are declared here so the native
//! menu owns them — a menu item with an accelerator swallows the chord before
//! the webview's keydown listener ever sees it, so declaring them in both
//! places would be double-firing, not redundancy.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Menu ids for the custom items. Constants rather than literals because the id
/// is written at construction and read again in the event handler, and a typo
/// between the two is a silently dead menu item.
const ID_SETTINGS: &str = "settings";
const ID_NEW_SESSION: &str = "new-session";
const ID_CLOSE_SESSION: &str = "close-session";

/// Events the frontend listens for. Namespaced like `pty://…` so a menu event
/// is recognisable at the listener side.
const EVENT_SETTINGS: &str = "menu://settings";
const EVENT_NEW_SESSION: &str = "menu://new-session";
const EVENT_CLOSE_SESSION: &str = "menu://close-session";

/// Build the app menu.
///
/// Deliberately absent:
///
/// - **New Window.** The PTY manager is process-wide but the session table is
///   per-webview, so a second window would need an ownership model that does
///   not exist yet. Deferred rather than half-built.
/// - **Reload.** A reload discards the session table while the shells keep
///   running, which is the exact failure `pty_kill_all` exists to contain: the
///   new page reaps every previous shell at boot, so ⌘R would silently kill
///   every running command in the app. The stock WebKit context menu already
///   had its Reload removed for this reason; putting one back in the menu bar
///   with a first-class accelerator would be strictly worse.
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

    // ⌘T rather than the Terminal.app-ish ⌘N: a session is a tab in the rail,
    // not a window, and ⌘T is what the frontend has always bound.
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
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

/// Route a custom item to the frontend.
///
/// Emitted to the main window specifically rather than app-wide: these are
/// instructions to one session table, and an app-wide emit would become a
/// double-fire the moment a second window exists.
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
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

    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.emit(event, ()) {
            eprintln!("trmnl: could not emit {event}: {e}");
        }
    }
}
