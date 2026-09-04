/** Settings are read from an untrusted on-disk blob, so the loader is where a
 * stale or hand-edited config has to be made safe. */

import { describe, expect, it } from 'vitest'

import { DEFAULT_PANEL, pickSettings } from './store'

describe('pickSettings', () => {
  it('drops settings that no longer exist', () => {
    // A config written before the identity system, glow and scanlines were
    // removed. Spreading it would carry those keys back into the next save.
    const s = pickSettings({
      identityName: 'PROGRAM',
      accent: 'oklch(0.75 0.18 195)',
      intensity: 1.4,
      glow: 'balanced',
      scanlines: true,
      bootSequence: true,
      commandAccents: [{ id: 'a', match: 'x', label: 'X', color: 'red', enabled: true }],
    } as never)

    expect(Object.keys(s).sort()).toEqual([
      'density',
      'foldThreshold',
      'ghostSource',
      'keybindings',
      'panel',
      'renderers',
      'restoreOnLaunch',
      'scrollbackCap',
    ])

    for (const gone of [
      'accent',
      'identityName',
      'intensity',
      'glow',
      'scanlines',
      'bootSequence',
      'commandAccents',
    ]) {
      expect(gone in s).toBe(false)
    }
  })

  it('clamps the fold threshold to its range', () => {
    expect(pickSettings({ foldThreshold: 900 } as never).foldThreshold).toBe(60)
    expect(pickSettings({ foldThreshold: -5 } as never).foldThreshold).toBe(3)
    expect(pickSettings({ foldThreshold: 12 } as never).foldThreshold).toBe(12)
  })

  it('rejects out-of-band enum values', () => {
    expect(pickSettings({ density: 'huge' } as never).density).toBe('normal')
    expect(pickSettings({ ghostSource: 'psychic' } as never).ghostSource).toBe('scripts')
  })

  it('merges renderer toggles over the defaults', () => {
    const s = pickSettings({ renderers: { git: false } } as never)
    expect(s.renderers).toEqual({
      build: true,
      git: false,
      serve: true,
      err: true,
      list: true,
      test: true,
    })
  })

  it('ignores a non-boolean restoreOnLaunch', () => {
    expect(pickSettings({ restoreOnLaunch: 'yes' } as never).restoreOnLaunch).toBe(true)
  })

  it('ignores a nonsensical scrollback cap', () => {
    expect(pickSettings({ scrollbackCap: 0 } as never).scrollbackCap).toBe(10_000)
    expect(pickSettings({ scrollbackCap: 500 } as never).scrollbackCap).toBe(500)
  })
})

describe('pickSettings: the panel block', () => {
  it('ships the applied token set, not the GRID defaults', () => {
    // tokens.applied.json overrides four rows, and those four are the whole
    // visual character of the build. Round in particular is a deliberate
    // override of DESIGN_GUIDE.md, not an error to correct.
    const { panel } = pickSettings(undefined)
    expect(panel.borderWidth).toBe(2)
    expect(panel.cornerStyle).toBe('round')
    expect(panel.frameGap).toBe(4)
    expect(panel.headingSize).toBe(14)
  })

  it('falls back wholesale when the block is absent', () => {
    expect(pickSettings({} as never).panel).toEqual(DEFAULT_PANEL)
  })

  it('clamps a number rather than rejecting the whole block', () => {
    // Geometry has a sensible nearest neighbour, where a rejected block would
    // discard three good fields alongside one bad one.
    const { panel } = pickSettings({
      panel: { borderWidth: 99, frameGap: -4, headingSize: 8, cornerStyle: 'sharp' },
    } as never)
    expect(panel.borderWidth).toBe(4)
    expect(panel.frameGap).toBe(0)
    expect(panel.cornerStyle).toBe('sharp')
    // 12px is the type floor; nothing in the system goes below it.
    expect(panel.headingSize).toBe(12)
  })

  it('keeps a hand-edited value that is already in range', () => {
    const { panel } = pickSettings({ panel: { borderWidth: 1, frameGap: 6 } } as never)
    expect(panel.borderWidth).toBe(1)
    expect(panel.frameGap).toBe(6)
    // Untouched fields still come from the applied set.
    expect(panel.headingSize).toBe(DEFAULT_PANEL.headingSize)
  })

  it('falls back for a non-numeric or NaN measurement', () => {
    const { panel } = pickSettings({
      panel: { borderWidth: 'thick', frameGap: NaN },
    } as never)
    expect(panel.borderWidth).toBe(DEFAULT_PANEL.borderWidth)
    expect(panel.frameGap).toBe(DEFAULT_PANEL.frameGap)
  })

  it('treats an unknown corner style as round rather than sharp', () => {
    // Only the literal 'sharp' opts out. Anything else is a typo, and the
    // applied default is what the project actually ships.
    expect(pickSettings({ panel: { cornerStyle: 'bevelled' } } as never).panel.cornerStyle).toBe(
      'round',
    )
  })

  it('respects an explicitly disabled toggle', () => {
    const { panel } = pickSettings({
      panel: { panelBorder: false, headerFilled: false },
    } as never)
    expect(panel.panelBorder).toBe(false)
    expect(panel.headerFilled).toBe(false)
    expect(panel.headerBorder).toBe(true)
  })

  it('ignores a non-boolean toggle', () => {
    expect(pickSettings({ panel: { contentBorder: 'yes' } } as never).panel.contentBorder).toBe(true)
  })
})
