/** The design system's own rules, asserted against the stylesheets.
 *
 * These are the constraints that make the interface one system rather than a
 * pile of surfaces that happen to look similar, and every one of them is the
 * kind of thing a type checker cannot see and a reviewer stops noticing after
 * the twentieth file. Reading the CSS as text is crude, but it catches the
 * regression that matters: someone reaching for a shadow, an animation, or a
 * font size below the floor because it looked right in one place.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const STYLES = join(__dirname)
const read = (name: string) => readFileSync(join(STYLES, name), 'utf8')

const tokens = read('tokens.css')
const base = read('base.css')
const grid = read('grid.css')
const app = read('app.css')
const all = [tokens, base, grid, app].join('\n')

/** Strip comments so prose about a rule is never mistaken for the rule. */
function code(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('the system is still', () => {
  it('declares no keyframes anywhere', () => {
    // GRID has no entrance animation and no infinite loop. The boot sequence,
    // identity sweep, divider trace, caret blink and status pulse all lived
    // here once; a new @keyframes is almost certainly a mistake.
    expect(code(all)).not.toMatch(/@keyframes/)
  })

  it('transitions only colour, background-color and border-color', () => {
    // Transitioning transform, opacity, width or box-shadow is wrong by
    // construction — the state transition exists to soften a colour change,
    // not to move anything.
    const declared = [...code(all).matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]!.trim())

    for (const value of declared) {
      if (value === 'none' || value.startsWith('var(--transition-state)')) continue
      // A single-property shorthand naming one of the three is fine.
      expect(value).toMatch(/^(color|background-color|border-color)\s/)
    }
  })

  it('keeps the state duration at 80ms linear, and drops it under reduced motion', () => {
    expect(tokens).toMatch(/--dur-state:\s*80ms/)
    expect(tokens).toMatch(/--ease-state:\s*linear/)
    // Overlays appear. They do not fade in.
    expect(tokens).toMatch(/--dur-overlay:\s*0ms/)
    expect(tokens).toMatch(/prefers-reduced-motion[\s\S]*--dur-state:\s*0ms/)
  })
})

describe('elevation is lines, fills and one scrim', () => {
  it('casts no shadows beyond the sanctioned dialog halo', () => {
    // Nothing is above anything else — it is all etched into one pane of
    // glass. --elev-dialog is the exception: a hard 1px halo of void so a
    // dialog's frame never touches content bleeding behind the scrim.
    const shadows = [...code(all).matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]!.trim())

    for (const shadow of shadows) {
      const sanctioned =
        shadow === 'var(--elev-dialog)' ||
        // An *inset* edge is a border drawn inside an element, not a cast
        // light; the tab drop marker uses one to avoid reflowing the strip.
        shadow.startsWith('inset ')
      expect(sanctioned, `unsanctioned shadow: ${shadow}`).toBe(true)
    }
  })

  it('blurs only the dialog backdrop', () => {
    expect(tokens).toMatch(/--scrim-blur:\s*2px/)
    const blurs = [...code(all).matchAll(/backdrop-filter:\s*([^;]+);/g)].map((m) => m[1]!.trim())
    for (const blur of blurs) expect(blur).toBe('blur(var(--scrim-blur))')
  })
})

describe('the type floor', () => {
  it('sets every font-size through a token rather than a literal', () => {
    // Stronger than "nothing below 12px": there is no literal px font-size in
    // the stylesheets at all, so the floor cannot be undercut one rule at a
    // time. The old build's 8.5–10px chrome crept in exactly that way.
    const literals = [...code(all).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => m[0])
    expect(literals).toEqual([])

    // And the sizes that do get used are all real tokens.
    const used = new Set(
      [...code(all).matchAll(/font-size:\s*var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!),
    )
    expect(used.size).toBeGreaterThan(0)
    for (const token of used) {
      expect(tokens, `${token} is not defined`).toMatch(new RegExp(`${token}:`))
    }
  })

  it('puts the floor on --text-2xs, so a token cannot undercut it', () => {
    expect(tokens).toMatch(/--text-2xs:\s*12px/)
  })
})

describe('the signal plane', () => {
  it('keeps every signal on one lightness and chroma, red excepted', () => {
    // Hue is the only variable, which is what stops any one signal shouting
    // louder than the others. Red sits at L 0.70 / C 0.19 on purpose so alarm
    // reads hotter than the rest.
    for (const fill of ['--amber-fill', '--cyan-fill', '--green-fill']) {
      expect(tokens).toMatch(new RegExp(`${fill}:\\s*oklch\\(0\\.83 0\\.14 \\d+ / 0?\\.12\\)`))
    }
    expect(tokens).toMatch(/--red-fill:\s*oklch\(0\.7 0\.19 \d+ \/ 0?\.14\)/)
  })

  it('keeps every tint fill at or below 0.16 — the only translucency there is', () => {
    const alphas = [...code(tokens).matchAll(/oklch\([^)]*\/\s*(0?\.\d+)\)/g)].map((m) =>
      Number(m[1]),
    )
    expect(alphas.length).toBeGreaterThan(0)
    for (const alpha of alphas) expect(alpha).toBeLessThanOrEqual(0.16)
  })
})

describe('the applied token set', () => {
  it('ships the four rows that differ from the GRID defaults', () => {
    // These four are the whole visual character of the build. The round corner
    // in particular is a deliberate override of DESIGN_GUIDE.md, which calls a
    // rounded card a bug — do not "correct" it back to 0.
    expect(tokens).toMatch(/--panel-border-width:\s*2px/)
    expect(tokens).toMatch(/--grid-frame-inset:\s*4px/)
    expect(tokens).toMatch(/--panel-radius-outer:\s*8px/)
    expect(tokens).toMatch(/--panel-radius-inner:\s*4px/)
  })

  it('keeps the inner radius equal to the outer minus the frame gap', () => {
    // Otherwise the inner line of a double frame bulges at the corners.
    const outer = Number(/--panel-radius-outer:\s*(\d+)px/.exec(tokens)![1])
    const inner = Number(/--panel-radius-inner:\s*(\d+)px/.exec(tokens)![1])
    const gap = Number(/--grid-frame-inset:\s*(\d+)px/.exec(tokens)![1])
    expect(inner).toBe(Math.max(0, outer - gap))
  })

  it('pairs each control height with its own padding', () => {
    // 36 goes with 14 and 44 goes with 20; mixing them is the easiest mistake
    // in the system, which is why Button looks the pair up rather than taking
    // two props.
    expect(tokens).toMatch(/--control-h-sm:\s*28px/)
    expect(tokens).toMatch(/--control-px-sm:\s*10px/)
    expect(tokens).toMatch(/--control-h-md:\s*36px/)
    expect(tokens).toMatch(/--control-px-md:\s*14px/)
    expect(tokens).toMatch(/--control-h-lg:\s*44px/)
    expect(tokens).toMatch(/--control-px-lg:\s*20px/)
  })
})

describe('the accent system is gone', () => {
  it('derives no neutral from an accent', () => {
    // GRID is functionally monochrome: colour is a signal, never decoration.
    // Every value in tokens.css is a literal, which is also what lets xterm
    // read them with a plain getPropertyValue.
    expect(code(tokens)).not.toMatch(/oklch\(from/)
    expect(code(tokens)).not.toMatch(/--ac-raw|--act\b/)
  })

  it('leaves no reference to a retired token', () => {
    const retired = ['--ac-raw', '--wash2', '--fgdd', '--bd2', '--glow-strength']
    for (const token of retired) {
      expect(code(all), `${token} still referenced`).not.toContain(token)
    }
  })
})
