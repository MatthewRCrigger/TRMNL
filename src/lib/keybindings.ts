/** Remappable chords — the JS-handled subset only.
 *
 * ⌘,/⌘T/⌘W are absent on purpose: AppKit's native menu declares them as key
 * equivalents and consumes the chord before the webview ever sees a keydown
 * (see `lib/menuEvents.ts`), so a JS-side editor cannot remap them without also
 * rewriting the Rust menu definition. ⌃C is absent too — it cancels the running
 * command and is permanent, never shown as remappable in Settings.
 *
 * ⇥ (accept ghost suggestion) is also absent: it lives in Composer.tsx's own
 * keydown handler, not this module's, and doubles as the TAB-completion
 * fallback with a browser-focus workaround that assumes the literal Tab key.
 * Remapping it would need to carry that special-casing to an arbitrary key,
 * which is separate plumbing from the single global handler every other
 * action here goes through — out of scope for this pass. It is still shown in
 * Settings, as a fixed row alongside ⌃C.
 */

export type ActionId =
  | 'palette'
  | 'split-right'
  | 'split-down'
  | 'search'
  | 'prev-block'
  | 'next-block'
  | 'maximize-pane'
  | 'focus-left'
  | 'focus-right'
  | 'clear-buffer'

export interface ActionInfo {
  id: ActionId
  label: string
}

/** Display order for the Settings pane, and the source of truth for labels. */
export const ACTIONS: ActionInfo[] = [
  { id: 'palette', label: 'Command palette' },
  { id: 'split-right', label: 'Split right' },
  { id: 'split-down', label: 'Split down' },
  { id: 'search', label: 'Search scrollback' },
  { id: 'prev-block', label: 'Previous block' },
  { id: 'next-block', label: 'Next block' },
  { id: 'maximize-pane', label: 'Maximize / restore focused pane' },
  { id: 'focus-left', label: 'Focus left pane' },
  { id: 'focus-right', label: 'Focus right pane' },
  { id: 'clear-buffer', label: 'Clear buffer' },
]

/** Shipped defaults, in the same chord notation `formatChord` produces. */
export const DEFAULT_KEYBINDINGS: Record<ActionId, string> = {
  palette: '⌘K',
  'split-right': '⌘D',
  'split-down': '⌘⇧D',
  search: '⌘⇧F',
  'prev-block': '⌘[',
  'next-block': '⌘]',
  'maximize-pane': '⌘⇧M',
  'focus-left': '⌘⌥←',
  'focus-right': '⌘⌥→',
  'clear-buffer': '⌃L',
}

/** A chord no user override may ever claim: ⌃C is permanent. */
export const RESERVED_CHORD = '⌃C'

export type KeybindingOverrides = Partial<Record<ActionId, string>>

/** Drop unknown action ids and non-string chords, so a hand-edited config
 *  cannot wedge the keymap with a malformed override. */
export function sanitizeKeybindingOverrides(
  overrides: unknown,
): KeybindingOverrides {
  const known = new Set(ACTIONS.map((a) => a.id))
  const clean: KeybindingOverrides = {}
  if (overrides && typeof overrides === 'object') {
    for (const [id, chord] of Object.entries(overrides as Record<string, unknown>)) {
      if (known.has(id as ActionId) && typeof chord === 'string' && chord) {
        clean[id as ActionId] = chord
      }
    }
  }
  return clean
}

/** Merge sanitized overrides over the shipped defaults. */
export function resolveKeybindings(
  overrides: KeybindingOverrides | undefined,
): Record<ActionId, string> {
  return { ...DEFAULT_KEYBINDINGS, ...sanitizeKeybindingOverrides(overrides) }
}

/**
 * Render a keydown event as the same chord notation the defaults use, e.g.
 * `⌘⇧M`, `⌃L`, `⇥`.
 *
 * Order is fixed (⌃⌥⇧⌘, then the key) so a captured chord always compares
 * equal to a stored one regardless of the order modifiers were physically
 * held down in.
 */
export function formatChord(event: {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  key: string
}): string | null {
  const key = displayKey(event.key)
  if (key === null) return null // A bare modifier is not a chord on its own.

  let chord = ''
  if (event.ctrlKey) chord += '⌃'
  if (event.altKey) chord += '⌥'
  if (event.shiftKey) chord += '⇧'
  if (event.metaKey) chord += '⌘'
  return chord + key
}

const KEY_GLYPHS: Record<string, string> = {
  tab: '⇥',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  escape: 'Esc',
  ' ': 'Space',
}

const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta'])

/** The non-modifier key part of a chord, in the notation the defaults use, or
 *  null for a bare modifier keypress — which is not a complete chord yet. */
function displayKey(key: string): string | null {
  const lower = key.toLowerCase()
  if (MODIFIER_KEYS.has(lower)) return null
  if (lower in KEY_GLYPHS) return KEY_GLYPHS[lower]!
  return key.length === 1 ? key.toUpperCase() : key
}

/**
 * Which action (if any) already owns this chord, other than `exclude`.
 *
 * ⌃C is checked first and reported as `null` action id via the reserved flag,
 * since it has no `ActionId` of its own but must still block the assignment.
 */
export function findCollision(
  chord: string,
  bindings: Record<ActionId, string>,
  exclude: ActionId,
): { action: ActionId } | { reserved: true } | null {
  if (chord === RESERVED_CHORD) return { reserved: true }
  for (const [id, bound] of Object.entries(bindings)) {
    if (id === exclude) continue
    if (bound === chord) return { action: id as ActionId }
  }
  return null
}
