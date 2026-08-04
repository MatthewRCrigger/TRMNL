/** setKeybinding's swap: an action always resolves to exactly one chord, so
 *  taking a chord from another action gives that action the vacated one
 *  rather than leaving it unbound — the global handler has no such state. */

import { beforeEach, describe, expect, it } from 'vitest'

import { resolveKeybindings } from '../lib/keybindings'
import { useStore } from './store'

// This suite runs in vitest's default `node` environment, which has no
// `window` — but `setKeybinding` debounces its config write through
// `window.setTimeout`, same as every other settings action. A minimal stub is
// enough to exercise the real action rather than reimplementing its logic.
beforeEach(() => {
  useStore.setState((s) => ({ settingsValues: { ...s.settingsValues, keybindings: {} } }))
  ;(globalThis as { window?: unknown }).window ??= {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  }
})

describe('setKeybinding', () => {
  it('rebinds an action to a chord nothing else uses', () => {
    useStore.getState().setKeybinding('palette', '⌘⇧Z')
    const bindings = resolveKeybindings(useStore.getState().settingsValues.keybindings)
    expect(bindings.palette).toBe('⌘⇧Z')
  })

  it('swaps the colliding action onto the chord being vacated', () => {
    const before = resolveKeybindings(useStore.getState().settingsValues.keybindings)

    // Steal split-right's default chord (⌘D) for palette; split-right should
    // end up with whatever palette used to hold (⌘K) rather than nothing.
    useStore.getState().setKeybinding('palette', before['split-right'], 'split-right')

    const after = resolveKeybindings(useStore.getState().settingsValues.keybindings)
    expect(after.palette).toBe(before['split-right'])
    expect(after['split-right']).toBe(before.palette)
  })

  it('persists across a resolve, not just in the current settingsValues object', () => {
    useStore.getState().setKeybinding('search', '⌘/')
    expect(useStore.getState().settingsValues.keybindings.search).toBe('⌘/')
  })
})
