/** Alert — a signalled message block.
 *
 * Title in the signal (Rajdhani caps), body in mono — the split is the same one
 * the whole system runs on: the app names the condition, the machine supplies
 * the evidence. A raw spawn error is machine truth and stays lowercase in mono
 * beneath an uppercase title.
 *
 * `tone="neutral"` is not a weaker danger: it is a genuinely neutral surface,
 * --line-200 on --surface-2. That distinction matters here more than anywhere
 * else in the app — a shell exiting 0 is doing exactly what it was told, and
 * the old build painted that in the error colour.
 */

import { Icon, type IconName } from './Icon'
import { toneColor, toneFill, type Tone } from './tone'

interface Props {
  tone?: Tone
  title: string
  icon?: IconName
  /** Trailing slot, right-aligned — typically one Button. */
  action?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

export function Alert({ tone = 'neutral', title, icon, action, className, children }: Props) {
  const signal = toneColor(tone)
  const neutral = tone === 'neutral'

  return (
    <div
      className={['galert', className].filter(Boolean).join(' ')}
      style={{
        borderColor: neutral ? 'var(--line-200)' : signal,
        background: neutral ? 'var(--surface-2)' : toneFill(tone),
      }}
      role="status"
    >
      {icon && (
        <span className="galert__icon" style={{ color: neutral ? 'var(--ink-300)' : signal }}>
          <Icon name={icon} size={14} />
        </span>
      )}

      <div className="galert__main">
        <div className="galert__title" style={{ color: neutral ? 'var(--ink-200)' : signal }}>
          {title}
        </div>
        {children && <div className="galert__body">{children}</div>}
      </div>

      {action && <span className="galert__action">{action}</span>}
    </div>
  )
}
