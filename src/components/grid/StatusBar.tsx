/** StatusBar — the telemetry strip.
 *
 * Three segments — left / centre / right — separated by dash fill that eats
 * whatever width is left over. The fill is a repeated character in a clipped
 * flex child, NOT a dotted border: the dotted leader belongs to PanelHeader,
 * and using it here would make the two rows read as the same kind of thing.
 *
 * The fill string is deliberately far longer than any pane it could land in and
 * clipped by `overflow: hidden`, so the dashes never re-flow as the numbers
 * beside them tick — the point of the fixed-width cells is that the clock does
 * not drift sideways once a second.
 */

import { toneColor, type Tone } from './tone'

interface Props {
  tone?: Tone
  left?: React.ReactNode
  center?: React.ReactNode
  right?: React.ReactNode
  fillChar?: string
  className?: string
}

/** Long enough to overrun any pane; the flex child clips the remainder. */
const FILL_REPEAT = 400

export function StatusBar({
  tone = 'accent',
  left,
  center,
  right,
  fillChar = '-',
  className,
}: Props) {
  const color = toneColor(tone)
  const fill = fillChar.repeat(FILL_REPEAT)

  return (
    <div
      className={['gstatus', className].filter(Boolean).join(' ')}
      style={{ borderColor: color, color }}
      aria-hidden
    >
      {left !== undefined && <span className="gstatus__seg">{left}</span>}
      <span className="gstatus__fill">{fill}</span>
      {center !== undefined && <span className="gstatus__seg">{center}</span>}
      <span className="gstatus__fill">{fill}</span>
      {right !== undefined && <span className="gstatus__seg">{right}</span>}
    </div>
  )
}
