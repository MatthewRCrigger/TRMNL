/** Lucide glyphs, inlined.
 *
 * Inline rather than fetched so each one inherits `currentColor` and sits on
 * the same hairline plane as every border in the system — an <img> or a
 * background-image could do neither, and a fetch would put a network round trip
 * in front of first paint in a desktop app that has no network guarantee.
 *
 * Geometry is copied verbatim from `assets/icons/*.svg` in the handoff bundle;
 * only the C2PA metadata blocks (larger than the paths by two orders of
 * magnitude) were dropped. Stroke width, caps and joins are Lucide's own and
 * are what keep these reading as hairlines rather than as drawings.
 *
 * Lucide is ISC-licensed — see `assets/icons/LICENSE-lucide.txt` in the bundle.
 */

export type IconName =
  | 'x'
  | 'check'
  | 'plus'
  | 'minus'
  | 'globe'
  | 'external-link'
  | 'triangle-alert'
  | 'power'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-right'

/** Path geometry per glyph, in Lucide's 24×24 viewBox. */
const PATHS: Record<IconName, React.ReactNode> = {
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </>
  ),
  'external-link': (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  'triangle-alert': (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  power: (
    <>
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </>
  ),
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  'arrow-right': (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
}

interface Props {
  name: IconName
  /** Rendered size in px, both axes. */
  size?: number
  className?: string
}

export function Icon({ name, size = 14, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default: every icon in this build sits beside a text
      // label that already names the action.
      aria-hidden
      focusable={false}
      style={{ flex: 'none', display: 'block' }}
    >
      {PATHS[name]}
    </svg>
  )
}
