/**
 * Per-session registry of "what's interactive right now" inside a takeover
 * terminal — the hovered link (if any) and a way to read the current
 * selection. Outside the store, matching how `ptys` in state/store.ts is kept
 * module-level rather than in Zustand: this is imperative xterm.js state, not
 * serialisable app state, and re-rendering React on every mouse-move over the
 * terminal would be its own bug.
 *
 * ContextMenu.tsx has no reference to any particular TerminalView instance —
 * it is one global right-click listener — so it reads this registry instead,
 * keyed by the session id carried on the `.termview` element's own dataset.
 */

interface TakeoverLinkState {
  hoveredUrl: string | null
  getSelection: () => string
}

const registry = new Map<string, TakeoverLinkState>()

/** Called by TerminalView on mount; returns the disposer for unmount. */
export function registerTakeoverLinks(sessionId: string, state: TakeoverLinkState): () => void {
  registry.set(sessionId, state)
  return () => {
    // Only clear if this registration is still the current one — a fast
    // remount (pane split, session swap) could otherwise have the outgoing
    // instance's cleanup delete the incoming one's entry.
    if (registry.get(sessionId) === state) registry.delete(sessionId)
  }
}

export function getTakeoverLinkState(sessionId: string): TakeoverLinkState | undefined {
  return registry.get(sessionId)
}
