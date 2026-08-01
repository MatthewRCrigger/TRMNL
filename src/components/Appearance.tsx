/** Appearance popover — anchored under the identity button. */

import { IDENTITIES, useStore } from '../state/store'

export function Appearance() {
  const open = useStore((s) => s.appearance.open)
  const toggleAppearance = useStore((s) => s.toggleAppearance)
  const settings = useStore((s) => s.settingsValues)
  const updateSettings = useStore((s) => s.updateSettings)
  const openSettings = useStore((s) => s.openSettings)

  if (!open) return null

  return (
    <>
      {/* A full-window transparent backdrop catches outside clicks. */}
      <div className="popover__backdrop" onMouseDown={() => toggleAppearance(false)} />

      <div className="popover" role="dialog" aria-label="Appearance">
        <span className="bracket bracket--tl" style={{ width: 11, height: 11 }} />

        <div className="popover__head">
          <span className="micro">APPEARANCE</span>
          <span className="popover__kbd">⌘,</span>
        </div>

        <section className="popover__section">
          <div className="micro popover__label">IDENTITY</div>
          <div className="swatches">
            {IDENTITIES.map((identity) => {
              const selected = identity.name === settings.identityName
              return (
                <button
                  className="swatch"
                  data-selected={selected}
                  key={identity.name}
                  onClick={() =>
                    updateSettings({ accent: identity.value, identityName: identity.name })
                  }
                  type="button"
                  aria-pressed={selected}
                >
                  <span
                    className="swatch__chip"
                    style={{
                      background: identity.value,
                      outlineColor: selected ? identity.value : 'transparent',
                      boxShadow: selected ? `0 0 18px -2px ${identity.value}` : 'none',
                    }}
                  />
                  <span className="swatch__name">{identity.name}</span>
                </button>
              )
            })}
          </div>
        </section>

        <button
          className="popover__all"
          onClick={() => {
            toggleAppearance(false)
            openSettings()
          }}
          type="button"
        >
          ALL SETTINGS
          <span className="popover__arrow">→</span>
        </button>
      </div>
    </>
  )
}

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
