/** Switch — a 40×20 track with a SQUARE knob.
 *
 * The knob is square and it hard-snaps: no sliding, no easing. GRID transitions
 * colour only, so a knob that travelled would be the one thing in the interface
 * animating position. Flipping `justify-content` between flex-start and
 * flex-end is what moves it, which means the movement is a layout fact rather
 * than an animation.
 */

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  /** The signal the track and knob take when checked. */
  tone?: 'accent' | 'live' | 'success'
  label: string
  disabled?: boolean
}

const TONE_COLOR = {
  accent: 'var(--signal-amber)',
  live: 'var(--signal-cyan)',
  success: 'var(--signal-green)',
} as const

export function Switch({ checked, onChange, tone = 'accent', label, disabled = false }: Props) {
  const signal = TONE_COLOR[tone]

  return (
    <button
      className="gswitch"
      data-checked={checked || undefined}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      type="button"
      style={{ '--switch-signal': signal } as React.CSSProperties}
    >
      <span className="gswitch__knob" />
    </button>
  )
}
