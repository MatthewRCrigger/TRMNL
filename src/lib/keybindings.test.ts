import { describe, expect, it } from 'vitest'

import {
  DEFAULT_KEYBINDINGS,
  findCollision,
  formatChord,
  resolveKeybindings,
  sanitizeKeybindingOverrides,
} from './keybindings'

describe('formatChord', () => {
  it('renders a plain letter with its modifiers', () => {
    const chord = formatChord({ ctrlKey: false, altKey: false, shiftKey: true, metaKey: true, key: 'm' })
    expect(chord).toBe('⇧⌘M')
  })

  it('normalises modifier order regardless of the event field order', () => {
    // Physically holding ⇧ before ⌘ or the reverse must compare equal.
    const a = formatChord({ ctrlKey: false, altKey: false, shiftKey: true, metaKey: true, key: 'd' })
    const b = formatChord({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: true, key: 'D' })
    expect(a).toBe('⇧⌘D')
    expect(b).toBe('⌥⌘D')
  })

  it('renders known glyph keys', () => {
    expect(
      formatChord({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: true, key: 'ArrowLeft' }),
    ).toBe('⌥⌘←')
    expect(
      formatChord({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: 'l' }),
    ).toBe('⌃L')
  })

  it('returns null for a bare modifier keypress', () => {
    expect(
      formatChord({ ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, key: 'Shift' }),
    ).toBeNull()
    expect(
      formatChord({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: true, key: 'Meta' }),
    ).toBeNull()
  })
})

describe('sanitizeKeybindingOverrides', () => {
  it('drops unknown action ids', () => {
    expect(sanitizeKeybindingOverrides({ palette: '⌘P', notAnAction: '⌘Z' })).toEqual({
      palette: '⌘P',
    })
  })

  it('drops non-string chord values', () => {
    expect(sanitizeKeybindingOverrides({ palette: 42, 'split-right': null })).toEqual({})
  })

  it('drops an empty string chord', () => {
    expect(sanitizeKeybindingOverrides({ palette: '' })).toEqual({})
  })

  it('returns an empty object for garbage input', () => {
    expect(sanitizeKeybindingOverrides(undefined)).toEqual({})
    expect(sanitizeKeybindingOverrides('not an object')).toEqual({})
    expect(sanitizeKeybindingOverrides(null)).toEqual({})
  })
})

describe('resolveKeybindings', () => {
  it('falls back to the shipped defaults with no overrides', () => {
    expect(resolveKeybindings(undefined)).toEqual(DEFAULT_KEYBINDINGS)
  })

  it('overlays a valid override on top of the defaults', () => {
    const resolved = resolveKeybindings({ palette: '⌘P' })
    expect(resolved.palette).toBe('⌘P')
    expect(resolved['split-right']).toBe(DEFAULT_KEYBINDINGS['split-right'])
  })
})

describe('findCollision', () => {
  it('finds no collision for a chord nothing else uses', () => {
    expect(findCollision('⌘⇧Z', DEFAULT_KEYBINDINGS, 'palette')).toBeNull()
  })

  it('reports the other action already holding the chord', () => {
    expect(findCollision(DEFAULT_KEYBINDINGS['split-right']!, DEFAULT_KEYBINDINGS, 'palette')).toEqual({
      action: 'split-right',
    })
  })

  it('does not collide with the action’s own current chord', () => {
    // Rebinding palette to the chord it already holds is a no-op, not a fight
    // with itself.
    expect(findCollision(DEFAULT_KEYBINDINGS.palette!, DEFAULT_KEYBINDINGS, 'palette')).toBeNull()
  })

  it('reports the reserved ⌃C chord distinctly from an action collision', () => {
    expect(findCollision('⌃C', DEFAULT_KEYBINDINGS, 'palette')).toEqual({ reserved: true })
  })
})
