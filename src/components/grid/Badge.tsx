/** Badge — a status chip.
 *
 * 20px tall, outlined in its signal, with an optional 6px dot. The dot is
 * static: GRID has no infinite animation, so a running state is communicated by
 * *which* signal is showing, not by making it move.
 *
 * `white-space: nowrap` is part of the contract, not a nicety — a badge that
 * wraps reflows the header row it sits in, and header rows in this system are
 * built to hold their height while a block's state changes underneath them.
 */

import { toneColor, toneFill, type Tone } from './tone'

interface Props {
  tone?: Tone
  /** Fills with the signal and flips the text to --ink-invert. */
  variant?: 'outline' | 'solid'
  /** A static 6px status dot before the label. */
  dot?: boolean
  /** Paint the tint fill behind an outlined badge. */
  filled?: boolean
  children: React.ReactNode
}

export function Badge({ tone = 'neutral', variant = 'outline', dot = false, filled = false, children }: Props) {
  const signal = toneColor(tone)
  const solid = variant === 'solid'

  return (
    <span
      className="gbadge"
      data-solid={solid || undefined}
      style={{
        borderColor: signal,
        color: solid ? 'var(--ink-invert)' : signal,
        background: solid ? signal : filled ? toneFill(tone) : 'transparent',
      }}
    >
      {dot && <span className="dot" />}
      {children}
    </span>
  )
}
