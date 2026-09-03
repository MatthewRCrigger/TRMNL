/** Hex ↔ oklch, so a colour can be picked rather than typed.
 *
 * The token set is authored in oklch and every neutral is derived from `--ac`
 * via `color-mix`, so oklch stays the stored form. But `<input type="color">` —
 * the only native picker a webview offers — speaks `#rrggbb` and nothing else.
 * These two functions are the bridge between them.
 *
 * The conversion is oklch → OKLab → linear sRGB → sRGB, and back. It is written
 * out rather than pulled from a library because it is thirty lines of arithmetic
 * against a fixed published matrix, and the alternative is a dependency in the
 * render path of a terminal.
 *
 * Alpha is deliberately absent. An accent with opacity would composite against
 * whatever sits behind it and break the derived hairlines, so the picker offers
 * no alpha channel and these functions do not carry one.
 */

/** A colour in the oklch space, as the token set stores it. */
export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number
  /** Chroma, 0 at grey. Values above ~0.37 leave sRGB at any hue. */
  c: number
  /** Hue angle in degrees, 0–360. */
  h: number
}

/* --- sRGB transfer function ----------------------------------------------- */

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function toGamma(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Parse `#rgb` or `#rrggbb` into oklch.
 *
 * Returns null for anything else — the caller is feeding this to `--ac`, and a
 * silently wrong colour is worse than a rejected one.
 */
export function hexToOklch(hex: string): Oklch | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null

  let body = m[1]!
  // #abc is #aabbcc; expanding here keeps one parse path below.
  if (body.length === 3) body = body.split('').map((ch) => ch + ch).join('')

  const r = toLinear(parseInt(body.slice(0, 2), 16) / 255)
  const g = toLinear(parseInt(body.slice(2, 4), 16) / 255)
  const b = toLinear(parseInt(body.slice(4, 6), 16) / 255)

  // Linear sRGB → LMS → OKLab (Björn Ottosson's matrices).
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_

  const c = Math.sqrt(A * A + B * B)
  // atan2 returns (-180, 180]; the token set writes hue as 0–360.
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360

  // A grey has no meaningful hue, and letting float noise pick one would make
  // the field jitter between values that all render identically.
  return { l: L, c, h: c < 1e-6 ? 0 : h }
}

/**
 * Render oklch as `#rrggbb`, clipping to what sRGB can show.
 *
 * Clipping rather than gamut-mapping: this feeds a swatch and a native picker,
 * both of which are sRGB, and a channel that lands outside is already a colour
 * the user cannot see on this display.
 */
export function oklchToHex({ l, c, h }: Oklch): string {
  const hr = (h * Math.PI) / 180
  const A = c * Math.cos(hr)
  const B = c * Math.sin(hr)

  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3

  const r = toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)
  const g = toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)
  const b = toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)

  const hex = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Format for storage. Three decimals on L and C is finer than the eye, and
 *  keeps a round-tripped value from growing a tail of float noise. */
export function formatOklch({ l, c, h }: Oklch): string {
  const n = (v: number, places: number) => String(Number(v.toFixed(places)))
  return `oklch(${n(l, 3)} ${n(c, 3)} ${n(h, 1)})`
}

/**
 * Any CSS colour the app might hold → `#rrggbb`, for seeding the native picker.
 *
 * Values reach here from three places that do not agree on notation: the shipped
 * `oklch(...)` tokens, a hex a user typed, and whatever a hand-edited config
 * contains. `oklch()` is parsed directly; everything else is handed to the
 * browser, which is the only thing that knows what `rebeccapurple` is.
 */
export function anyColorToHex(value: string): string | null {
  const v = value.trim()
  if (!v) return null

  if (/^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$/i.test(v)) {
    const parsed = hexToOklch(v)
    return parsed ? oklchToHex(parsed) : null
  }

  const ok = parseOklch(v)
  if (ok) return oklchToHex(ok)

  // Named colours, rgb(), hsl(): let the engine resolve it. Detached from the
  // document so this cannot read or disturb live layout.
  if (typeof document === 'undefined') return null
  const probe = document.createElement('span')
  probe.style.color = ''
  probe.style.color = v
  if (!probe.style.color) return null

  const m = /^rgba?\(([^)]+)\)$/.exec(probe.style.color)
  if (!m) return null
  const parts = m[1]!.split(/[,/\s]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null
  const hex = (n: number) => Math.round(clamp01(n / 255) * 255).toString(16).padStart(2, '0')
  return `#${hex(parts[0]!)}${hex(parts[1]!)}${hex(parts[2]!)}`
}

/** Parse an `oklch(L C H)` string, with L optionally a percentage. */
export function parseOklch(value: string): Oklch | null {
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+\s*)?\)$/i.exec(
    value.trim(),
  )
  if (!m) return null
  const raw = m[1]!
  const l = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)
  const c = parseFloat(m[2]!)
  const h = parseFloat(m[3]!)
  if ([l, c, h].some(Number.isNaN)) return null
  return { l, c, h }
}

/**
 * Any CSS colour → oklch, for adjusting a colour the caller did not choose the
 * notation of. `oklch(...)` is parsed directly, so a round trip through hex
 * cannot cost it precision; everything else goes through the hex bridge, which
 * is `anyColorToHex`'s job already.
 */
function anyColorToOklch(value: string): Oklch | null {
  const direct = parseOklch(value)
  if (direct) return direct
  const hex = anyColorToHex(value)
  return hex ? hexToOklch(hex) : null
}

/**
 * Scale a colour's chroma by `intensity`, a multiplier typically in roughly
 * 0.4..2.6 — this is the "duller/brighter" slider. "Brighter" here means more
 * vivid, not more lightness on the swatch itself: USER is
 * `oklch(0.93 0.045 220)`, already almost white at l:0.93, so raising *its*
 * L cannot make it read as less washed-out — it only pushes it further
 * toward white. What reads as dim there is the low chroma.
 *
 * But most of the interface never shows `--ac-raw` directly — tokens.css
 * turns it into hairlines and washes as low as 3.5% `color-mix` over
 * near-black (`--bd`, `--bd2`, `--wash`, `--wash2`), and at that opacity a
 * colour's *lightness* is most of what survives; a few points of chroma is
 * too small a change in the blended pixel to see. Those tokens key off `--ac`
 * — `--ac-raw` floored to l:0.62 in CSS — not `--ac-raw` itself, so the one
 * lever this function has for them is raising the lightness it hands to that
 * floor. Above 1, this pushes L up alongside chroma for exactly that reason;
 * the swatches and filled buttons brighten a little as a side effect, but the
 * hairlines are the thing an all-chroma version of this left too dim to read
 * against the page.
 *
 * Below 1 (duller), only chroma moves, toward grey; a lightness push there
 * would read as darkening rather than dulling, which is a different slider.
 *
 * Returns the input unchanged (as oklch) when it cannot be parsed, and always
 * clamps back into range so an extreme slider position cannot emit an invalid
 * `--ac-raw`.
 */
export function withIntensity(value: string, intensity: number): string {
  const base = anyColorToOklch(value)
  if (!base) return value
  if (intensity === 1) return formatOklch(base)

  const c = Math.max(0, base.c * intensity)
  const l = intensity > 1 ? clamp01(base.l + 0.12 * (intensity - 1)) : base.l
  return formatOklch({ ...base, l, c })
}
