/** The signal plane, as a type.
 *
 * Every signal hue sits at L 0.83 / C 0.14 — red excepted at L 0.70 / C 0.19 so
 * alarm reads hotter — which is what stops any one of them shouting louder than
 * the others. Components take a `tone` and resolve it here rather than
 * accepting a colour, so a caller cannot introduce a hue off the plane.
 *
 * `neutral` is not a signal: it resolves to the line/ink ladder instead, and is
 * what a surface uses when it has nothing to signal. A clean exit is the
 * canonical case — a shell doing exactly what it was told is not an event.
 */

export type Tone = 'neutral' | 'accent' | 'live' | 'success' | 'danger' | 'special'

/** The signal colour itself: borders, text, filled backgrounds. */
export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'accent':
      return 'var(--signal-amber)'
    case 'live':
      return 'var(--signal-cyan)'
    case 'success':
      return 'var(--signal-green)'
    case 'danger':
      return 'var(--signal-red)'
    case 'special':
      return 'var(--signal-violet)'
    default:
      return 'var(--line-200)'
  }
}

/** The tint fill for a tone — the only translucency in the system, ≤ 0.16. */
export function toneFill(tone: Tone): string {
  switch (tone) {
    case 'accent':
      return 'var(--amber-fill)'
    case 'live':
      return 'var(--cyan-fill)'
    case 'success':
      return 'var(--green-fill)'
    case 'danger':
      return 'var(--red-fill)'
    case 'special':
      return 'var(--violet-fill)'
    default:
      return 'var(--surface-2)'
  }
}
