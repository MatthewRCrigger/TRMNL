/** The CRGGR.sh lockup.
 *
 * No logotype, no emblem, no icon mark — the wordmark is type, set in the
 * system's own two families, and the split between them is the whole idea:
 *
 *   CRGGR  — the brand a person reads. Rajdhani 600, .28em, caps, --ink-100.
 *   .sh    — a shell extension, and therefore machine truth. Space Mono 400,
 *            lowercase, --signal-amber, at 0.75× the display size.
 *
 * The negative margin absorbs the trailing letter-space that .28em tracking
 * leaves hanging off the final R; without it the extension floats away from the
 * word it belongs to.
 *
 * Never set `.sh` in Rajdhani, never in caps, never in ink. It is the one
 * lowercase thing in the chrome, and that is the point — the same rule that
 * keeps commands lowercase and chrome capped.
 */

interface Props {
  /** Size of the CRGGR half; `.sh` derives from it. */
  size?: number
  className?: string
}

export function Wordmark({ size = 20, className }: Props) {
  return (
    <span className={['gmark', className].filter(Boolean).join(' ')} aria-label="CRGGR.sh">
      <span className="gmark__name" style={{ fontSize: size }}>
        CRGGR
      </span>
      <span className="gmark__ext" style={{ fontSize: size * 0.75 }}>
        .sh
      </span>
    </span>
  )
}
