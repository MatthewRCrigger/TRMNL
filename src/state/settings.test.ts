/** Settings are read from an untrusted on-disk blob, so the loader is where a
 * stale or hand-edited config has to be made safe. */

import { describe, expect, it } from 'vitest'

import { DEFAULT_IDENTITY, IDENTITIES, pickSettings, profileAccent, type Profile } from './store'

describe('pickSettings', () => {
  it('defaults to the USER identity', () => {
    const s = pickSettings(undefined)
    expect(s.identityName).toBe('USER')
    expect(s.accent).toBe(DEFAULT_IDENTITY.value)
  })

  it('drops settings that no longer exist', () => {
    // A config written before glow and scanlines were removed. Spreading it
    // would carry those keys back into the next save.
    const s = pickSettings({
      identityName: 'PROGRAM',
      glow: 'balanced',
      scanlines: true,
    } as never)

    expect(Object.keys(s).sort()).toEqual([
      'accent',
      'bootSequence',
      'commandAccents',
      'density',
      'foldThreshold',
      'ghostSource',
      'identityName',
      'keybindings',
      'renderers',
      'restoreOnLaunch',
      'scrollbackCap',
    ])
    expect('glow' in s).toBe(false)
    expect('scanlines' in s).toBe(false)
  })

  it('keeps a valid stored identity rather than forcing the default', () => {
    const s = pickSettings({ identityName: 'ARES' } as never)
    expect(s.identityName).toBe('ARES')
    // The accent is re-derived from the identity, never trusted from the file.
    expect(s.accent).toBe(IDENTITIES.find((i) => i.name === 'ARES')!.value)
  })

  it('falls back when the stored identity is unknown', () => {
    const s = pickSettings({ identityName: 'FLYNN', accent: 'red' } as never)
    expect(s.identityName).toBe('USER')
    expect(s.accent).toBe(DEFAULT_IDENTITY.value)
  })

  it('ignores an accent that does not belong to an identity', () => {
    // Otherwise a hand-edited file could leave the UI an unusable colour.
    const s = pickSettings({ identityName: 'USER', accent: 'chartreuse' } as never)
    expect(s.accent).toBe(DEFAULT_IDENTITY.value)
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

  it('defaults the boot sequence on, and rejects a non-boolean', () => {
    expect(pickSettings(undefined).bootSequence).toBe(true)
    expect(pickSettings({ bootSequence: false } as never).bootSequence).toBe(false)
    expect(pickSettings({ bootSequence: 'yes' } as never).bootSequence).toBe(true)
  })

  it('ignores a nonsensical scrollback cap', () => {
    expect(pickSettings({ scrollbackCap: 0 } as never).scrollbackCap).toBe(10_000)
    expect(pickSettings({ scrollbackCap: 500 } as never).scrollbackCap).toBe(500)
  })
})

describe('identity defaults', () => {
  it('keeps the CSS fallback and the store default in agreement', () => {
    // tokens.css sets --ac before React hydrates; a mismatch would show as a
    // colour flash on launch.
    expect(DEFAULT_IDENTITY.value).toBe('oklch(0.93 0.045 220)')
  })

  it('offers the five identities, CLU carrying the gold', () => {
    expect(IDENTITIES.map((i) => i.name)).toEqual(['PROGRAM', 'ISO', 'USER', 'ARES', 'CLU'])
    expect(IDENTITIES.find((i) => i.name === 'CLU')!.value).toBe('oklch(0.85 0.18 90)')
  })

  it('no longer offers the retired orange', () => {
    expect(IDENTITIES.some((i) => i.value === 'oklch(0.75 0.2 55)')).toBe(false)
    expect(IDENTITIES.some((i) => i.name === 'ATHENA')).toBe(false)
  })

  it('falls back to USER for a config that stored ATHENA', () => {
    const s = pickSettings({ identityName: 'ATHENA' } as never)
    expect(s.identityName).toBe('USER')
  })
})

describe('pickSettings: command accents', () => {
  it('falls back to the shipped defaults when absent', () => {
    expect(pickSettings(undefined).commandAccents.length).toBeGreaterThan(0)
  })

  it('respects an explicitly empty list', () => {
    // Present-but-empty is a deliberate "I turned them all off", not missing data.
    expect(pickSettings({ commandAccents: [] } as never).commandAccents).toEqual([])
  })

  it('drops a rule whose colour would break the theme', () => {
    // A malformed colour propagates through every color-mix token, so the row is
    // discarded rather than allowed through.
    const s = pickSettings({
      commandAccents: [
        { id: 'a', match: 'ok', label: 'Fine', color: 'oklch(0.7 0.1 200)', enabled: true },
        { id: 'b', match: 'bad', label: 'Broken', color: 'not-a-color', enabled: true },
      ],
    } as never)
    expect(s.commandAccents.map((r) => r.id)).toEqual(['a'])
  })

  it('drops structurally invalid rows', () => {
    const s = pickSettings({
      commandAccents: [
        { id: 'a', match: 'ok', label: 'Fine', color: 'oklch(0.7 0.1 200)', enabled: true },
        { id: 'c', match: 'x', label: 'NoEnabled', color: 'oklch(0.7 0.1 200)' },
        null,
      ],
    } as never)
    expect(s.commandAccents.map((r) => r.id)).toEqual(['a'])
  })
})

describe('profileAccent', () => {
  const profile = (over: Partial<Profile> = {}): Profile => ({
    id: 'p1',
    name: 'client',
    cwd: '~',
    shell: '/bin/zsh',
    connectVia: 'local',
    startupCmd: '',
    env: [],
    ...over,
  })

  it('returns the profile colour so one client reads as one colour', () => {
    const colour = 'oklch(0.75 0.18 152)'
    expect(profileAccent([profile({ accent: colour })], 'p1')).toBe(colour)
  })

  it('inherits the global identity when the profile sets no colour', () => {
    // Null is "no override", which is what leaves --ac on settings.accent.
    expect(profileAccent([profile()], 'p1')).toBeNull()
  })

  it('inherits when the session has no profile at all', () => {
    // An adopted session after a reload: the profile that spawned it is gone.
    expect(profileAccent([profile({ accent: 'oklch(0.75 0.18 152)' })], undefined)).toBeNull()
  })

  it('inherits when the profile has been deleted out from under the session', () => {
    expect(profileAccent([], 'p1')).toBeNull()
  })

  it('rejects a hand-edited colour rather than breaking every derived token', () => {
    // Profiles are not validated at load, so this is the layer that has to hold:
    // an unparseable --ac takes the whole interface with it via color-mix.
    expect(profileAccent([profile({ accent: 'not-a-color' })], 'p1')).toBeNull()
    expect(profileAccent([profile({ accent: '' })], 'p1')).toBeNull()
  })
})
