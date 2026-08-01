/** Settings window — ⌘,
 *
 * Settings save immediately; there is no Save button and there should not be one.
 */

import { IDENTITIES, useStore, type Density, type GhostSource, type Profile, type SettingsTab } from '../state/store'
import type { RendererId } from '../term/renderers'
import { Toggle } from './Appearance'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'profiles', label: 'PROFILES' },
  { id: 'appearance', label: 'APPEARANCE' },
  { id: 'behavior', label: 'BEHAVIOR' },
  { id: 'keybindings', label: 'KEYBINDINGS' },
]

export function Settings() {
  const open = useStore((s) => s.settings.open)
  const tab = useStore((s) => s.settings.tab)
  const setSettingsTab = useStore((s) => s.setSettingsTab)
  const closeSettings = useStore((s) => s.closeSettings)
  const host = useStore((s) => s.host)

  if (!open) return null

  return (
    <div className="overlay overlay--settings" onMouseDown={closeSettings}>
      <div
        className="settings"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <span className="bracket bracket--tl" />
        <span className="bracket bracket--br" />

        <header className="settings__head">
          <span className="settings__title">SETTINGS</span>
          <span className="settings__path">
            TRMNL {host?.version ?? ''} · {host?.configPath ?? ''}
          </span>
          <span className="rule" />
          <button
            className="settings__close"
            onClick={closeSettings}
            type="button"
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        <div className="settings__body">
          <nav className="settings__nav" aria-label="Settings sections">
            {TABS.map((t) => (
              <button
                className="settings__navrow"
                data-active={tab === t.id}
                key={t.id}
                onClick={() => setSettingsTab(t.id)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'profiles' && <ProfilesPane />}
          {tab === 'appearance' && <AppearancePane />}
          {tab === 'behavior' && <BehaviorPane />}
          {tab === 'keybindings' && <KeybindingsPane />}
        </div>

        <footer className="settings__foot">
          <span className="settings__saved">● SAVED TO {host?.configPath ?? ''}</span>
          <span className="rule" />
          <span className="settings__esc">ESC CLOSE</span>
        </footer>
      </div>
    </div>
  )
}

/* --- Profiles -------------------------------------------------------------- */

function ProfilesPane() {
  const profiles = useStore((s) => s.profiles)
  const selectedId = useStore((s) => s.settings.selectedProfile)
  const selectProfile = useStore((s) => s.selectProfile)
  const upsertProfile = useStore((s) => s.upsertProfile)
  const deleteProfile = useStore((s) => s.deleteProfile)
  const setDefaultProfile = useStore((s) => s.setDefaultProfile)
  const newSession = useStore((s) => s.newSession)
  const closeSettings = useStore((s) => s.closeSettings)
  const host = useStore((s) => s.host)

  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0]

  const patch = (changes: Partial<Profile>) => {
    if (!selected) return
    upsertProfile({ ...selected, ...changes })
  }

  const addProfile = () => {
    const profile: Profile = {
      id: `p-${Date.now().toString(36)}`,
      name: 'new profile',
      cwd: host?.home ?? '~',
      shell: host?.shell ?? '/bin/zsh',
      connectVia: 'local',
      startupCmd: '',
      env: [],
    }
    upsertProfile(profile)
    selectProfile(profile.id)
  }

  return (
    <div className="settings__pane settings__pane--profiles">
      <div className="profiles__list">
        <div className="profiles__listhead micro">SESSION PROFILES</div>
        <div className="profiles__rows">
          {profiles.map((profile) => (
            <button
              className="profiles__row"
              data-active={profile.id === selected?.id}
              key={profile.id}
              onClick={() => selectProfile(profile.id)}
              type="button"
            >
              <span
                className="dot"
                style={{
                  color: profile.connectVia === 'local' ? 'var(--ac)' : 'var(--warn)',
                }}
              />
              <span className="profiles__meta">
                <span className="profiles__name">{profile.name}</span>
                <span className="profiles__dir">{profile.cwd}</span>
              </span>
              {profile.isDefault && <span className="profiles__badge">DEFAULT</span>}
              {profile.connectVia !== 'local' && !profile.isDefault && (
                <span className="profiles__badge">REMOTE</span>
              )}
            </button>
          ))}
        </div>
        <button className="dashed" onClick={addProfile} type="button">
          + NEW PROFILE
        </button>
      </div>

      {selected && (
        <div className="profiles__detail">
          <div className="form">
            <label className="form__label micro" htmlFor="p-name">NAME</label>
            <input
              className="form__input"
              id="p-name"
              value={selected.name}
              onChange={(e) => patch({ name: e.target.value })}
            />

            <label className="form__label micro" htmlFor="p-cwd">WORKING DIR</label>
            <input
              className="form__input"
              id="p-cwd"
              value={selected.cwd}
              onChange={(e) => patch({ cwd: e.target.value })}
            />

            <label className="form__label micro" htmlFor="p-shell">SHELL</label>
            <input
              className="form__input"
              id="p-shell"
              value={selected.shell}
              onChange={(e) => patch({ shell: e.target.value })}
              list="shells"
            />
            <datalist id="shells">
              <option value="/bin/zsh" />
              <option value="/bin/bash" />
              <option value="/opt/homebrew/bin/fish" />
            </datalist>

            <label className="form__label micro" htmlFor="p-connect">CONNECT VIA</label>
            <input
              className="form__input"
              id="p-connect"
              value={selected.connectVia}
              onChange={(e) => patch({ connectVia: e.target.value })}
              placeholder="local or user@host"
            />

            <label className="form__label micro" htmlFor="p-startup">STARTUP CMD</label>
            <input
              className="form__input form__input--accent"
              id="p-startup"
              value={selected.startupCmd}
              onChange={(e) => patch({ startupCmd: e.target.value })}
              placeholder="runs once on open"
            />
          </div>

          <div className="section-head">
            <span className="micro">ENVIRONMENT</span>
          </div>
          <div className="env">
            {selected.env.map((entry, i) => (
              <div className="env__row" key={i}>
                <input
                  className="env__key"
                  value={entry.key}
                  onChange={(e) => {
                    const env = [...selected.env]
                    env[i] = { ...entry, key: e.target.value }
                    patch({ env })
                  }}
                  aria-label="Variable name"
                />
                <input
                  className="env__value"
                  value={entry.value}
                  onChange={(e) => {
                    const env = [...selected.env]
                    env[i] = { ...entry, value: e.target.value }
                    patch({ env })
                  }}
                  aria-label="Variable value"
                />
                <button
                  className="env__del"
                  onClick={() => patch({ env: selected.env.filter((_, j) => j !== i) })}
                  type="button"
                  aria-label="Remove variable"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="dashed dashed--inline"
              onClick={() => patch({ env: [...selected.env, { key: '', value: '' }] })}
              type="button"
            >
              + ADD VARIABLE
            </button>
          </div>

          {/* Secrets must not be persisted in plaintext. The handoff flags this
              for security review; until Keychain routing exists we warn rather
              than silently writing a credential to disk. */}
          {selected.env.some((e) => looksSecret(e.key)) && (
            <div className="warnrow">
              ⚠ VALUES THAT LOOK LIKE CREDENTIALS ARE STORED IN PLAINTEXT — USE KEYCHAIN INSTEAD
            </div>
          )}

          <div className="profiles__actions">
            <button
              className="btn btn--primary"
              onClick={() => {
                closeSettings()
                void newSession(selected.id)
              }}
              type="button"
            >
              LAUNCH SESSION →
            </button>
            <button
              className="btn"
              data-lit={selected.isDefault}
              onClick={() => setDefaultProfile(selected.id)}
              type="button"
            >
              {selected.isDefault ? '◆ DEFAULT PROFILE' : 'SET AS DEFAULT'}
            </button>
            <button
              className="btn"
              onClick={() =>
                upsertProfile({
                  ...selected,
                  id: `p-${Date.now().toString(36)}`,
                  name: `${selected.name} copy`,
                  isDefault: false,
                })
              }
              type="button"
            >
              DUPLICATE
            </button>
            <span className="rule" />
            <button
              className="btn btn--danger"
              onClick={() => deleteProfile(selected.id)}
              type="button"
            >
              DELETE
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function looksSecret(key: string): boolean {
  return /token|secret|password|passwd|api[_-]?key|credential|private[_-]?key/i.test(key)
}

/* --- Appearance ------------------------------------------------------------ */

const DENSITIES: Density[] = ['compact', 'normal', 'roomy']

function AppearancePane() {
  const settings = useStore((s) => s.settingsValues)
  const updateSettings = useStore((s) => s.updateSettings)

  return (
    <div className="settings__pane">
      <Section label="IDENTITY">
        <div
          className="swatches swatches--large"
          style={{ '--swatch-cols': IDENTITIES.length } as React.CSSProperties}
        >
          {IDENTITIES.map((identity) => {
            const selected = identity.name === settings.identityName
            return (
              <button
                className="swatch swatch--large"
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
                <span className="swatch__value">{shortOklch(identity.value)}</span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section label="DENSITY">
        <div className="segmented segmented--auto">
          {DENSITIES.map((density) => (
            <button
              className="segmented__seg"
              data-active={settings.density === density}
              key={density}
              onClick={() => updateSettings({ density })}
              type="button"
            >
              {density.toUpperCase()}
            </button>
          ))}
        </div>
      </Section>

      <div className="typeout">
        <div className="typeout__row">
          <span className="micro">TERMINAL FONT</span>
          <span className="typeout__val">Geist Mono 12 / {lineHeight(settings.density)}</span>
        </div>
        <div className="typeout__row">
          <span className="micro">UI FONT</span>
          <span className="typeout__val">Rajdhani</span>
          <span className="typeout__sep">·</span>
          <span className="micro">DISPLAY</span>
          <span className="typeout__val">Orbitron</span>
        </div>
      </div>
    </div>
  )
}

function shortOklch(value: string): string {
  return value.replace(/0\./g, '.')
}

function lineHeight(density: Density): string {
  return density === 'compact' ? '1.42' : density === 'roomy' ? '1.90' : '1.62'
}

/* --- Behavior -------------------------------------------------------------- */

const RENDERER_ROWS: { id: RendererId; label: string }[] = [
  { id: 'build', label: 'Build output → route table' },
  { id: 'git', label: 'git status → file chips' },
  { id: 'serve', label: 'Dev servers → link card' },
  { id: 'err', label: 'Errors → did-you-mean' },
  { id: 'list', label: 'Directory listings → table' },
]

const GHOST_SOURCES: { id: GhostSource; label: string }[] = [
  { id: 'history', label: 'HISTORY' },
  { id: 'scripts', label: 'HISTORY + SCRIPTS' },
  { id: 'off', label: 'OFF' },
]

function BehaviorPane() {
  const settings = useStore((s) => s.settingsValues)
  const updateSettings = useStore((s) => s.updateSettings)

  const stepFold = (delta: number) => {
    const next = Math.min(60, Math.max(3, settings.foldThreshold + delta * 3))
    updateSettings({ foldThreshold: next })
  }

  return (
    <div className="settings__pane">
      <Section label="BLOCKS">
        <div className="prefrow">
          <span className="prefrow__stack">
            <span className="prefrow__label">Fold output longer than</span>
            <span className="prefrow__sub">applies to every block in this window</span>
          </span>
          <span className="stepper">
            <button className="stepper__btn" onClick={() => stepFold(-1)} type="button" aria-label="Fewer lines">
              −
            </button>
            <span className="stepper__val">{settings.foldThreshold}</span>
            <button className="stepper__btn" onClick={() => stepFold(1)} type="button" aria-label="More lines">
              +
            </button>
          </span>
          <span className="micro stepper__suffix">LINES</span>
        </div>
      </Section>

      <Section label="OUTPUT RENDERERS">
        <div className="rows">
          {RENDERER_ROWS.map((row) => (
            <div className="prefrow prefrow--sep" key={row.id}>
              <span className="prefrow__label">{row.label}</span>
              <Toggle
                on={settings.renderers[row.id]}
                onChange={(on) => updateSettings({ renderers: { [row.id]: on } })}
                label={row.label}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section label="GHOST SUGGESTIONS">
        <div className="segmented segmented--auto">
          {GHOST_SOURCES.map((source) => (
            <button
              className="segmented__seg"
              data-active={settings.ghostSource === source.id}
              key={source.id}
              onClick={() => updateSettings({ ghostSource: source.id })}
              type="button"
            >
              {source.label}
            </button>
          ))}
        </div>
      </Section>

      <Section label="STARTUP">
        <div className="prefrow">
          <span className="prefrow__stack">
            <span className="prefrow__label">Restore sessions on launch</span>
            <span className="prefrow__sub">reopens panes, cwd and scrollback</span>
          </span>
          <Toggle
            on={settings.restoreOnLaunch}
            onChange={(on) => updateSettings({ restoreOnLaunch: on })}
            label="Restore sessions on launch"
          />
        </div>

        <div className="prefrow">
          <span className="prefrow__stack">
            <span className="prefrow__label">Boot sequence</span>
            <span className="prefrow__sub">brief initialisation animation on launch</span>
          </span>
          <Toggle
            on={settings.bootSequence}
            onChange={(on) => updateSettings({ bootSequence: on })}
            label="Boot sequence"
          />
        </div>
      </Section>
    </div>
  )
}

/* --- Keybindings ----------------------------------------------------------- */

const BINDINGS: [string, string][] = [
  ['⌘K', 'Command palette'],
  ['⌘D', 'Split right'],
  ['⌘⇧D', 'Split down'],
  ['⌘T', 'New session'],
  ['⌘W', 'Close pane'],
  ['⌘,', 'Settings'],
  ['⇥', 'Accept ghost suggestion'],
  ['⌃L', 'Clear buffer'],
  ['⌘⌥←/→', 'Focus pane'],
  ['⌘⇧F', 'Search scrollback'],
  ['⌘[ / ⌘]', 'Previous / next block'],
]

function KeybindingsPane() {
  return (
    <div className="settings__pane">
      <div className="keys">
        {BINDINGS.map(([chord, action]) => (
          <div className="keys__row" key={chord}>
            <span className="keys__chord">{chord}</span>
            <span className="keys__action">{action}</span>
            {/* EDIT needs a capture-a-chord flow and conflict detection, which
                the design does not specify. Rather than ship a dead control, the
                affordance is disabled and labelled. */}
            <span className="keys__edit" title="Keybinding editing is not implemented yet">
              EDIT
            </span>
          </div>
        ))}
      </div>
      <div className="keys__note micro">⌃C CANCELS THE RUNNING COMMAND AND IS NOT REMAPPABLE</div>
    </div>
  )
}

/* --- shared ---------------------------------------------------------------- */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="settings__section">
      <div className="section-head">
        <span className="micro">{label}</span>
        <span className="rule" />
      </div>
      {children}
    </section>
  )
}
