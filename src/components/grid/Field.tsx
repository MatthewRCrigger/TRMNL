/** Field — the wrapper every form control gets.
 *
 * Label in Rajdhani caps (the app asking), hint and error in mono (what the
 * machine will do with the answer). Sub-labels explain in one lowercase clause
 * directly under the control they modify — never a paragraph, never elsewhere.
 */

interface Props {
  label?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function Field({ label, hint, error, required = false, className, children }: Props) {
  return (
    <div className={['gfield', className].filter(Boolean).join(' ')}>
      {label && (
        <label className="gfield__label" data-error={error ? true : undefined}>
          {label}
          {required && <span className="gfield__req">*</span>}
        </label>
      )}
      {children}
      {/* Error supersedes the hint rather than stacking with it — two lines of
          mono under one control is a wall, and the error is the only one that
          needs reading. */}
      {(error || hint) && (
        <div className="gfield__hint" data-error={error ? true : undefined}>
          {error ?? hint}
        </div>
      )}
    </div>
  )
}
