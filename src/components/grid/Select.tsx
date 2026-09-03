/** Select — a native <select> with the platform chrome stripped.
 *
 * `appearance: none` removes the OS caret; the replacement is a square cell
 * pinned to the right edge, divided by a 1px rule and holding a literal ▼ in
 * mono. It is `pointer-events: none` so the whole control stays one hit target
 * — the caret is decoration over the real <select>, not a second button.
 *
 * Native rather than a custom listbox on purpose: the option list is drawn by
 * macOS, which gets keyboard, type-ahead and screen-reader behaviour right for
 * free, and it is the one surface in the app where the OS's own drawing is
 * better than anything reproducible in the webview.
 */

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  invalid?: boolean
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

export function Select({
  value,
  options,
  onChange,
  invalid = false,
  disabled = false,
  ariaLabel,
  className,
}: Props) {
  return (
    <span className={['gselect', className].filter(Boolean).join(' ')} data-invalid={invalid || undefined}>
      <select
        className="gselect__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="gselect__caret" aria-hidden>
        ▼
      </span>
    </span>
  )
}
