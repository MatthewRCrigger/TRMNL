/** Dialog — a modal view.
 *
 * A dialog *is* its own view, which is why it legitimately carries a double
 * frame where a command block does not. It also carries the one sanctioned
 * elevation in the system: --elev-dialog, a hard 1px halo of void so the frame
 * never touches content bleeding through the scrim behind it.
 *
 * It appears at 0ms. No fade, no scale, no slide — a machine display either
 * shows a state or it doesn't.
 */

import { useEffect } from 'react'

import { Frame } from './Frame'
import { IndexCounter } from './IndexCounter'
import { toneColor, type Tone } from './tone'

interface Props {
  open: boolean
  onClose: () => void
  /** `WORD .WORD`, uppercase. */
  title: string
  /** Recolours the frames, the title and the header border together. */
  tone?: Tone
  width?: number
  index?: { current?: number; total?: number }
  /** Between the leader and the index — e.g. a version readout. */
  headerMeta?: React.ReactNode
  footer?: React.ReactNode
  /** Drop the 16px body padding, for a body that draws its own rows. */
  flush?: boolean
  bodyClassName?: string
  className?: string
  children: React.ReactNode
}

export function Dialog({
  open,
  onClose,
  title,
  tone = 'neutral',
  width = 560,
  index,
  headerMeta,
  footer,
  flush = false,
  bodyClassName,
  className,
  children,
}: Props) {
  // Escape closes. Registered here rather than in each caller so a dialog can
  // never ship without it; the window's own handler owns the *priority* order
  // between overlays, and stops the event before it reaches this one.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // A danger dialog frames, titles and divides in red — the tone is not a chip
  // bolted onto an otherwise neutral surface.
  const frameColor = tone === 'neutral' ? 'var(--line-100)' : toneColor(tone)

  return (
    <div
      className="gdialog__scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <Frame
        color={frameColor}
        className={['gdialog', className].filter(Boolean).join(' ')}
        style={{ width, maxWidth: '100%', boxShadow: 'var(--elev-dialog)' }}
      >
        <div className="gdialog__head" style={{ borderBottomColor: frameColor }}>
          <span
            className="gdialog__title"
            style={{ color: tone === 'neutral' ? 'var(--ink-100)' : frameColor }}
          >
            {title}
          </span>
          <span className="leader" />
          {headerMeta}
          {index && <IndexCounter current={index.current} total={index.total} />}
          <button className="gdialog__close" onClick={onClose} type="button" aria-label="Close">
            ×
          </button>
        </div>

        <div
          className={['gdialog__body', bodyClassName].filter(Boolean).join(' ')}
          data-flush={flush || undefined}
        >
          {children}
        </div>

        {footer && <div className="gdialog__foot">{footer}</div>}
      </Frame>
    </div>
  )
}
