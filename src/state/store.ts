/** Window store.
 *
 * One window = one store; panes are children. The handoff notes the prototype
 * kept every option's state in one component keyed by letter because it rendered
 * ten terminals on a page — that is an artifact of the design document and is
 * deliberately not reproduced here.
 */

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

import {
  DEFAULT_COMMAND_ACCENTS,
  accentFor,
  isValidColor,
  type CommandAccent,
} from '../lib/commandAccent'
import { notifyComplete, shouldNotify } from '../lib/notify'
import { PtySession } from '../term/session'
import { setKnownCommands, setRendererEnabled, type RendererId } from '../term/renderers'
import type { Block } from '../term/types'

export type PaneId = 'a' | 'b'
export type SplitDir = 'row' | 'col'
export type Density = 'compact' | 'normal' | 'roomy'
export type GhostSource = 'history' | 'scripts' | 'off'

export interface Identity {
  name: string
  value: string
}

/** Swatch order follows the design; CLU carries the gold formerly named ATHENA. */
export const IDENTITIES: Identity[] = [
  { name: 'PROGRAM', value: 'oklch(0.75 0.18 195)' },
  { name: 'ISO', value: 'oklch(0.75 0.18 152)' },
  { name: 'USER', value: 'oklch(0.93 0.045 220)' },
  { name: 'ARES', value: 'oklch(0.6 0.25 25)' },
  { name: 'CLU', value: 'oklch(0.85 0.18 90)' },
]

/** The default identity. Must match the `--ac` fallback in tokens.css. */
export const DEFAULT_IDENTITY =
  IDENTITIES.find((i) => i.name === 'USER') ?? IDENTITIES[0]!

export interface Profile {
  id: string
  name: string
  cwd: string
  shell: string
  connectVia: string
  startupCmd: string
  env: { key: string; value: string }[]
  isDefault?: boolean
}

export interface Session {
  id: string
  name: string
  host: string
  cwd: string
  branch: string
  /** Shell this session was spawned with, for the window title. */
  shell: string
  /**
   * Character grid last reported to the PTY.
   *
   * Mirrored into the store purely so the window title can name it. The pane
   * measures the grid and sends it straight to `pty_resize`, which is the only
   * consumer that matters — this copy is descriptive, never authoritative, and
   * nothing should resize a terminal from it.
   */
  cols: number
  rows: number
  blocks: Block[]
  input: string
  /** Ghost suggestion remainder, computed on input. */
  ghost: string
  profileId?: string
  /** History for ↑/↓ recall, newest last. */
  history: string[]
  historyIndex: number | null
  /** A full-screen program owns this session; render a terminal, not blocks. */
  takeover: boolean
  /**
   * Command words of everything running under this session's shell, from the
   * native process-tree scan. Empty when nothing is running.
   *
   * This is how a chained tool is found: the typed command may be `bun run
   * start` while the tool that matters is `shopify`, several levels down. See
   * `accentFor` and `src-tauri/src/proctree.rs`.
   */
  tools: string[]
  /**
   * Why the shell could not be started, or undefined when it did start.
   *
   * A session whose spawn failed used to look identical to a working one: the
   * composer accepted input and every command sat on RUNNING forever, because
   * there was no shell on the other end to answer. Recording the reason lets the
   * pane say so instead.
   */
  failed?: string
}

export interface Settings {
  accent: string
  identityName: string
  density: Density
  foldThreshold: number
  renderers: Record<RendererId, boolean>
  ghostSource: GhostSource
  restoreOnLaunch: boolean
  bootSequence: boolean
  scrollbackCap: number
  /** Per-command accent overrides; see lib/commandAccent.ts. */
  commandAccents: CommandAccent[]
}

export interface HostInfo {
  version: string
  osVersion: string
  arch: string
  hostname: string
  home: string
  shell: string
  integrationDir: string
  sourceLine: string
  configPath: string
  /** Protocol version this build's shell hooks announce. */
  hookVersion: number
}

interface PaneState {
  sessions: string[]
  active: number
}

interface StoreState {
  /* window */
  split: boolean
  splitDir: SplitDir
  paneSize: number
  focus: PaneId
  railOpen: boolean
  railAutoCollapsed: boolean

  /* overlays */
  palette: { open: boolean; query: string; activeIndex: number }
  appearance: { open: boolean }
  settings: { open: boolean; tab: SettingsTab; selectedProfile: string | null }
  search: { open: boolean; query: string; activeIndex: number }

  /* content */
  panes: Record<PaneId, PaneState>
  sessions: Record<string, Session>
  profiles: Profile[]
  settingsValues: Settings
  host: HostInfo | null

  /* actions — see implementations below */
  init: () => Promise<void>
  setFocus: (pane: PaneId) => void
  toggleSplit: (dir: SplitDir) => void
  closePane: () => void
  setPaneSize: (pct: number) => void
  setRailOpen: (open: boolean) => void
  syncRailForWidth: (width: number) => void

  openPalette: () => void
  closePalette: () => void
  setPaletteQuery: (q: string) => void
  movePaletteSelection: (delta: number, max: number) => void
  setPaletteIndex: (i: number) => void

  openSearch: () => void
  closeSearch: () => void
  setSearchQuery: (q: string) => void
  moveSearchSelection: (delta: number, max: number) => void
  setSearchIndex: (i: number) => void

  toggleAppearance: (open?: boolean) => void
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void
  setSettingsTab: (tab: SettingsTab) => void
  selectProfile: (id: string | null) => void

  /** `renderers` may be a partial patch; it is merged, not replaced. */
  updateSettings: (
    patch: Partial<Omit<Settings, 'renderers'>> & { renderers?: Partial<Record<RendererId, boolean>> },
  ) => void
  /** Accent forced by a running command, or null when none is active. */
  commandAccent: string | null
  /** Nonce+colour for the identity sweep; null when no sweep is in flight. */
  identitySweep: { id: number; color: string } | null
  /** Commit the pending accent to `--ac`. Called at the sweep's midpoint. */
  applyIdentity: () => void
  /** Called by the sweep element once its animation has finished or was cut. */
  endIdentitySweep: (id: number) => void
  upsertProfile: (profile: Profile) => void
  deleteProfile: (id: string) => void
  setDefaultProfile: (id: string) => void

  newSession: (
    profileId?: string,
    pane?: PaneId,
    restore?: { cwd?: string; history?: string[] },
  ) => Promise<void>
  /** Kill a session's shell and drop it from its pane. */
  closeSession: (id: string) => Promise<void>
  activateSession: (pane: PaneId, index: number) => void
  setSessionInput: (id: string, input: string) => void
  /** Record the grid a pane just reported, so the window title can name it. */
  setSessionSize: (id: string, cols: number, rows: number) => void
  submitInput: (id: string) => Promise<void>
  runCommand: (cmd: string, pane?: PaneId) => Promise<void>
  cancelCurrent: (id: string) => Promise<void>
  acceptGhost: (id: string) => void
  /** TAB: ask the shell to complete. Returns candidates when ambiguous. */
  requestCompletion: (id: string) => Promise<string[]>
  recallHistory: (id: string, delta: number) => void
  toggleBlockFold: (sessionId: string, blockId: string) => void
  clearBuffer: (id: string) => void

  activeSessionId: (pane?: PaneId) => string | null
}

export type SettingsTab = 'profiles' | 'appearance' | 'behavior' | 'keybindings'

const DEFAULT_SETTINGS: Settings = {
  accent: DEFAULT_IDENTITY.value,
  identityName: DEFAULT_IDENTITY.name,
  density: 'normal',
  foldThreshold: 9,
  renderers: { build: true, git: true, serve: true, err: true, list: true },
  ghostSource: 'scripts',
  restoreOnLaunch: true,
  bootSequence: true,
  scrollbackCap: 10_000,
  commandAccents: DEFAULT_COMMAND_ACCENTS,
}

/** Live PTY sessions, keyed by session id. Outside the store — not serialisable. */
const ptys = new Map<string, PtySession>()

/** Process-tree poll timers, keyed by session id. */
const toolPolls = new Map<string, number>()

/**
 * How often to ask the native side what is running under a session's shell.
 *
 * A poll rather than a subscription because neither macOS nor sysinfo will push
 * process-tree changes. 500ms reads as immediate to a person while keeping the
 * scan — which refreshes process state only, no disks or CPU — cheap. The cost
 * of the interval is that a command shorter than one tick may never be observed;
 * that is acceptable because the tools this exists for (dev servers, watchers)
 * run for minutes.
 */
const TOOL_POLL_MS = 500

let sessionCounter = 0
/**
 * Session id, unique for the lifetime of the *process* — not the webview.
 *
 * The native `PtyManager` keeps its session map across a webview reload, while
 * every module-level counter here resets to zero. A bare `s1` would therefore
 * collide with the shell the previous page load already registered, `pty_spawn`
 * would reject the id, and the new session would sit in the UI attached to
 * nothing — every command stuck on RUNNING. The random suffix makes a reloaded
 * page ask for ids the backend has never seen.
 */
const nextSessionId = () =>
  `s${++sessionCounter}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Poll the session's process tree while a command is running.
 *
 * Only polls when there is a running block with no accent yet: once a colour is
 * locked in, or nothing is running, there is nothing left to discover and the
 * scan would be pure overhead.
 */
function startToolPoll(id: string): void {
  if (toolPolls.has(id)) return
  const timer = window.setInterval(() => {
    const state = useStore.getState()
    const session = state.sessions[id]
    if (!session) {
      stopToolPoll(id)
      return
    }

    const running = session.blocks.find((b) => b.running)
    if (!running || running.accent !== undefined) {
      // Nothing to resolve. Clear stale words so a settled session does not keep
      // claiming a colour from a tree that has since exited.
      if (session.tools.length) {
        useStore.setState((s) => {
          const existing = s.sessions[id]
          if (!existing) return s
          const sessions = { ...s.sessions, [id]: { ...existing, tools: [] } }
          return { sessions, commandAccent: syncCommandAccent({ ...s, sessions }) }
        })
      }
      return
    }

    void invoke<string[]>('pty_tools', { id })
      .then((tools) => {
        useStore.setState((s) => {
          const existing = s.sessions[id]
          if (!existing) return s
          // Identical word lists are the common case between ticks; skipping the
          // update avoids re-rendering every block on a timer.
          if (
            existing.tools.length === tools.length &&
            existing.tools.every((w, i) => w === tools[i])
          ) {
            return s
          }

          // Stamp the running block so the colour locks for the rest of the run.
          const blocks = existing.blocks.map((b) => {
            if (!b.running || b.accent !== undefined) return b
            const accent = accentFor(b.cmd, s.settingsValues.commandAccents, tools)
            return accent ? { ...b, accent } : b
          })

          const sessions = { ...s.sessions, [id]: { ...existing, blocks, tools } }
          return { sessions, commandAccent: syncCommandAccent({ ...s, sessions }) }
        })
      })
      .catch(() => {
        // A dead or unknown session is expected during teardown; the next tick
        // sees the session gone and clears the timer.
      })
  }, TOOL_POLL_MS)
  toolPolls.set(id, timer)
}

function stopToolPoll(id: string): void {
  const timer = toolPolls.get(id)
  if (timer !== undefined) {
    window.clearInterval(timer)
    toolPolls.delete(id)
  }
}

export const useStore = create<StoreState>((set, get) => ({
  split: false,
  splitDir: 'row',
  paneSize: 50,
  focus: 'a',
  railOpen: true,
  railAutoCollapsed: false,

  palette: { open: false, query: '', activeIndex: 0 },
  appearance: { open: false },
  settings: { open: false, tab: 'profiles', selectedProfile: null },
  search: { open: false, query: '', activeIndex: 0 },
  identitySweep: null,
  commandAccent: null,

  panes: { a: { sessions: [], active: 0 }, b: { sessions: [], active: 0 } },
  sessions: {},
  profiles: [],
  settingsValues: DEFAULT_SETTINGS,
  host: null,

  async init() {
    // Reap shells left behind by a previous page load. `init` runs once per
    // webview load, and a reload is the only way a second one happens — at which
    // point the sessions this store described are gone but their shells are not.
    // Killing them here, before anything spawns, is what keeps a reload from
    // leaking a shell (and its PTY reader thread) on every cycle.
    await invoke<number>('pty_kill_all').catch(() => 0)

    const host = await invoke<HostInfo>('host_info')

    // Known commands power did-you-mean; failure here is non-fatal.
    invoke<string[]>('path_commands')
      .then(setKnownCommands)
      .catch(() => {})

    const raw = await invoke<string | null>('config_load').catch(() => null)
    let settingsValues = DEFAULT_SETTINGS
    let profiles: Profile[] = []
    let workspace: PersistedWorkspace | undefined

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          settings?: Partial<Settings>
          profiles?: Profile[]
          workspace?: PersistedWorkspace
        }
        // Fields are copied one at a time rather than spread, so keys retired
        // from Settings (glow, scanlines) are dropped instead of being carried
        // back into the file on the next save.
        settingsValues = pickSettings(parsed.settings)
        if (Array.isArray(parsed.profiles)) profiles = parsed.profiles
        if (parsed.workspace?.panes?.a) workspace = parsed.workspace
      } catch {
        // A corrupt config falls back to defaults rather than blocking launch.
      }
    }

    if (profiles.length === 0) {
      profiles = [
        {
          id: 'p-default',
          name: 'local',
          cwd: host.home,
          shell: host.shell,
          connectVia: 'local',
          startupCmd: '',
          env: [],
          isDefault: true,
        },
      ]
    }

    setRendererEnabled(settingsValues.renderers)
    applyTheme(settingsValues)
    set({ host, settingsValues, profiles })

    // Restore the previous workspace when the setting is on and there is one to
    // restore; otherwise open a single session from the default profile.
    if (settingsValues.restoreOnLaunch && workspace && workspace.panes.a.sessions.length > 0) {
      set({
        split: workspace.split,
        splitDir: workspace.splitDir,
        paneSize: workspace.paneSize,
        railOpen: workspace.railOpen,
      })

      for (const pane of ['a', 'b'] as PaneId[]) {
        const saved = workspace.panes[pane]
        if (pane === 'b' && !workspace.split) continue
        for (const entry of saved.sessions) {
          await get().newSession(entry.profileId, pane, {
            cwd: entry.cwd,
            history: entry.history,
          })
        }
        set((s) => ({
          panes: {
            ...s.panes,
            [pane]: {
              ...s.panes[pane],
              active: Math.min(saved.active, Math.max(0, saved.sessions.length - 1)),
            },
          },
        }))
      }
      return
    }

    await get().newSession(profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id)
  },

  setFocus: (pane) =>
    // The accent follows focus: switching panes adopts whatever that pane is
    // running, or reverts to the identity when it is idle.
    set((st) => {
      const next = { ...st, focus: pane }
      return { focus: pane, commandAccent: syncCommandAccent(next) }
    }),

  toggleSplit(dir) {
    const { split, splitDir } = get()
    // ⌘D toggles: split if solo, return to solo if already split that way.
    if (split && splitDir === dir) {
      get().closePane()
      return
    }
    if (split) {
      set({ splitDir: dir })
      return
    }
    set({ split: true, splitDir: dir, paneSize: 50 })
    // Focus follows the pane created by a split.
    void get().newSession(undefined, 'b').then(() => {
      set({ focus: 'b' })
      persist()
    })
  },

  closePane() {
    const { panes } = get()
    for (const id of panes.b.sessions) {
      void ptys.get(id)?.dispose()
      ptys.delete(id)
      stopToolPoll(id)
    }
    set((s) => {
      const sessions = { ...s.sessions }
      for (const id of s.panes.b.sessions) delete sessions[id]
      return {
        split: false,
        focus: 'a',
        sessions,
        panes: { ...s.panes, b: { sessions: [], active: 0 } },
      }
    })
  },

  setPaneSize: (pct) => {
    set({ paneSize: Math.min(78, Math.max(22, pct)) })
    persist()
  },
  setRailOpen: (open) => {
    set({ railOpen: open, railAutoCollapsed: false })
    persist()
  },

  syncRailForWidth(width) {
    // Collapse automatically below ~1100px; a manual toggle overrides for the
    // session, so only undo an auto-collapse.
    const { railOpen, railAutoCollapsed } = get()
    if (width < 1100 && railOpen) {
      set({ railOpen: false, railAutoCollapsed: true })
    } else if (width >= 1100 && !railOpen && railAutoCollapsed) {
      set({ railOpen: true, railAutoCollapsed: false })
    }
  },

  openPalette: () => set({ palette: { open: true, query: '', activeIndex: 0 } }),
  closePalette: () => set((s) => ({ palette: { ...s.palette, open: false } })),
  setPaletteQuery: (q) => set((s) => ({ palette: { ...s.palette, query: q, activeIndex: 0 } })),
  movePaletteSelection: (delta, max) =>
    set((s) => {
      if (max <= 0) return s
      const next = (s.palette.activeIndex + delta + max) % max
      return { palette: { ...s.palette, activeIndex: next } }
    }),
  setPaletteIndex: (i) => set((s) => ({ palette: { ...s.palette, activeIndex: i } })),

  openSearch: () => set({ search: { open: true, query: '', activeIndex: 0 } }),
  closeSearch: () => set((s) => ({ search: { ...s.search, open: false } })),
  setSearchQuery: (q) => set((s) => ({ search: { ...s.search, query: q, activeIndex: 0 } })),
  moveSearchSelection: (delta, max) =>
    set((s) => {
      if (max <= 0) return s
      // Wraps, so stepping past the last match returns to the first.
      const next = (s.search.activeIndex + delta + max) % max
      return { search: { ...s.search, activeIndex: next } }
    }),
  setSearchIndex: (i) => set((s) => ({ search: { ...s.search, activeIndex: i } })),

  toggleAppearance: (open) =>
    set((s) => ({ appearance: { open: open ?? !s.appearance.open } })),

  openSettings: (tab) =>
    set((s) => ({
      settings: {
        ...s.settings,
        open: true,
        tab: tab ?? s.settings.tab,
        selectedProfile: s.settings.selectedProfile ?? s.profiles[0]?.id ?? null,
      },
      appearance: { open: false },
    })),
  closeSettings: () => set((s) => ({ settings: { ...s.settings, open: false } })),
  setSettingsTab: (tab) => set((s) => ({ settings: { ...s.settings, tab } })),
  selectProfile: (id) => set((s) => ({ settings: { ...s.settings, selectedProfile: id } })),

  updateSettings(patch) {
    const current = get().settingsValues
    const next: Settings = { ...current, ...patch, renderers: current.renderers }
    if (patch.renderers) {
      next.renderers = { ...current.renderers, ...patch.renderers }
      setRendererEnabled(next.renderers)
    }
    if (patch.scrollbackCap) {
      for (const pty of ptys.values()) pty.setScrollbackCap(next.scrollbackCap)
    }
    // Changing identity is the one settings change with a visible ceremony: the
    // new accent sweeps the window. --ac is held back to the sweep's midpoint so
    // the trailing half of the band reveals UI that has already repainted; the
    // sweep element calls applyIdentity when it gets there.
    // A command override is currently painting the UI, so an identity sweep would
    // advertise a colour that will not appear until that command exits. Change
    // the setting silently instead; it takes effect on revert.
    const overridden = get().commandAccent !== null
    const sweeping =
      patch.accent !== undefined &&
      patch.accent !== current.accent &&
      !overridden &&
      !prefersReducedMotion()

    if (sweeping) {
      // Density is not part of the ceremony; only --ac waits for the midpoint.
      document.documentElement.dataset.density = next.density
    } else {
      applyTheme(next, get().commandAccent)
    }

    set({ settingsValues: next })

    // Editing the rules while something is running should take effect at once —
    // enabling a rule for the running command colours the UI immediately, and
    // disabling it reverts.
    if (patch.commandAccents) {
      set((st) => ({ commandAccent: syncCommandAccent(st) }))
    }

    persist()

    if (sweeping) {
      // The nonce makes a rapid re-switch remount the element rather than queue
      // behind the one in flight, so five fast switches land on the fifth colour.
      set({ identitySweep: { id: sweepNonce++, color: next.accent } })
    }
  },

  /** Midpoint of the sweep: commit the accent that the band is carrying. */
  applyIdentity() {
    applyTheme(get().settingsValues, get().commandAccent)
  },

  endIdentitySweep(id) {
    // Guard on the nonce so a late teardown from a superseded sweep cannot
    // remove the live one.
    if (get().identitySweep?.id === id) set({ identitySweep: null })
  },

  upsertProfile(profile) {
    set((s) => {
      const idx = s.profiles.findIndex((p) => p.id === profile.id)
      const profiles = idx === -1 ? [...s.profiles, profile] : [...s.profiles]
      if (idx !== -1) profiles[idx] = profile
      return { profiles }
    })
    persist()
  },

  deleteProfile(id) {
    set((s) => {
      const profiles = s.profiles.filter((p) => p.id !== id)
      return {
        profiles,
        settings: {
          ...s.settings,
          selectedProfile:
            s.settings.selectedProfile === id ? (profiles[0]?.id ?? null) : s.settings.selectedProfile,
        },
      }
    })
    persist()
  },

  setDefaultProfile(id) {
    set((s) => ({
      profiles: s.profiles.map((p) => ({ ...p, isDefault: p.id === id })),
    }))
    persist()
  },

  async newSession(profileId, pane, restore) {
    const state = get()
    const targetPane = pane ?? state.focus
    const profile =
      state.profiles.find((p) => p.id === profileId) ??
      state.profiles.find((p) => p.isDefault) ??
      state.profiles[0]

    const id = nextSessionId()
    // A restored cwd wins over the profile's, so reopening lands where you left.
    const cwd = restore?.cwd ?? profile?.cwd ?? state.host?.home ?? '~'
    const isRemote = !!profile && profile.connectVia !== 'local' && profile.connectVia !== ''

    const session: Session = {
      id,
      name: profile?.name ?? 'shell',
      host: isRemote ? profile!.connectVia : 'local',
      cwd,
      branch: '',
      shell: profile?.shell ?? state.host?.shell ?? '',
      // The spawn size below, until the pane has measured itself and reported.
      cols: 120,
      rows: 32,
      blocks: [],
      input: '',
      ghost: '',
      profileId: profile?.id,
      history: restore?.history ?? [],
      historyIndex: null,
      takeover: false,
      tools: [],
    }

    set((s) => ({
      sessions: { ...s.sessions, [id]: session },
      panes: {
        ...s.panes,
        [targetPane]: {
          sessions: [...s.panes[targetPane].sessions, id],
          active: s.panes[targetPane].sessions.length,
        },
      },
    }))

    const pty = new PtySession(
      id,
      cwd,
      {
        onBlocks: (blocks) => {
          set((s) => {
            const existing = s.sessions[id]
            if (!existing) return s

            // Notify when a slow command settles while the window is in the
            // background. Comparing against the previous block list means this
            // fires once, on the transition, not on every output chunk.
            const last = blocks.at(-1)
            const previous = existing.blocks.at(-1)
            if (
              last &&
              previous?.id === last.id &&
              previous.running &&
              !last.running &&
              shouldNotify(last, document.hasFocus())
            ) {
              void notifyComplete(last, existing.name)
            }

            // A matched command's colour is stamped onto its own block, so the
            // header keeps it once the global accent reverts. Resolved here
            // because this is where the rules live; the session layer has no
            // knowledge of them.
            // Tree words only describe what is running now, so they inform the
            // running block and never a settled one — a finished block's colour
            // must not be decided by whatever happens to be alive later.
            const stamped = blocks.map((b) => {
              if (b.accent !== undefined) return b
              const accent = accentFor(
                b.cmd,
                s.settingsValues.commandAccents,
                b.running ? existing.tools : undefined,
              )
              return accent ? { ...b, accent } : b
            })
            const sessions = { ...s.sessions, [id]: { ...existing, blocks: stamped } }
            // A command starting or settling is what drives the accent, so this
            // recomputes on the same transition the notification uses.
            return { sessions, commandAccent: syncCommandAccent({ ...s, sessions }) }
          })
        },
        onCwd: (newCwd) => {
          set((s) => {
            const existing = s.sessions[id]
            if (!existing) return s
            return { sessions: { ...s.sessions, [id]: { ...existing, cwd: newCwd } } }
          })
        },
        onTakeover: (active) => {
          set((s) => {
            const existing = s.sessions[id]
            if (!existing) return s
            return { sessions: { ...s.sessions, [id]: { ...existing, takeover: active } } }
          })
        },
      },
      get().settingsValues.scrollbackCap,
    )
    ptys.set(id, pty)
    startToolPoll(id)

    try {
      await pty.start({
        shell: profile?.shell,
        cwd,
        connectVia: profile?.connectVia,
        env: Object.fromEntries((profile?.env ?? []).map((e) => [e.key, e.value])),
        integrationDir: get().host?.integrationDir,
        // Lets the session detect a shell still running pre-upgrade hooks and
        // degrade instead of waiting for a `D` that will never arrive.
        hookVersion: get().host?.hookVersion,
        cols: 120,
        rows: 32,
      })
      if (profile?.startupCmd) {
        await pty.run(profile.startupCmd)
      }
    } catch (err) {
      console.error('trmnl: failed to spawn shell', err)
      // Mark the session so the pane can report a dead shell. Without this the
      // session renders as ready and every command hangs on RUNNING.
      const reason = err instanceof Error ? err.message : String(err)
      set((s) => {
        const existing = s.sessions[id]
        if (!existing) return s
        return { sessions: { ...s.sessions, [id]: { ...existing, failed: reason } } }
      })
    }

    persist()

    // Detection for the welcome state; best-effort.
    invoke<{ branch?: string }>('detect_dir', { path: cwd })
      .then((d) => {
        if (!d.branch) return
        set((s) => {
          const existing = s.sessions[id]
          if (!existing) return s
          return { sessions: { ...s.sessions, [id]: { ...existing, branch: d.branch! } } }
        })
      })
      .catch(() => {})
  },

  async closeSession(id) {
    // Kill the shell first so the PTY and its reader thread are released even if
    // the store update below throws.
    await ptys.get(id)?.dispose()
    ptys.delete(id)
    stopToolPoll(id)

    set((s) => {
      const panes = { ...s.panes }
      for (const paneId of ['a', 'b'] as PaneId[]) {
        const pane = panes[paneId]
        const index = pane.sessions.indexOf(id)
        if (index === -1) continue

        const sessions = pane.sessions.filter((sid) => sid !== id)
        // Keep the selection on a real session: step back when the last one goes,
        // otherwise hold position so closing shifts the next one into place.
        const active = Math.max(0, Math.min(pane.active, sessions.length - 1))
        panes[paneId] = { sessions, active }
      }

      const sessions = { ...s.sessions }
      delete sessions[id]
      return { panes, sessions }
    })

    // A pane with no sessions left has nothing to render; give it a fresh one so
    // the user is never staring at an empty pane with no way forward.
    const state = get()
    for (const paneId of ['a', 'b'] as PaneId[]) {
      const pane = state.panes[paneId]
      if (pane.sessions.length > 0) continue
      // Pane B simply closes; pane A always needs a session.
      if (paneId === 'b' && state.split) {
        state.closePane()
      } else if (paneId === 'a') {
        await state.newSession()
      }
    }
    persist()
  },

  activateSession: (pane, index) =>
    set((s) => {
      const panes = { ...s.panes, [pane]: { ...s.panes[pane], active: index } }
      return { panes, commandAccent: syncCommandAccent({ ...s, panes }) }
    }),

  setSessionInput(id, input) {
    set((s) => {
      const session = s.sessions[id]
      if (!session) return s
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...session, input, ghost: computeGhost(input, session, s.settingsValues), historyIndex: null },
        },
      }
    })
  },

  setSessionSize(id, cols, rows) {
    set((s) => {
      const session = s.sessions[id]
      if (!session) return s
      // A ResizeObserver fires for changes that do not move the character grid —
      // a one-pixel layout settle, a divider drag within a cell. Bailing on an
      // unchanged grid keeps those from re-rendering every block in the pane.
      if (session.cols === cols && session.rows === rows) return s
      return { sessions: { ...s.sessions, [id]: { ...session, cols, rows } } }
    })
  },

  async submitInput(id) {
    const session = get().sessions[id]
    if (!session) return
    // A session with no shell behind it can only open a block that nothing will
    // ever close, so refuse the command rather than hang it on RUNNING.
    if (session.failed) return
    const cmd = session.input
    if (!cmd.trim()) {
      // An empty return still redraws the prompt, as a real terminal does.
      await ptys.get(id)?.write('\n')
      return
    }

    set((s) => {
      const existing = s.sessions[id]
      if (!existing) return s
      return {
        sessions: {
          ...s.sessions,
          [id]: {
            ...existing,
            input: '',
            ghost: '',
            history: [...existing.history.filter((h) => h !== cmd), cmd],
            historyIndex: null,
          },
        },
      }
    })

    await ptys.get(id)?.run(cmd)
  },

  async runCommand(cmd, pane) {
    const id = get().activeSessionId(pane)
    if (!id) return
    set((s) => {
      const session = s.sessions[id]
      if (!session) return s
      return {
        sessions: {
          ...s.sessions,
          [id]: {
            ...session,
            input: '',
            ghost: '',
            history: [...session.history.filter((h) => h !== cmd), cmd],
          },
        },
      }
    })
    await ptys.get(id)?.run(cmd)
  },

  async cancelCurrent(id) {
    await ptys.get(id)?.cancel()
  },

  acceptGhost(id) {
    set((s) => {
      const session = s.sessions[id]
      if (!session || !session.ghost) return s
      const input = session.input + session.ghost
      return { sessions: { ...s.sessions, [id]: { ...session, input, ghost: '' } } }
    })
  },

  async requestCompletion(id) {
    const session = get().sessions[id]
    const pty = ptys.get(id)
    if (!session || !pty || !session.input) return []

    const { insert, candidates } = await pty.complete(session.input)

    if (insert) {
      set((s) => {
        const current = s.sessions[id]
        // The input may have changed while the shell was thinking; only apply
        // the completion if what we completed is still what is typed.
        if (!current || current.input !== session.input) return s
        return {
          sessions: {
            ...s.sessions,
            [id]: { ...current, input: current.input + insert, ghost: '' },
          },
        }
      })
    }

    return candidates
  },

  recallHistory(id, delta) {
    set((s) => {
      const session = s.sessions[id]
      if (!session || session.history.length === 0) return s

      const len = session.history.length
      let idx = session.historyIndex
      if (idx === null) {
        // Entering history from a live input: ↑ starts at the newest entry.
        idx = delta < 0 ? len - 1 : null
      } else {
        idx = idx + (delta < 0 ? -1 : 1)
        if (idx < 0) idx = 0
        if (idx >= len) idx = null
      }

      const input = idx === null ? '' : (session.history[idx] ?? '')
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...session, input, ghost: '', historyIndex: idx },
        },
      }
    })
  },

  toggleBlockFold(sessionId, blockId) {
    set((s) => {
      const session = s.sessions[sessionId]
      if (!session) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            blocks: session.blocks.map((b) =>
              b.id === blockId ? { ...b, expanded: !b.expanded } : b,
            ),
          },
        },
      }
    })
  },

  clearBuffer(id) {
    set((s) => {
      const session = s.sessions[id]
      if (!session) return s
      return { sessions: { ...s.sessions, [id]: { ...session, blocks: [] } } }
    })
  },

  activeSessionId(pane) {
    const s = get()
    const p = s.panes[pane ?? s.focus]
    return p.sessions[p.active] ?? null
  },
}))

/* --- helpers -------------------------------------------------------------- */

/**
 * Build a Settings object from an untrusted stored blob, field by field.
 *
 * Anything absent or of the wrong type falls back to the default, and unknown
 * keys are discarded — that is what keeps a retired setting from surviving in
 * the config file indefinitely.
 */
export function pickSettings(stored: Partial<Settings> | undefined): Settings {
  if (!stored) return DEFAULT_SETTINGS

  const identity = IDENTITIES.find((i) => i.name === stored.identityName)
  const density: Density[] = ['compact', 'normal', 'roomy']
  const ghost: GhostSource[] = ['history', 'scripts', 'off']

  return {
    // Only accept an accent that corresponds to a known identity, so a hand-
    // edited config cannot leave the UI with an unusable colour.
    accent: identity?.value ?? DEFAULT_SETTINGS.accent,
    identityName: identity?.name ?? DEFAULT_SETTINGS.identityName,
    density: density.includes(stored.density as Density)
      ? (stored.density as Density)
      : DEFAULT_SETTINGS.density,
    foldThreshold:
      typeof stored.foldThreshold === 'number'
        ? Math.min(60, Math.max(3, stored.foldThreshold))
        : DEFAULT_SETTINGS.foldThreshold,
    renderers: { ...DEFAULT_SETTINGS.renderers, ...(stored.renderers ?? {}) },
    // Each rule is validated individually: a malformed colour would propagate
    // through every color-mix-derived token, so a bad row is dropped rather than
    // allowed to break the theme. An absent list falls back to the shipped
    // defaults; an empty-but-present list is respected as a deliberate choice.
    commandAccents: Array.isArray(stored.commandAccents)
      ? stored.commandAccents.filter(
          (r): r is CommandAccent =>
            !!r &&
            typeof r.id === 'string' &&
            typeof r.match === 'string' &&
            typeof r.label === 'string' &&
            typeof r.color === 'string' &&
            typeof r.enabled === 'boolean' &&
            isValidColor(r.color),
        )
      : DEFAULT_SETTINGS.commandAccents,
    ghostSource: ghost.includes(stored.ghostSource as GhostSource)
      ? (stored.ghostSource as GhostSource)
      : DEFAULT_SETTINGS.ghostSource,
    restoreOnLaunch:
      typeof stored.restoreOnLaunch === 'boolean'
        ? stored.restoreOnLaunch
        : DEFAULT_SETTINGS.restoreOnLaunch,
    bootSequence:
      typeof stored.bootSequence === 'boolean'
        ? stored.bootSequence
        : DEFAULT_SETTINGS.bootSequence,
    scrollbackCap:
      typeof stored.scrollbackCap === 'number' && stored.scrollbackCap > 0
        ? stored.scrollbackCap
        : DEFAULT_SETTINGS.scrollbackCap,
  }
}

/** Monotonic so each sweep is a distinct element, never a reused one. */
let sweepNonce = 0

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Recompute the command accent from whatever is running in the focused pane.
 *
 * The accent is a single `:root` variable, so it cannot differ per pane. Scoping
 * it to the *focused* pane's running command is the resolution: the colour tracks
 * where you are looking. A command still running in a background pane does not
 * fight for the theme, and focusing that pane picks its colour up.
 *
 * Called on every block update, focus change and settings change. It writes to
 * the DOM only when the resolved colour actually differs, so the common case
 * (output streaming, no colour change) costs one comparison.
 */
function syncCommandAccent(
  state: Pick<StoreState, 'panes' | 'focus' | 'sessions' | 'settingsValues' | 'commandAccent'>,
): string | null {
  const pane = state.panes[state.focus]
  const sessionId = pane.sessions[pane.active]
  const session = sessionId ? state.sessions[sessionId] : undefined

  let next: string | null = null
  if (session) {
    // The running block, if any. Only one command runs per session at a time.
    const running = session.blocks.find((b) => b.running)
    if (running) {
      // A block that already claimed a colour keeps it for the rest of the run.
      // The tree is polled, so a later poll could otherwise surface a different
      // tool and flip the accent mid-command; locking to the first match keeps a
      // `run-p` launching several watchers from flickering.
      next =
        running.accent ??
        accentFor(running.cmd, state.settingsValues.commandAccents, session.tools)
    }
  }

  if (next !== state.commandAccent) {
    applyTheme(state.settingsValues, next)
  }
  return next
}

/** Apply the token-level theme to :root. */
function applyTheme(settings: Settings, override?: string | null): void {
  const root = document.documentElement
  // A command override wins over the configured identity for as long as it runs.
  // `settings.accent` is never mutated, so the user's identity survives untouched
  // and reverting is just dropping the override.
  root.style.setProperty('--ac', override ?? settings.accent)
  root.dataset.density = settings.density
}

/** The window layout and session list, restored on the next launch. */
interface PersistedWorkspace {
  split: boolean
  splitDir: SplitDir
  paneSize: number
  railOpen: boolean
  panes: Record<PaneId, { active: number; sessions: { profileId?: string; cwd: string; history: string[] }[] }>
}

/** Debounced write of the persisted slice. Settings save immediately. */
let saveTimer: number | null = null
function persist(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    const state = useStore.getState()
    const { settingsValues, profiles } = state

    // Scrollback is deliberately not persisted: it can run to 10k lines per
    // session, and writing that on every layout change would make the config
    // file unusable as the dotfile it is meant to be. cwd and history are what
    // make a restored session feel continuous.
    const workspace: PersistedWorkspace | undefined = settingsValues.restoreOnLaunch
      ? {
          split: state.split,
          splitDir: state.splitDir,
          paneSize: state.paneSize,
          railOpen: state.railOpen,
          panes: {
            a: serialisePane(state, 'a'),
            b: serialisePane(state, 'b'),
          },
        }
      : undefined

    void invoke('config_save', {
      contents: JSON.stringify({ settings: settingsValues, profiles, workspace }, null, 2),
    }).catch((err) => console.error('trmnl: could not save config', err))
  }, 180)
}

function serialisePane(
  state: StoreState,
  pane: PaneId,
): PersistedWorkspace['panes'][PaneId] {
  const p = state.panes[pane]
  return {
    active: p.active,
    sessions: p.sessions.flatMap((id) => {
      const session = state.sessions[id]
      if (!session) return []
      return [
        {
          profileId: session.profileId,
          cwd: session.cwd,
          // Cap history so the file stays small on a long-lived session.
          history: session.history.slice(-100),
        },
      ]
    }),
  }
}

/** Ghost suggestion: the remainder of the best history match. */
function computeGhost(input: string, session: Session, settings: Settings): string {
  if (!input || settings.ghostSource === 'off') return ''
  // Newest first, so the most recent matching command wins.
  for (let i = session.history.length - 1; i >= 0; i--) {
    const entry = session.history[i]
    if (entry && entry.length > input.length && entry.startsWith(input)) {
      return entry.slice(input.length)
    }
  }
  return ''
}

export function getPty(id: string): PtySession | undefined {
  return ptys.get(id)
}
