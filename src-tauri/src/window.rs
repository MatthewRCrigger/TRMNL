//! Creating additional windows.
//!
//! The main window is declared in tauri.conf.json; every window after it is
//! built here, and the two have to agree. A window built with the defaults would
//! look nothing like the configured one — opaque, with a standard title bar and
//! a light theme — so the chrome settings are mirrored below rather than
//! inherited. Tauri has no "clone the configured window" builder, so the price of
//! a second window is keeping these in sync with the config by hand; the
//! constants carry that warning.
//!
//! Windows are built natively rather than from the frontend because the label
//! has to be unique across the process, and only the native side can see every
//! window that already exists. A webview asking for `win-3` cannot know whether
//! another webview asked for it first.

use tauri::window::Color;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The main window's chrome, mirrored from `app.windows[0]` in tauri.conf.json.
///
/// Changing any of these in the config without changing it here gives the second
/// window a different look from the first — the kind of bug that only shows up
/// once someone opens a second window, which is exactly the class of bug this
/// whole change exists to fix. `transparent`, `hiddenTitle`, `titleBarStyle` and
/// `theme` are mirrored inline at their builder calls below.
mod conf {
    /// Not the live title — the frontend overwrites this per window as soon as it
    /// boots (see `useWindowTitle` in App.tsx). It is what the window is called
    /// for the moment before that, so it should match the config's.
    pub const TITLE: &str = "CRGGR.sh";
    pub const WIDTH: f64 = 1400.0;
    pub const HEIGHT: f64 = 900.0;
    pub const MIN_WIDTH: f64 = 620.0;
    pub const MIN_HEIGHT: f64 = 420.0;
    /// `#07090d`. Painted behind the webview so a window that has not rendered
    /// yet is the app's own near-black rather than a white flash.
    pub const BACKGROUND: super::Color = super::Color(0x07, 0x09, 0x0d, 0xff);
}

/// Prefix for every window after the first.
///
/// The main window keeps the bare label `main` that tauri.conf.json gives it,
/// and the frontend treats that label specially — it is what `workspaceKey` in
/// windowIdentity.ts uses to decide that this window owns the original bare
/// `workspace` config key. A new window must therefore never be labelled `main`,
/// and the prefix also lets the capability file match every window with one glob
/// (`win-*`) instead of enumerating labels it cannot know in advance.
const LABEL_PREFIX: &str = "win-";

/// Pixels each new window is offset from the last, down and to the right.
///
/// Without this a second window lands exactly on the first and looks like
/// nothing happened — the user sees the same window they were already looking
/// at. macOS cascades new document windows for the same reason.
const CASCADE_STEP: f64 = 28.0;

/// Open a new window, matching the main window's configuration.
///
/// The `from` window, when there is one, is only used to place the new window
/// relative to it. Position is best-effort: a window that cannot be located
/// still opens, just at the platform's default spot.
pub fn open<R: Runtime>(app: &AppHandle<R>, from: Option<&WebviewWindow<R>>) -> tauri::Result<()> {
    let label = next_label(app);

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title(conf::TITLE)
        .inner_size(conf::WIDTH, conf::HEIGHT)
        .min_inner_size(conf::MIN_WIDTH, conf::MIN_HEIGHT)
        .transparent(true)
        .background_color(conf::BACKGROUND)
        .theme(Some(tauri::Theme::Dark));

    // macOS-only chrome. The overlay title bar plus a hidden title is what gives
    // the app its inset traffic lights over the webview's own header, and
    // `accept_first_mouse` is why a click into an unfocused window both focuses
    // it and lands on whatever was under the pointer — without it the first
    // click into a background window is swallowed, which in a terminal means a
    // click that should have placed the cursor does nothing.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .accept_first_mouse(true);
    }

    if let Some((x, y)) = cascade_from(from) {
        builder = builder.position(x, y);
    }

    builder.build()?;
    Ok(())
}

/// The next free `win-N` label.
///
/// Derived by scanning the live windows rather than by bumping a counter in app
/// state, because a counter and reality drift apart: close `win-2` and `win-3`
/// and a counter still hands out `win-4`, while the label `win-2` is free and a
/// stored counter would have to be reset by something. More to the point, a
/// counter can be wrong in the direction that matters — `build` fails outright
/// on a label that is already taken — whereas a scan cannot collide, because the
/// set it checks against is the set the label has to be unique within.
///
/// Numbering starts at 2 so the labels read as "the second window", the main
/// window being the first.
fn next_label<R: Runtime>(app: &AppHandle<R>) -> String {
    let taken = app.webview_windows();
    (2..)
        .map(|n| format!("{LABEL_PREFIX}{n}"))
        .find(|label| !taken.contains_key(label))
        .expect("an unbounded range always yields a free label")
}

/// Where to put a new window, offset from the one it was opened from.
///
/// Returns `None` when there is nothing to offset from, or when the source
/// window's position cannot be read — placement is cosmetic, and a window that
/// opens at the default position is far better than one that fails to open.
fn cascade_from<R: Runtime>(from: Option<&WebviewWindow<R>>) -> Option<(f64, f64)> {
    let window = from?;
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    Some((position.x + CASCADE_STEP, position.y + CASCADE_STEP))
}
