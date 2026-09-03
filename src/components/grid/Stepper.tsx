/** Stepper — minus / value / plus, for a small bounded integer.
 *
 * A stepper rather than a Select where the values form a range with a natural
 * order (a gap in px, a size in px): the user is nudging a number they can see
 * the effect of, not picking from a list of named options.
 *
 * The 36px buttons meet the control-height scale, and the value cell is
 * tabular mono on --surface-2 so it reads as a readout rather than as a third
 * button between the two real ones.
 */

import { Icon } from './Icon'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  /** Appended to the readout, e.g. `px`. */
  unit?: string
  ariaLabel: string
}

export function Stepper({ value, min, max, step = 1, onChange, unit, ariaLabel }: Props) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  return (
    <div className="gstep" role="group" aria-label={ariaLabel}>
      <button
        className="gstep__btn"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        type="button"
        aria-label={`Decrease ${ariaLabel}`}
      >
        <Icon name="minus" size={14} />
      </button>
      <span className="gstep__value">
        {value}
        {unit && <span className="gstep__unit">{unit}</span>}
      </span>
      <button
        className="gstep__btn"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        type="button"
        aria-label={`Increase ${ariaLabel}`}
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  )
}
