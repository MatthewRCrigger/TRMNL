/** Settings window — ⌘,
 *
 * Settings save immediately; there is no Save button and there should not be one.
 */

import { open } from '@tauri-apps/plugin-dialog'

import { isValidColor, type CommandAccent } from '../lib/commandAccent'
import { anyColorToHex, formatOklch, hexToOklch } from '../lib/color'
import { ColorField } from './ColorField'
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

/** The name a profile is born with, and the signal that it is still untouched. */
export const DEFAULT_PROFILE_NAME = 'new profile'

/**
 * The trailing folder of an absolute path.
 *
 * Returns empty for the filesystem root, which has no folder name — better to
 * leave the profile called `new profile` than to rename it to nothing.
 *
 * Deliberately not shared with the identically-shaped helper in windowTitle.ts:
 * that one exists to shorten a path for display and is free to change how it
 * abbreviates, while this one names a profile. Coupling them would mean a
 * display tweak silently renaming profiles.
 */
export function folderName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}

/**
 * Pick a working directory with the system folder panel.
 *
 * Opened at the profile's current directory so the panel starts where the user
 * is already pointing rather than at the last place macOS happened to remember.
 * A `~` path has to be expanded first — the panel takes a real filesystem path
 * and silently ignores one it cannot resolve, which would look like the setting
 * being ignored.
 *
 * The chosen path is folded back to `~` on the way in, because that is the form
 * the rest of the app stores and displays: a profile that reads `~/src/thing`
 * before browsing should not become `/Users/you/src/thing` afterwards.
 *
 * A profile still called `new profile` is renamed to the chosen folder, since
 * that name means the form was never filled in rather than that the user wanted
 * it. Any other name is left alone — including one that matches a previously
 * browsed folder, because by then it is a name the user has seen and kept.
 *
 * Cancelling returns null and changes nothing, which is the whole contract —
 * there is no error case worth surfacing beyond that.
 */
async function browseForCwd(
  profile: Profile,
  apply: (patch: Partial<Profile>) => void,
): Promise<void> {
  const home = useStore.getState().host?.home ?? ''
  const expand = (p: string) =>
    home && p.startsWith('~') ? `${home}${p.slice(1)}` : p

  try {
    const picked = await open({
      directory: true,
      multiple: false,
      defaultPath: expand(profile.cwd) || home || undefined,
      title: 'Choose a working directory',
    })
    if (typeof picked !== 'string') return

    const cwd = home && picked.startsWith(home) ? `~${picked.slice(home.length)}` : picked
    const patch: Partial<Profile> = { cwd }

    const folder = folderName(picked)
    if (profile.name === DEFAULT_PROFILE_NAME && folder) patch.name = folder

    apply(patch)
  } catch (err) {
    // A denied capability or a panel that cannot open is worth a line, but not
    // worth interrupting the settings pane over.
    console.error('trmnl: could not open the folder panel', err)
  }
}

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
      name: DEFAULT_PROFILE_NAME,
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
              {/* The dot carries the profile's own colour when it has one, so
                  the list reads as the set of clients at a glance. Remote still
                  overrides it — that a profile is not local matters more than
                  which client it belongs to. */}
              <span
                className="dot"
                style={{
                  color:
                    profile.connectVia !== 'local'
                      ? 'var(--warn)'
                      : profile.accent && isValidColor(profile.accent)
                        ? profile.accent
                        : 'var(--ac)',
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

            <label className="form__label micro">COLOR</label>
            <ProfileAccentField profile={selected} patch={patch} />

            <label className="form__label micro" htmlFor="p-cwd">WORKING DIR</label>
            {/* The field stays editable rather than becoming a read-only target
                for the picker: typing is still the fastest way in when the path
                is known, and `~` cannot be reached through a folder panel at
                all. Browse is for the case the panel is better at — finding a
                directory you would otherwise have to remember the path to. */}
            <div className="form__row">
              <input
                className="form__input"
                id="p-cwd"
                value={selected.cwd}
                onChange={(e) => patch({ cwd: e.target.value })}
              />
              <button
                className="btn"
                type="button"
                onClick={() => void browseForCwd(selected, patch)}
              >
                BROWSE…
              </button>
            </div>

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

/**
 * Per-profile accent: inherit, one of the identities, or anything CSS parses.
 *
 * Inherit is a first-class choice rather than the absence of one, because the
 * two behave differently over time — a profile set to USER stays that colour
 * when the global identity changes, while an inheriting profile follows it. The
 * row makes that difference selectable instead of leaving it to whether a field
 * happens to be empty.
 */
function ProfileAccentField({
  profile,
  patch,
}: {
  profile: Profile
  patch: (changes: Partial<Profile>) => void
}) {
  const inherits = !profile.accent
  // A custom colour is anything that is not one of the shipped identities; only
  // then is the text field worth showing, so the common case stays one click.
  const named = IDENTITIES.find((i) => i.value === profile.accent)
  const valid = inherits || isValidColor(profile.accent!)

  return (
    <div className="paccent">
      <div className="paccent__picks">
        <button
          className="paccent__pick paccent__pick--inherit"
          data-selected={inherits}
          onClick={() => patch({ accent: undefined })}
          type="button"
          aria-pressed={inherits}
          title="Follow the global identity"
        >
          INHERIT
        </button>

        {IDENTITIES.map((identity) => {
          const selected = profile.accent === identity.value
          return (
            <button
              className="paccent__pick"
              data-selected={selected}
              key={identity.name}
              onClick={() => patch({ accent: identity.value })}
              type="button"
              aria-pressed={selected}
              title={identity.name}
            >
              <span className="paccent__chip" style={{ background: identity.value }} />
              {identity.name}
            </button>
          )
        })}
      </div>

      {/* Shown once the colour is not an identity, so a hand-picked value stays
          editable rather than being unreachable through the swatches. */}
      {!inherits && !named && (
        <ColorField
          value={profile.accent ?? ''}
          onChange={(accent) => patch({ accent })}
          label="Custom profile colour"
        />
      )}

      {/* Nudges an identity value off the swatch it matches, so the field opens
          on the colour already showing rather than resetting to an unrelated
          one. Without the nudge the value stays equal to an identity, `named`
          stays true, and the field never appears at all. */}
      <button
        className="paccent__custombtn"
        onClick={() => patch({ accent: nudgeOffIdentity(profile.accent) })}
        type="button"
        data-selected={!inherits && !named}
      >
        CUSTOM…
      </button>

      {!valid && (
        <div className="warnrow">
          ⚠ UNREADABLE COLOUR — THIS PROFILE WILL USE THE GLOBAL IDENTITY UNTIL CORRECTED
        </div>
      )}
    </div>
  )
}

/** Where CUSTOM… starts from when there is nothing to carry over: a mid-band
 *  colour that is already valid, so the field never opens in an error state the
 *  user did not cause. */
const DEFAULT_CUSTOM_ACCENT = 'oklch(0.75 0.18 300)'

/**
 * A colour that is guaranteed not to equal one of the identity swatches.
 *
 * Switching to CUSTOM should keep the colour on screen rather than jumping, but
 * a value identical to an identity reads as *that identity being selected* —
 * which is what hides the custom field. Rounding through hex both preserves the
 * colour visually and moves the stored string off the exact identity token.
 */
function nudgeOffIdentity(accent: string | undefined): string {
  if (!accent) return DEFAULT_CUSTOM_ACCENT
  const hex = anyColorToHex(accent)
  const back = hex ? hexToOklch(hex) : null
  if (!back) return DEFAULT_CUSTOM_ACCENT
  const rendered = formatOklch(back)
  return IDENTITIES.some((i) => i.value === rendered) ? DEFAULT_CUSTOM_ACCENT : rendered
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

      <CommandColorsSection />

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

/** A blank rule starts disabled: an empty `match` matches nothing, and an empty
 *  colour is not a valid `--ac`, so arming it before it is filled in would only
 *  invite a broken theme. */
const BLANK_ACCENT = (): CommandAccent => ({
  id: `ca-${Date.now().toString(36)}`,
  match: '',
  color: 'oklch(0.75 0.18 152)',
  label: '',
  enabled: false,
})

function CommandColorsSection() {
  const rules = useStore((s) => s.settingsValues.commandAccents)
  const updateSettings = useStore((s) => s.updateSettings)

  const patch = (i: number, changes: Partial<CommandAccent>) => {
    const commandAccents = rules.map((rule, j) => (j === i ? { ...rule, ...changes } : rule))
    updateSettings({ commandAccents })
  }

  return (
    <Section label="COMMAND COLORS">
      {/* First match wins (see lib/commandAccent.ts), so the list order is
          meaningful and rows are rendered in stored order rather than sorted. */}
      <div className="ccolors__note micro">FIRST MATCHING RULE WINS WHILE THE COMMAND RUNS</div>

      <div className="ccolors">
        {rules.map((rule, i) => {
          return (
            <div className="ccolors__row" key={rule.id}>
              <input
                className="ccolors__match"
                value={rule.match}
                onChange={(e) => patch(i, { match: e.target.value })}
                placeholder="command"
                aria-label="Command word to match"
                spellCheck={false}
              />
              <input
                className="ccolors__label"
                value={rule.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="label"
                aria-label="Rule label"
              />
              {/* The swatch doubles as the picker, so the row keeps its width
                  while losing the oklch box that used to sit beside it. */}
              <ColorField
                value={rule.color}
                onChange={(color) => patch(i, { color })}
                label={`Colour for ${rule.label || rule.match || 'rule'}`}
              />
              <Toggle
                on={rule.enabled}
                onChange={(on) => patch(i, { enabled: on })}
                label={`Enable ${rule.label || rule.match || 'rule'}`}
              />
              <button
                className="ccolors__del"
                onClick={() =>
                  updateSettings({ commandAccents: rules.filter((_, j) => j !== i) })
                }
                type="button"
                aria-label={`Remove ${rule.label || rule.match || 'rule'}`}
              >
                ✕
              </button>
            </div>
          )
        })}

        <button
          className="dashed dashed--inline"
          onClick={() => updateSettings({ commandAccents: [...rules, BLANK_ACCENT()] })}
          type="button"
        >
          + ADD COMMAND COLOR
        </button>
      </div>

      {rules.some((r) => r.enabled && !isValidColor(r.color)) && (
        <div className="warnrow">
          ⚠ AN ENABLED RULE HAS AN UNREADABLE COLOUR — IT WILL BE SKIPPED UNTIL CORRECTED
        </div>
      )}
    </Section>
  )
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
