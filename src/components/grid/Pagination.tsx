/** Pagination — `PREV | 007 | 024 | NEXT`.
 *
 * The arrows are the literal characters ◄ and ► set in mono, not chevron SVGs.
 * The bundle ships chevron-left/right and they are deliberately unused here:
 * these two arrows are solid triangles that read as *controls* at 12px, where a
 * 1.5px stroked chevron reads as a hairline and disappears into the borders
 * around it.
 *
 * The readout is tabular with a min-width so stepping 009 → 010 cannot nudge
 * the buttons either side of it.
 */

interface Props {
  current: number
  total: number
  onPrev: () => void
  onNext: () => void
  /** Rendered before the cluster, e.g. `MATCH`. */
  label?: string
  className?: string
}

export function Pagination({ current, total, onPrev, onNext, label, className }: Props) {
  const disabled = total === 0

  return (
    <div className={['gpage', className].filter(Boolean).join(' ')}>
      {label && <span className="gpage__label">{label}</span>}
      <button
        className="gpage__arrow"
        onClick={onPrev}
        disabled={disabled}
        type="button"
        aria-label="Previous"
      >
        ◄
      </button>
      <span className="gpage__readout">
        <span>{String(current).padStart(3, '0')}</span>
        <span className="gpage__sep">|</span>
        <span>{String(total).padStart(3, '0')}</span>
      </span>
      <button
        className="gpage__arrow"
        onClick={onNext}
        disabled={disabled}
        type="button"
        aria-label="Next"
      >
        ►
      </button>
    </div>
  )
}
