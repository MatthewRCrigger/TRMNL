/** `SETTINGS .PANELS` — ⌘,
 *
 * A Dialog at 1000 with a 200px SideNav down the left. The DISPLAY group gains
 * PANELS and TYPE where the identity section used to be: with GRID functionally
 * monochrome there is no accent to pick, and what is genuinely adjustable is the
 * panel geometry every surface is drawn with.
 *
 * The PANELS pane documents its own frame — the toggles you change there are
 * the ones drawing the dialog you are changing them in. That is deliberate, and
 * it is why they apply immediately.
 *
 * Settings save immediately; there is no Save button and there should not be
 * one. The REVERT / APPLY footer is REVERT-to-defaults and a close, not a
 * commit step.
 */

import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import {
  ACTIONS,
  findCollision,
  formatChord,
  resolveKeybindings,
  type ActionId,
} from '../lib/keybindings'
import {
  DEFAULT_PANEL,
  useStore,
  type Density,
  type GhostSource,
  type PanelSettings,
  type Profile,
  type SettingsTab,
} from '../state/store'
import type { RendererId } from '../term/renderers'
import {
  Badge,
  Button,
  Dialog,
  Field,
  Icon,
  Select,
  SideNav,
  Stepper,
  Switch,
  type SideNavSection,
} from './grid'

const NAV: readonly SideNavSection<SettingsTab>[] = [
  {
    label: 'SESSION',
    items: [
      { id: 'profiles', label: 'PROFILES' },
      { id: 'shell', label: 'SHELL' },
    ],
  },
  {
    label: 'DISPLAY',
    items: [
      { id: 'panels', label: 'PANELS' },
      { id: 'type', label: 'TYPE' },
      { id: 'renderers', label: 'RENDERERS' },
    ],
  },
  {
    label: 'INPUT',
    items: [{ id: 'keybindings', label: 'KEYBINDINGS' }],
  },
]

export function Settings() {
  const isOpen = useStore((s) => s.settings.open)
  const tab = useStore((s) => s.settings.tab)
  const setSettingsTab = useStore((s) => s.setSettingsTab)
  const closeSettings = useStore((s) => s.closeSettings)
  const host = useStore((s) => s.host)
  const profileCount = useStore((s) => s.profiles.length)
  const rendererCount = useStore((s) => Object.keys(s.settingsValues.renderers).length)
  const updateSettings = useStore((s) => s.updateSettings)

  // Counts are live rather than decorative: the nav says how many profiles and
  // renderers exist without making you open the pane to find out.
  const sections = NAV.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.id === 'profiles'
        ? { ...item, count: profileCount }
        : item.id === 'renderers'
          ? { ...item, count: rendererCount }
          : item.id === 'keybindings'
            ? { ...item, count: ACTIONS.length }
            : item,
    ),
  }))

  return (
    <Dialog
      open={isOpen}
      onClose={closeSettings}
      title="SETTINGS .PANELS"
      width={1000}
      flush
      className="settings"
      bodyClassName="settings__body"
      headerMeta={
        <span className="settings__version">{host?.version ?? ''} · UP TO DATE</span>
      }
      footer={
        <>
          {/* REVERT restores the shipped defaults for the pane's own geometry.
              There is nothing to APPLY — every change above already landed. */}
          <Button
            variant="secondary"
            onClick={() => updateSettings({ panel: DEFAULT_PANEL })}
          >
            REVERT
          </Button>
          <Button variant="primary" onClick={closeSettings}>
            APPLY
          </Button>
        </>
      }
    >
      <SideNav sections={sections} active={tab} onSelect={setSettingsTab} />

      <div className="settings__pane">
        {tab === 'profiles' && <ProfilesPane />}
        {tab === 'shell' && <ShellPane />}
        {tab === 'panels' && <PanelsPane />}
        {tab === 'type' && <TypePane />}
        {tab === 'renderers' && <RenderersPane />}
        {tab === 'keybindings' && <KeybindingsPane />}
      </div>
    </Dialog>
  )
}

/* --- shared --------------------------------------------------------------- */

/** A section label with a dotted leader running to the pane's right edge. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="settings__section">
      <div className="settings__sechead">
        <span className="settings__seclabel">{label}</span>
        <span className="leader" />
      </div>
      {children}
    </section>
  )
}

/**
 * One preference row: a sentence-case title over a lowercase mono sub-label,
 * with its control right-aligned.
 *
 * The casing split is the content rule made structural — the title is the app
 * talking about itself in sentence case under a capped section header, and the
 * sub-label explains in one lowercase clause directly under the control it
 * modifies.
 */
function PrefRow({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <div className="prefrow">
      <span className="prefrow__stack">
        <span className="prefrow__title">{title}</span>
        {sub && <span className="prefrow__sub">{sub}</span>}
      </span>
      {children}
    </div>
  )
}

/* --- Panels ---------------------------------------------------------------
 * The pane that documents its own frame.
 */

function PanelsPane() {
  const panel = useStore((s) => s.settingsValues.panel)
  const updateSettings = useStore((s) => s.updateSettings)

  const patch = (changes: Partial<PanelSettings>) =>
    updateSettings({ panel: { ...panel, ...changes } })

  return (
    <>
      <Section label="PANEL FRAME">
        <div className="settings__grid">
          <Field label="BORDER WIDTH" hint="applied set ships 2px; grid default is 1px">
            <Select
              value={String(panel.borderWidth)}
              options={[
                { value: '1', label: '1px — hairline' },
                { value: '2', label: '2px — applied' },
                { value: '3', label: '3px' },
              ]}
              onChange={(value) => patch({ borderWidth: Number(value) })}
              ariaLabel="Panel border width"
            />
          </Field>

          <Field label="CORNER STYLE" hint="round is this project's real default, not an error">
            <Select
              value={panel.cornerStyle}
              options={[
                { value: 'round', label: 'ROUND — 8px' },
                { value: 'sharp', label: 'SHARP — 0px' },
              ]}
              onChange={(value) => patch({ cornerStyle: value as PanelSettings['cornerStyle'] })}
              ariaLabel="Corner style"
            />
          </Field>

          <Field label="FRAME GAP" hint="void between the two lines of a double frame">
            <Stepper
              value={panel.frameGap}
              min={0}
              max={12}
              onChange={(frameGap) => patch({ frameGap })}
              unit="px"
              ariaLabel="Frame gap"
            />
          </Field>

          <Field label="HEADING SIZE" hint="12px is the floor; nothing goes below it">
            <Stepper
              value={panel.headingSize}
              min={12}
              max={20}
              onChange={(headingSize) => patch({ headingSize })}
              unit="px"
              ariaLabel="Heading size"
            />
          </Field>
        </div>
      </Section>

      <Section label="PER-BLOCK TOGGLES">
        <div className="settings__rows">
          <PrefRow title="Panel border" sub="every block draws its own outline">
            <Switch
              checked={panel.panelBorder}
              onChange={(panelBorder) => patch({ panelBorder })}
              label="Panel border"
            />
          </PrefRow>

          <PrefRow title="Header border" sub="off runs the content border full height">
            <Switch
              checked={panel.headerBorder}
              onChange={(headerBorder) => patch({ headerBorder })}
              label="Header border"
            />
          </PrefRow>

          <PrefRow title="Header fill" sub="fills the header of the block you are reading">
            <Switch
              checked={panel.headerFilled}
              onChange={(headerFilled) => patch({ headerFilled })}
              label="Header fill"
            />
          </PrefRow>

          <PrefRow title="Content border" sub="wells the output inside its own box">
            <Switch
              checked={panel.contentBorder}
              onChange={(contentBorder) => patch({ contentBorder })}
              label="Content border"
            />
          </PrefRow>
        </div>
      </Section>
    </>
  )
}

/* --- Type ----------------------------------------------------------------- */

const DENSITIES: readonly { value: Density; label: string }[] = [
  { value: 'compact', label: 'COMPACT — 1.42' },
  { value: 'normal', label: 'NORMAL — 1.65' },
  { value: 'roomy', label: 'ROOMY — 1.9' },
]

function TypePane() {
  const settings = useStore((s) => s.settingsValues)
  const updateSettings = useStore((s) => s.updateSettings)

  return (
    <>
      <Section label="OUTPUT">
        <div className="settings__grid">
          <Field label="LINE HEIGHT" hint="terminal output only; chrome does not move">
            <Select
              value={settings.density}
              options={DENSITIES.map((d) => ({ value: d.value, label: d.label }))}
              onChange={(value) => updateSettings({ density: value as Density })}
              ariaLabel="Line height"
            />
          </Field>

          <Field label="FOLD THRESHOLD" hint="lines before a settled block collapses">
            <Stepper
              value={settings.foldThreshold}
              min={3}
              max={60}
              step={3}
              onChange={(foldThreshold) => updateSettings({ foldThreshold })}
              ariaLabel="Fold threshold"
            />
          </Field>
        </div>
      </Section>

      <Section label="FAMILIES">
        {/* Not editable, and shown anyway: the split between the two families is
            the system's central rule, so naming it here is documentation rather
            than a control that was left out. */}
        <div className="settings__rows">
          <PrefRow title="Rajdhani" sub="anything a person wrote — headings, labels, buttons">
            <span className="settings__specimen settings__specimen--display">PANEL .LABEL</span>
          </PrefRow>
          <PrefRow title="Space Mono" sub="anything a system emitted — commands, output, paths">
            <span className="settings__specimen settings__specimen--mono">npm run build</span>
          </PrefRow>
        </div>
      </Section>
    </>
  )
}

/* --- Renderers ------------------------------------------------------------ */

const RENDERER_ROWS: readonly { id: RendererId; label: string; sub: string }[] = [
  { id: 'build', label: 'Build output', sub: 'route table with first-load budget' },
  { id: 'git', label: 'Git status', sub: 'staged and untracked groups' },
  { id: 'serve', label: 'Dev servers', sub: 'local and network link card' },
  { id: 'err', label: 'Errors', sub: 'alert with did-you-mean' },
  { id: 'list', label: 'Directory listings', sub: 'sortable table with markers' },
  { id: 'test', label: 'Test runs', sub: 'pass/fail summary and failures' },
]

const GHOST_SOURCES: readonly { value: GhostSource; label: string }[] = [
  { value: 'history', label: 'HISTORY' },
  { value: 'scripts', label: 'HISTORY + SCRIPTS' },
  { value: 'off', label: 'OFF' },
]

function RenderersPane() {
  const settings = useStore((s) => s.settingsValues)
  const updateSettings = useStore((s) => s.updateSettings)

  return (
    <>
      <Section label="OUTPUT RENDERERS">
        <div className="settings__rows">
          {RENDERER_ROWS.map((row) => (
            <PrefRow key={row.id} title={row.label} sub={row.sub}>
              <Switch
                checked={settings.renderers[row.id]}
                onChange={(on) => updateSettings({ renderers: { [row.id]: on } })}
                label={row.label}
              />
            </PrefRow>
          ))}
        </div>
      </Section>

      <Section label="GHOST SUGGESTIONS">
        <div className="settings__grid">
          <Field label="SOURCE" hint="what the tab-acceptable suggestion is drawn from">
            <Select
              value={settings.ghostSource}
              options={GHOST_SOURCES.map((g) => ({ value: g.value, label: g.label }))}
              onChange={(value) => updateSettings({ ghostSource: value as GhostSource })}
              ariaLabel="Ghost source"
            />
          </Field>
        </div>
      </Section>
    </>
  )
}

/* --- Shell ---------------------------------------------------------------- */

function ShellPane() {
  const settings = useStore((s) => s.settingsValues)
  const updateSettings = useStore((s) => s.updateSettings)
  const host = useStore((s) => s.host)

  return (
    <>
      <Section label="STARTUP">
        <div className="settings__rows">
          <PrefRow title="Restore sessions on launch" sub="reopens panes, cwd and scrollback">
            <Switch
              checked={settings.restoreOnLaunch}
              onChange={(restoreOnLaunch) => updateSettings({ restoreOnLaunch })}
              label="Restore sessions on launch"
            />
          </PrefRow>
        </div>
      </Section>

      <Section label="SCROLLBACK">
        <div className="settings__grid">
          <Field label="BUFFER CAP" hint="lines kept per session before the oldest are dropped">
            <Select
              value={String(settings.scrollbackCap)}
              options={[
                { value: '1000', label: '1,000 LINES' },
                { value: '10000', label: '10,000 LINES' },
                { value: '50000', label: '50,000 LINES' },
              ]}
              onChange={(value) => updateSettings({ scrollbackCap: Number(value) })}
              ariaLabel="Scrollback cap"
            />
          </Field>
        </div>
      </Section>

      {/* Machine facts about this install, in mono because that is what they
          are. Read-only: the config path is where the answers live, not a
          setting of its own. */}
      <Section label="HOST">
        <div className="settings__facts">
          <span className="settings__factkey">SHELL</span>
          <span className="settings__factval">{host?.shell ?? '—'}</span>
          <span className="settings__factkey">CONFIG</span>
          <span className="settings__factval">{host?.configPath ?? '—'}</span>
          <span className="settings__factkey">INTEGRATION</span>
          <span className="settings__factval">{host?.integrationDir ?? '—'}</span>
          <span className="settings__factkey">SYSTEM</span>
          <span className="settings__factval">
            {host ? `darwin ${host.osVersion} ${host.arch}` : '—'}
          </span>
        </div>
      </Section>
    </>
  )
}

/* --- Profiles ------------------------------------------------------------- */

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
  const expand = (p: string) => (home && p.startsWith('~') ? `${home}${p.slice(1)}` : p)

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
    console.error('crggr: could not open the folder panel', err)
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
    <div className="profiles">
      <div className="profiles__list">
        <div className="settings__sechead">
          <span className="settings__seclabel">SESSION PROFILES</span>
          <span className="leader" />
        </div>

        <div className="profiles__rows">
          {profiles.map((profile) => (
            <button
              className="profiles__row"
              data-active={profile.id === selected?.id || undefined}
              key={profile.id}
              onClick={() => selectProfile(profile.id)}
              type="button"
            >
              {/* Cyan for remote, amber for the selected local profile. The dot
                  is a signal about the connection, not a per-client colour —
                  profiles no longer carry one. */}
              <span
                className="dot"
                style={{
                  color:
                    profile.connectVia !== 'local'
                      ? 'var(--signal-cyan)'
                      : profile.id === selected?.id
                        ? 'var(--signal-amber)'
                        : 'var(--line-200)',
                }}
              />
              <span className="profiles__meta">
                <span className="profiles__name">{profile.name}</span>
                <span className="profiles__dir">{profile.cwd}</span>
              </span>
              {profile.isDefault && <Badge tone="accent">DEFAULT</Badge>}
              {profile.connectVia !== 'local' && !profile.isDefault && (
                <Badge tone="live">REMOTE</Badge>
              )}
            </button>
          ))}
        </div>

        <Button variant="secondary" size="sm" onClick={addProfile} className="profiles__add">
          <Icon name="plus" size={12} />
          NEW PROFILE
        </Button>
      </div>

      {selected && (
        <div className="profiles__detail">
          <div className="settings__grid">
            <Field label="NAME">
              <input
                className="ginput"
                value={selected.name}
                onChange={(e) => patch({ name: e.target.value })}
                aria-label="Profile name"
              />
            </Field>

            <Field label="SHELL" hint="absolute path to the shell binary">
              <input
                className="ginput"
                value={selected.shell}
                onChange={(e) => patch({ shell: e.target.value })}
                list="shells"
                aria-label="Shell"
              />
              <datalist id="shells">
                <option value="/bin/zsh" />
                <option value="/bin/bash" />
                <option value="/opt/homebrew/bin/fish" />
              </datalist>
            </Field>
          </div>

          {/* The field stays editable rather than becoming a read-only target
              for the picker: typing is still the fastest way in when the path is
              known, and `~` cannot be reached through a folder panel at all.
              Browse is for the case the panel is better at. */}
          <Field label="WORKING DIR">
            <div className="profiles__browse">
              <input
                className="ginput"
                value={selected.cwd}
                onChange={(e) => patch({ cwd: e.target.value })}
                aria-label="Working directory"
              />
              <Button variant="secondary" onClick={() => void browseForCwd(selected, patch)}>
                BROWSE
              </Button>
            </div>
          </Field>

          <div className="settings__grid">
            <Field label="CONNECT VIA" hint="local, or user@host for ssh">
              <input
                className="ginput"
                value={selected.connectVia}
                onChange={(e) => patch({ connectVia: e.target.value })}
                placeholder="local"
                aria-label="Connect via"
              />
            </Field>

            <Field label="STARTUP CMD" hint="runs once when the session opens">
              <input
                className="ginput"
                value={selected.startupCmd}
                onChange={(e) => patch({ startupCmd: e.target.value })}
                aria-label="Startup command"
              />
            </Field>
          </div>

          <Section label="ENVIRONMENT">
            <div className="env">
              {selected.env.map((entry, i) => (
                <div className="env__row" key={i}>
                  <input
                    className="ginput"
                    value={entry.key}
                    onChange={(e) => {
                      const env = [...selected.env]
                      env[i] = { ...entry, key: e.target.value }
                      patch({ env })
                    }}
                    aria-label="Variable name"
                  />
                  <input
                    className="ginput"
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
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => patch({ env: [...selected.env, { key: '', value: '' }] })}
              >
                <Icon name="plus" size={12} />
                ADD VARIABLE
              </Button>
            </div>

            {/* Secrets must not be persisted in plaintext. The handoff flags
                this for security review; until Keychain routing exists we warn
                rather than silently writing a credential to disk. */}
            {selected.env.some((e) => looksSecret(e.key)) && (
              <div className="env__warn">
                values that look like credentials are stored in plaintext — use the keychain
                instead
              </div>
            )}
          </Section>

          <div className="profiles__actions">
            <Button
              variant="primary"
              onClick={() => {
                closeSettings()
                void newSession(selected.id)
              }}
            >
              LAUNCH SESSION
            </Button>
            <Button variant="secondary" onClick={() => setDefaultProfile(selected.id)}>
              {selected.isDefault ? 'DEFAULT PROFILE' : 'SET AS DEFAULT'}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                upsertProfile({
                  ...selected,
                  id: `p-${Date.now().toString(36)}`,
                  name: `${selected.name} copy`,
                  isDefault: false,
                })
              }
            >
              DUPLICATE
            </Button>
            <span className="leader" />
            <Button variant="signal" tone="danger" onClick={() => deleteProfile(selected.id)}>
              DELETE
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function looksSecret(key: string): boolean {
  return /token|secret|password|passwd|api[_-]?key|credential|private[_-]?key/i.test(key)
}

/* --- Keybindings ---------------------------------------------------------- */

/** Never remappable here: native menu items (see lib/menuEvents.ts), the
 *  Composer's own Tab handling, and ⌃C. Shown for reference, not editable. */
const FIXED_BINDINGS: readonly [string, string][] = [
  ['⌘T', 'New session'],
  ['⌘W', 'Close pane'],
  ['⌘,', 'Settings'],
  ['⇥', 'Accept ghost suggestion'],
]

function KeybindingsPane() {
  const keybindings = useStore((s) => s.settingsValues.keybindings)
  const setKeybinding = useStore((s) => s.setKeybinding)
  const bindings = resolveKeybindings(keybindings)
  const [listening, setListening] = useState<ActionId | null>(null)
  const [pendingCollision, setPendingCollision] = useState<{
    action: ActionId
    chord: string
    with: ActionId | 'reserved'
  } | null>(null)

  useEffect(() => {
    if (!listening) return

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setListening(null)
        return
      }

      const chord = formatChord(event)
      if (chord === null) return // A bare modifier; keep listening.

      const collision = findCollision(chord, bindings, listening)
      if (collision) {
        setPendingCollision({
          action: listening,
          chord,
          with: 'reserved' in collision ? 'reserved' : collision.action,
        })
        setListening(null)
        return
      }

      setKeybinding(listening, chord)
      setListening(null)
    }

    // Capture phase, ahead of everything else — including the app's own
    // global handler — so the chord being captured never also triggers
    // whatever it is currently bound to.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [listening, bindings, setKeybinding])

  return (
    <>
      <Section label="COMMANDS">
        <div className="keys">
          {ACTIONS.map((action) => (
            <div className="keys__row" key={action.id}>
              <span className="keys__chord" data-listening={listening === action.id || undefined}>
                {listening === action.id ? 'PRESS KEYS…' : bindings[action.id]}
              </span>
              <span className="keys__action">{action.label}</span>
              <span className="leader" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPendingCollision(null)
                  setListening(listening === action.id ? null : action.id)
                }}
              >
                {listening === action.id ? 'CANCEL' : 'EDIT'}
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section label="RESERVED">
        <div className="keys">
          {FIXED_BINDINGS.map(([chord, label]) => (
            <div className="keys__row" data-fixed key={chord}>
              <span className="keys__chord">{chord}</span>
              <span className="keys__action">{label}</span>
              <span className="leader" />
              <span className="keys__fixed" title="Not remappable">
                —
              </span>
            </div>
          ))}
        </div>

        <div className="keys__note">⌃c cancels the running command and is not remappable</div>
      </Section>

      {pendingCollision && (
        <div className="keys__collision">
          <span className="keys__collisionmsg">
            {pendingCollision.chord} IS ALREADY{' '}
            {pendingCollision.with === 'reserved'
              ? 'RESERVED FOR ⌃C CANCEL'
              : `USED BY ${ACTIONS.find((a) => a.id === pendingCollision.with)?.label.toUpperCase()}`}
          </span>
          <span className="leader" />
          {pendingCollision.with !== 'reserved' && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setKeybinding(
                  pendingCollision.action,
                  pendingCollision.chord,
                  pendingCollision.with as ActionId,
                )
                setPendingCollision(null)
              }}
            >
              REPLACE
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setPendingCollision(null)}>
            CANCEL
          </Button>
        </div>
      )}
    </>
  )
}
