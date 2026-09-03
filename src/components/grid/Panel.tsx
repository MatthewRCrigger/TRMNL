/** Panel — the surface the whole rebuild is built on.
 *
 * Every panel-bearing surface in GRID exposes the same six toggles, wired 1:1
 * to the origin theme's frame classes. They are real props here rather than a
 * single `bordered` boolean on purpose: the block stream needs to vary them
 * independently — a raw scrollback dump clears the frame entirely, the latest
 * block fills its header, a settled one does neither — and collapsing them into
 * one flag is exactly what makes that impossible to express.
 *
 * The mapping from block state to these toggles is the core of the rebuild:
 *
 *   settled, exit 0   → color unset (--line-300), header not filled
 *   latest            → color unset (--line-100), header FILLED
 *   non-zero exit     → color red,                header FILLED
 *   running / live    → color cyan,               header not filled
 *   raw dump          → showPanel: false
 *
 * `headerFilled` is reserved for the block you are currently reading. Two
 * filled headers in one viewport (latest + a failure) is the intended maximum;
 * a stream of them is a bug.
 */

import { IndexCounter } from './IndexCounter'

export interface PanelToggles {
  /** false → bare: clears every border, fill and radius. */
  showPanel?: boolean
  width?: 'full_width' | 'contained'
  panelBorder?: boolean
  /** false → the content border runs full height and rounds all four corners. */
  headerBorder?: boolean
  /** true → header fills solid and its text goes --ink-invert. */
  headerFilled?: boolean
  /** false → the header border does the dividing instead. */
  contentBorder?: boolean
  /**
   * Overrides the border *and* the header fill together. Unset falls back to
   * the theme tokens and stays theme-aware — which is why this is null rather
   * than a defaulted colour: "unset" and "explicitly neutral" are different
   * states, and only the first one follows the theme.
   */
  panelColor?: string | null
}

interface Props extends PanelToggles {
  /** `WORD .WORD`, uppercase — the origin theme's own heading convention. */
  heading?: string
  /** Rendered after the dotted leader, before the index. */
  headerMeta?: React.ReactNode
  /** Trailing header slot: badges, actions. */
  headerRight?: React.ReactNode
  index?: { current?: number; total?: number }
  className?: string
  /** Drop the 16px body padding — for a body that draws its own edges. */
  flush?: boolean
  children?: React.ReactNode
  onMouseDown?: (event: React.MouseEvent) => void
  [key: `data-${string}`]: unknown
}

export function Panel({
  showPanel = true,
  width = 'full_width',
  panelBorder = true,
  headerBorder = true,
  headerFilled = false,
  contentBorder = true,
  panelColor = null,
  heading,
  headerMeta,
  headerRight,
  index,
  className,
  flush = false,
  children,
  ...rest
}: Props) {
  // Bare clears everything. It is not "a panel with no border" — it is the
  // absence of a panel, which is what a 10,000-line scrollback dump needs
  // instead of a frame per block.
  if (!showPanel) {
    return (
      <div className={['gpanel gpanel--bare', className].filter(Boolean).join(' ')} {...rest}>
        {children}
      </div>
    )
  }

  // One colour drives the border and the header fill together, so a panel can
  // never show a red border above an amber header.
  const line = panelColor ?? 'var(--line-300)'

  return (
    <div
      className={['gpanel', className].filter(Boolean).join(' ')}
      data-width={width}
      data-outlined={panelBorder || undefined}
      data-filled={headerFilled || undefined}
      style={
        {
          '--panel-line': line,
          borderColor: panelBorder ? line : 'transparent',
          borderWidth: panelBorder ? 'var(--panel-border-width)' : 0,
        } as React.CSSProperties
      }
      {...rest}
    >
      {heading !== undefined && (
        <div
          className="gpanel__head"
          style={{
            background: headerFilled ? line : 'transparent',
            borderBottomWidth: headerBorder ? 'var(--panel-border-width)' : 0,
            borderBottomColor: line,
          }}
        >
          <span className="gpanel__heading">{heading}</span>
          <span className="leader" />
          {headerMeta}
          {index && <IndexCounter current={index.current} total={index.total} />}
          {headerRight}
        </div>
      )}

      {/* `contentBorder` is not applied to the body itself: the well belongs
          around the *output*, not around the whole body, which also holds the
          prompt row. Callers draw it with <PanelWell> where it belongs, and read
          the toggle to decide whether to. Painting it here as well would put two
          concentric boxes around one block of text. */}
      <div className="gpanel__body" data-flush={flush || undefined}>
        {children}
      </div>
    </div>
  )
}

/**
 * The content well inside a panel body: 1px --line-400, 4px radius,
 * --surface-2.
 *
 * Separate from Panel's own `contentBorder` toggle, which governs whether the
 * *panel* draws one. A renderer that wants a well around only part of its body
 * — the serve card, the test failure list — reaches for this directly.
 */
export function PanelWell({
  tone,
  className,
  style,
  children,
}: {
  /** Border and fill in a signal instead of the neutral well colours. */
  tone?: { border: string; fill: string }
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  return (
    <div
      className={['gwell', className].filter(Boolean).join(' ')}
      style={tone ? { ...style, borderColor: tone.border, background: tone.fill } : style}
    >
      {children}
    </div>
  )
}
