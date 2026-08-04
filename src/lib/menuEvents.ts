/** Native menu items → store actions.
 *
 * The macOS menu bar owns the accelerators for these three (see menu.rs): a
 * native item with a key equivalent consumes the chord in AppKit, before the
 * webview dispatches any keydown. So ⌘,/⌘T/⌘W no longer arrive at the global
 * keydown handler in App.tsx at all — this module is now the only path to
 * these actions, whether the user picks the item or presses the chord.
 *
 * Each handler is the exact body those chords used to run, so behaviour is
 * unchanged and there is one implementation rather than two that can drift.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import { useStore } from '../state/store'

/**
 * Subscribe to the menu events. Returns a disposer.
 *
 * `listen` is async, so a caller that unsubscribes before the listeners are
 * registered would otherwise leak them — the `disposed` latch makes the
 * disposer safe to call at any point in that window.
 */
export function listenForMenuEvents(): () => void {
  let disposed = false
  const unlisten: UnlistenFn[] = []

  const register = async <T = null>(event: string, run: (payload: T) => void) => {
    const un = await listen<T>(event, (e) => run(e.payload))
    if (disposed) un()
    else unlisten.push(un)
  }

  void register('menu://settings', () => {
    const store = useStore.getState()
    // Toggle, not open: the menu item is the same affordance as ⌘, was, and
    // pressing it twice should put you back where you started.
    if (store.settings.open) store.closeSettings()
    else store.openSettings()
  })

  // Carries a profile id when the click came from the profile submenu, and null
  // from plain New Session — `newSession` treats undefined as "use the default",
  // which is what ⌘T has always done.
  void register<string | null>('menu://new-session', (profileId) => {
    void useStore.getState().newSession(profileId ?? undefined)
  })

  void register('menu://close-session', () => {
    const store = useStore.getState()
    // Split: close the pane. Solo: close the session — otherwise Close Session
    // would do nothing at all in the common case.
    if (store.split) {
      store.closePane()
    } else {
      const id = store.activeSessionId()
      if (id) void store.closeSession(id)
    }
  })

  return () => {
    disposed = true
    for (const un of unlisten) un()
    unlisten.length = 0
  }
}
