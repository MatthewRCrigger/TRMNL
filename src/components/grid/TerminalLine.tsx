/** TerminalLine — one line of command output.
 *
 * The default tone is --ink-200, NOT --ink-100. Output is the machine talking,
 * and the brighter ink is reserved for the command the person typed — a stream
 * where both sit at the same weight loses the distinction the block model
 * exists to draw.
 *
 * The optional gutter is a real column (min-width 4ch, right-aligned,
 * unselectable) rather than leading spaces, so copying a line yields the line
 * and not its line number.
 */

export type LineTone = 'default' | 'meta' | 'accent' | 'live' | 'success' | 'danger'

const TONE_COLOR: Record<LineTone, string> = {
  default: 'var(--ink-200)',
  meta: 'var(--ink-300)',
  accent: 'var(--signal-amber)',
  live: 'var(--signal-cyan)',
  success: 'var(--signal-green)',
  danger: 'var(--signal-red)',
}

interface Props {
  tone?: LineTone
  /** Line number or marker. Rendered at --line-300 and never selectable. */
  gutter?: React.ReactNode
  children: React.ReactNode
  className?: string
  [key: `data-${string}`]: unknown
}

export function TerminalLine({ tone = 'default', gutter, children, className, ...rest }: Props) {
  return (
    <div
      className={['gline', className].filter(Boolean).join(' ')}
      style={{ color: TONE_COLOR[tone] }}
      {...rest}
    >
      {gutter !== undefined && <span className="gline__gutter">{gutter}</span>}
      <span className="gline__text">{children}</span>
    </div>
  )
}
