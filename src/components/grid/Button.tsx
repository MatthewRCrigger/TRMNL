/** Button.
 *
 * Four variants, three sizes, square corners. The pairing of height and padding
 * is the easiest thing to get wrong in the system — 28/10, 36/14, 44/20 — so it
 * is expressed as one lookup here rather than left to each caller.
 *
 * Labels are imperative and uppercase: `STAGE ALL`, `RERUN`, `CLOSE ANYWAY`.
 * Not "Learn more".
 */

import { toneColor, type Tone } from './tone'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'signal'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface Props extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Which signal the variant paints with. Ignored by `secondary`. */
  tone?: Tone
  children: React.ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  tone = 'accent',
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={['gbtn', `gbtn--${variant}`, `gbtn--${size}`, className].filter(Boolean).join(' ')}
      // The signal is passed as a custom property rather than as separate
      // colour declarations so one variable drives border, text, fill and both
      // hover mixes — a variant's rules never have to know which hue they got.
      style={{ '--btn-signal': toneColor(tone) } as React.CSSProperties}
      {...rest}
    >
      {children}
    </button>
  )
}
