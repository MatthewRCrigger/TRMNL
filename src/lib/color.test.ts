/** The picker stores oklch but the native control speaks hex, so a value makes
 *  the trip on every interaction. Drift here would walk a colour away from where
 *  the user put it, one edit at a time. */

import { describe, expect, it } from 'vitest'

import { anyColorToHex, formatOklch, hexToOklch, oklchToHex, parseOklch, withIntensity } from './color'

describe('hexToOklch', () => {
  it('maps the sRGB anchors', () => {
    // White and black are the two values the transfer function has to nail; a
    // rounding error at either end shows up everywhere else.
    const white = hexToOklch('#ffffff')!
    expect(white.l).toBeCloseTo(1, 3)
    expect(white.c).toBeCloseTo(0, 3)

    const black = hexToOklch('#000000')!
    expect(black.l).toBeCloseTo(0, 3)
    expect(black.c).toBeCloseTo(0, 3)
  })

  it('gives a grey no hue rather than a noise-picked one', () => {
    // Float noise would otherwise land on an arbitrary angle, and the field
    // would jitter between values that render identically.
    expect(hexToOklch('#808080')!.h).toBe(0)
    expect(hexToOklch('#808080')!.c).toBeCloseTo(0, 4)
  })

  it('expands the three-digit form', () => {
    expect(hexToOklch('#abc')).toEqual(hexToOklch('#aabbcc'))
  })

  it('accepts a missing # and any case', () => {
    expect(hexToOklch('FF0000')).toEqual(hexToOklch('#ff0000'))
  })

  it('rejects anything that is not a hex colour', () => {
    // This value is destined for --ac, where a wrong colour is worse than none.
    for (const bad of ['', '#12', '#12345', '#gggggg', 'red', 'oklch(0.7 0.1 200)']) {
      expect(hexToOklch(bad)).toBeNull()
    }
  })

  it('puts the primaries in the right hue quadrant', () => {
    const red = hexToOklch('#ff0000')!
    const green = hexToOklch('#00ff00')!
    const blue = hexToOklch('#0000ff')!
    expect(red.h).toBeGreaterThan(20)
    expect(red.h).toBeLessThan(45)
    expect(green.h).toBeGreaterThan(130)
    expect(green.h).toBeLessThan(150)
    expect(blue.h).toBeGreaterThan(255)
    expect(blue.h).toBeLessThan(275)
  })
})

describe('round trip', () => {
  it('returns the same hex it was given', () => {
    // The property that matters: opening the picker and closing it without
    // touching anything must not move the stored value.
    for (const hex of ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff',
                       '#123456', '#abcdef', '#7f3fbf', '#0a0f19']) {
      expect(oklchToHex(hexToOklch(hex)!)).toBe(hex)
    }
  })

  it('survives being formatted and reparsed', () => {
    // The stored form is a rounded string, so the trip through text is the one
    // that actually happens between edits.
    for (const hex of ['#3fa9f5', '#c0ffee', '#1a1a1a']) {
      const text = formatOklch(hexToOklch(hex)!)
      expect(oklchToHex(parseOklch(text)!)).toBe(hex)
    }
  })
})

describe('oklchToHex', () => {
  it('clips a colour outside sRGB instead of producing garbage', () => {
    // Chroma far past the gamut: every channel must still land in range.
    const hex = oklchToHex({ l: 0.7, c: 0.9, h: 150 })
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('renders the shipped identity colours as visible sRGB', () => {
    expect(oklchToHex({ l: 0.75, c: 0.18, h: 195 })).toMatch(/^#[0-9a-f]{6}$/)
    expect(oklchToHex({ l: 0.93, c: 0.045, h: 220 })).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('formatOklch', () => {
  it('writes the token notation', () => {
    expect(formatOklch({ l: 0.75, c: 0.18, h: 152 })).toBe('oklch(0.75 0.18 152)')
  })

  it('does not leave a tail of float noise', () => {
    // A round-tripped value is full of 0.7500000001-style artefacts; storing
    // those would make the config unreadable as the dotfile it is meant to be.
    expect(formatOklch({ l: 0.7500000001, c: 0.1799999998, h: 152.00001 }))
      .toBe('oklch(0.75 0.18 152)')
  })

  it('drops trailing zeros rather than padding', () => {
    expect(formatOklch({ l: 0.5, c: 0, h: 0 })).toBe('oklch(0.5 0 0)')
  })
})

describe('parseOklch', () => {
  it('reads the shipped form', () => {
    expect(parseOklch('oklch(0.75 0.18 152)')).toEqual({ l: 0.75, c: 0.18, h: 152 })
  })

  it('accepts a percentage lightness', () => {
    // Valid CSS that a hand-edited config may well contain.
    expect(parseOklch('oklch(75% 0.18 152)')!.l).toBeCloseTo(0.75, 5)
  })

  it('tolerates an alpha it will then ignore', () => {
    expect(parseOklch('oklch(0.75 0.18 152 / 0.5)')).toEqual({ l: 0.75, c: 0.18, h: 152 })
  })

  it('rejects other notations', () => {
    for (const bad of ['#ff0000', 'rgb(1,2,3)', 'oklch(0.75 0.18)', '']) {
      expect(parseOklch(bad)).toBeNull()
    }
  })
})

describe('anyColorToHex', () => {
  it('seeds the picker from a stored oklch token', () => {
    expect(anyColorToHex('oklch(0.75 0.18 152)')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('passes hex through, normalised', () => {
    expect(anyColorToHex('#ABC')).toBe('#aabbcc')
  })

  it('returns null for an empty or unreadable value', () => {
    // The caller falls back to a default rather than opening the picker on junk.
    expect(anyColorToHex('')).toBeNull()
    expect(anyColorToHex('   ')).toBeNull()
  })
})

describe('withIntensity', () => {
  it('scales chroma up for a multiplier above 1, and leaves hue alone', () => {
    const brighter = parseOklch(withIntensity('oklch(0.75 0.18 152)', 1.5))!
    expect(brighter.c).toBeCloseTo(0.27, 5)
    expect(brighter.h).toBe(152)
  })

  it('scales chroma down for a multiplier below 1', () => {
    const duller = parseOklch(withIntensity('oklch(0.75 0.18 152)', 0.5))!
    expect(duller.c).toBeCloseTo(0.09, 5)
  })

  it('is a no-op at 1, short of reformatting the input', () => {
    expect(withIntensity('oklch(0.75 0.18 152)', 1)).toBe('oklch(0.75 0.18 152)')
  })

  it('makes a pale, low-chroma identity visibly more saturated', () => {
    // This is the case that motivated the feature: USER is l:0.93 c:0.045,
    // already nearly white, so raising *its own* lightness has nowhere left
    // to push it. Turning the chroma up is what actually reads as "brighter"
    // on the swatch itself.
    const user = parseOklch(withIntensity('oklch(0.93 0.045 220)', 1.8))!
    expect(user.c).toBeGreaterThan(0.045)
  })

  it('also raises lightness above 1, for the sake of --ac and its derived hairlines', () => {
    // Most of the interface never shows --ac-raw directly — --bd, --wash and
    // friends are --ac (--ac-raw floored to l:0.62) blended as low as 3.5%
    // over near-black, where chroma barely survives the blend and lightness
    // is what actually lifts a hairline off the page. That floor is computed
    // in CSS from whatever --ac-raw carries, so lifting L here is the one way
    // this function has to brighten those tokens too.
    const base = parseOklch('oklch(0.93 0.045 220)')!
    const brighter = parseOklch(withIntensity('oklch(0.93 0.045 220)', 1.8))!
    expect(brighter.l).toBeGreaterThan(base.l)
  })

  it('leaves lightness alone when duller, so it reads as desaturated rather than darker', () => {
    const base = parseOklch('oklch(0.75 0.18 152)')!
    const duller = parseOklch(withIntensity('oklch(0.75 0.18 152)', 0.5))!
    expect(duller.l).toBe(base.l)
  })

  it('clamps rather than emitting an out-of-range L or a negative C', () => {
    expect(parseOklch(withIntensity('oklch(0.95 0.2 25)', 2.6))!.l).toBeLessThanOrEqual(1)
    expect(parseOklch(withIntensity('oklch(0.05 0.02 25)', 0.4))!.c).toBeGreaterThanOrEqual(0)
  })

  it('adjusts a hex accent the same way, round-tripping through oklch', () => {
    // Profile and command-rule colours are not always authored as oklch;
    // withIntensity has to handle whatever notation reaches --ac-raw. Only
    // loose precision is expected here: formatOklch rounds to 3 decimals, and
    // the hex round trip through sRGB costs a little more on top of that.
    const base = hexToOklch('#3fa9f5')!
    const nudged = parseOklch(withIntensity('#3fa9f5', 1.5))!
    expect(nudged.c).toBeCloseTo(base.c * 1.5, 2)
  })

  it('passes an unparseable colour straight through', () => {
    expect(withIntensity('not-a-colour', 1.5)).toBe('not-a-colour')
  })
})
