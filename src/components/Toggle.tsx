/** Switch control, used throughout the settings panes. */

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (on: boolean) => void
  label: string
}) {
  return (
    <button
      className="toggle"
      data-on={on}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
      type="button"
    >
      <span className="toggle__knob" />
    </button>
  )
}
