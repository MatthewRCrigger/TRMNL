/** Frame — the double frame.
 *
 * Outer line → a gap of pure void → inner line. Reserved for the *outermost
 * container of a view*: inside one, single hairlines only, or the screen turns
 * to corduroy. The window shell has one; a dialog is its own view so it
 * legitimately has one too. Command blocks in the stream do not — they are
 * single-framed panels.
 *
 * `weight` exists because the terminal takeover draws the same figure at
 * --stroke-1 rather than at the panel border width: inside the window's own
 * 2px double frame, a second 2px double frame would be the corduroy the rule
 * above is about. One colour feeds both lines, so the two can never disagree.
 */

interface Props {
  variant?: 'single' | 'double'
  /** Colour of both frame lines. */
  color?: string
  /** Line thickness. `panel` is 2px; `hairline` is 1px, for nested frames. */
  weight?: 'panel' | 'hairline'
  /** Padding inside the inner frame. */
  pad?: number | string
  background?: string
  className?: string
  children: React.ReactNode
  style?: React.CSSProperties
}

export function Frame({
  variant = 'double',
  color = 'var(--line-100)',
  weight = 'panel',
  pad,
  background = 'var(--void)',
  className,
  children,
  style,
}: Props) {
  const width = weight === 'panel' ? 'var(--panel-border-width)' : 'var(--stroke-1)'

  const inner = (
    <div
      className="gframe__inner"
      style={{
        border: `${width} solid ${color}`,
        // The inner radius is the outer minus the frame gap, so the two lines
        // stay concentric rather than the inner one bulging at the corners.
        borderRadius: variant === 'double' ? 'var(--panel-radius-inner)' : 'var(--panel-radius-outer)',
        background,
        padding: pad,
      }}
    >
      {children}
    </div>
  )

  if (variant === 'single') {
    return (
      <div className={['gframe', className].filter(Boolean).join(' ')} style={style}>
        {inner}
      </div>
    )
  }

  return (
    <div
      className={['gframe gframe--double', className].filter(Boolean).join(' ')}
      style={{
        border: `${width} solid ${color}`,
        borderRadius: 'var(--panel-radius-outer)',
        padding: 'var(--grid-frame-inset)',
        background: 'var(--void)',
        ...style,
      }}
    >
      {inner}
    </div>
  )
}
