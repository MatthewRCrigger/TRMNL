/** IndexCounter — `007 | 024`, a position in a set.
 *
 * Zero-padded to three and set in tabular mono so the cell cannot change width
 * as the number climbs; that fixed width is what stops a panel header reflowing
 * while output streams into it. The separator is dimmed rather than removed so
 * the pair still reads as one unit at a glance.
 */

interface Props {
  /** Current position. Omit for a bare total. */
  current?: number
  total?: number
  /** Digits to pad to. Three covers a session's blocks and a search's hits. */
  pad?: number
}

export function IndexCounter({ current, total, pad = 3 }: Props) {
  const fmt = (n: number) => String(n).padStart(pad, '0')

  return (
    <span className="gindex">
      {current !== undefined && <span>{fmt(current)}</span>}
      {current !== undefined && total !== undefined && <span className="gindex__sep">|</span>}
      {total !== undefined && <span>{fmt(total)}</span>}
    </span>
  )
}
