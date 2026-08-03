/** Which window this webview is, and what belongs to it alone.
 *
 * Every window runs its own copy of the store, so anything the store treats as
 * global is really per-window and has to be keyed by the window's label. Three
 * things were global and silently wrong the moment a second window existed:
 * session ids (a module counter, so two windows both start at `s1` and collide
 * in the process-wide PtyManager), the persisted workspace (one key, so two
 * windows race and the last write wins), and the `pty://` event stream. The
 * first two are fixed here; the third is fixed natively in pty.rs by emitting to
 * the owning window.
 *
 * The label comes from Tauri and is stable for the window's lifetime — it
 * survives a reload, which is exactly what lets a reloaded page find the
 * sessions it owned before.
 */

import { getCurrentWindow } from '@tauri-apps/api/window'

/** The main window's label, as declared in tauri.conf.json. */
export const MAIN_WINDOW = 'main'

/**
 * This window's label, resolved once at module load.
 *
 * Read eagerly rather than awaited at each call site: the label is needed
 * synchronously by the id generator, and `getCurrentWindow` is a local handle
 * rather than an IPC call, so there is nothing to wait for. Outside a Tauri
 * webview (vitest) it throws, and the fallback keeps the module importable so
 * the pure helpers below stay testable.
 */
export const windowLabel: string = (() => {
  try {
    return getCurrentWindow().label
  } catch {
    return MAIN_WINDOW
  }
})()

/** True when this webview is the window Tauri created at launch. */
export function isMainWindow(label: string = windowLabel): boolean {
  return label === MAIN_WINDOW
}

/**
 * The config key holding a window's persisted workspace.
 *
 * The main window keeps the bare `workspace` key it has always used, so an
 * existing config restores unchanged rather than opening to an empty window on
 * first launch after upgrading. Additional windows get a suffixed key.
 */
export function workspaceKey(label: string = windowLabel): string {
  return isMainWindow(label) ? 'workspace' : `workspace:${label}`
}

/**
 * Build a session-id generator scoped to one window.
 *
 * The id has to be unique across the whole process, not just this window: the
 * PtyManager is one map keyed by id, and `pty_spawn` rejects a duplicate. The
 * window label is the only thing guaranteed distinct between windows, so it goes
 * in the id. The counter keeps ids ordered within a window, which `pty_adopt`
 * relies on to hand sessions back in the order they were created.
 */
export function createSessionIds(label: string = windowLabel): () => string {
  let counter = 0
  // Zero-padded so lexical order matches creation order: `s10` must sort after
  // `s9`, and `pty_adopt` sorts ids as strings to restore that order.
  return () => `${label}:s${String(++counter).padStart(4, '0')}`
}

/**
 * The window that owns a session id, or null if the id predates this scheme.
 *
 * Used to sanity-check an adopted id before trusting it: a session whose label
 * does not match this window is one the native side should never have handed
 * over, and adopting it would attach this window's UI to another's shell.
 */
export function ownerOf(sessionId: string): string | null {
  const separator = sessionId.lastIndexOf(':s')
  return separator === -1 ? null : sessionId.slice(0, separator)
}
