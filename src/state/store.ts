/** Window store.
 *
 * One window = one store; panes are children. The handoff notes the prototype
 * kept every option's state in one component keyed by letter because it rendered
 * ten terminals on a page — that is an artifact of the design document and is
 * deliberately not reproduced here.
 */

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

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
}

export interface Settings {
  accent: string
  identityName: string
  density: Density
  foldThreshold: number
  renderers: Record<RendererId, boolean>
  ghostSource: GhostSource
  restoreOnLaunch: boolean
  scrollbackCap: number
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

  toggleAppearance: (open?: boolean) => void
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void
  setSettingsTab: (tab: SettingsTab) => void
  selectProfile: (id: string | null) => void

  /** `renderers` may be a partial patch; it is merged, not replaced. */
  updateSettings: (
    patch: Partial<Omit<Settings, 'renderers'>> & { renderers?: Partial<Record<RendererId, boolean>> },
  ) => void
  upsertProfile: (profile: Profile) => void
  deleteProfile: (id: string) => void
  setDefaultProfile: (id: string) => void

  newSession: (profileId?: string, pane?: PaneId) => Promise<void>
  activateSession: (pane: PaneId, index: number) => void
  setSessionInput: (id: string, input: string) => void
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
  renderers: { build: true, git: true, serve: true, err: true },
  ghostSource: 'scripts',
  restoreOnLaunch: true,
  scrollbackCap: 10_000,
}

/** Live PTY sessions, keyed by session id. Outside the store — not serialisable. */
const ptys = new Map<string, PtySession>()

let sessionCounter = 0
const nextSessionId = () => `s${++sessionCounter}`

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

  panes: { a: { sessions: [], active: 0 }, b: { sessions: [], active: 0 } },
  sessions: {},
  profiles: [],
  settingsValues: DEFAULT_SETTINGS,
  host: null,

  async init() {
    const host = await invoke<HostInfo>('host_info')

    // Known commands power did-you-mean; failure here is non-fatal.
    invoke<string[]>('path_commands')
      .then(setKnownCommands)
      .catch(() => {})

    const raw = await invoke<string | null>('config_load').catch(() => null)
    let settingsValues = DEFAULT_SETTINGS
    let profiles: Profile[] = []

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          settings?: Partial<Settings>
          profiles?: Profile[]
        }
        // Fields are copied one at a time rather than spread, so keys retired
        // from Settings (glow, scanlines) are dropped instead of being carried
        // back into the file on the next save.
        settingsValues = pickSettings(parsed.settings)
        if (Array.isArray(parsed.profiles)) profiles = parsed.profiles
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

    await get().newSession(profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id)
  },

  setFocus: (pane) => set({ focus: pane }),

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
    void get().newSession(undefined, 'b').then(() => set({ focus: 'b' }))
  },

  closePane() {
    const { panes } = get()
    for (const id of panes.b.sessions) {
      void ptys.get(id)?.dispose()
      ptys.delete(id)
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

  setPaneSize: (pct) => set({ paneSize: Math.min(78, Math.max(22, pct)) }),
  setRailOpen: (open) => set({ railOpen: open, railAutoCollapsed: false }),

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
    applyTheme(next)
    set({ settingsValues: next })
    persist()
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

  async newSession(profileId, pane) {
    const state = get()
    const targetPane = pane ?? state.focus
    const profile =
      state.profiles.find((p) => p.id === profileId) ??
      state.profiles.find((p) => p.isDefault) ??
      state.profiles[0]

    const id = nextSessionId()
    const cwd = profile?.cwd ?? state.host?.home ?? '~'
    const isRemote = !!profile && profile.connectVia !== 'local' && profile.connectVia !== ''

    const session: Session = {
      id,
      name: profile?.name ?? 'shell',
      host: isRemote ? profile!.connectVia : 'local',
      cwd,
      branch: '',
      blocks: [],
      input: '',
      ghost: '',
      profileId: profile?.id,
      history: [],
      historyIndex: null,
      takeover: false,
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
            return { sessions: { ...s.sessions, [id]: { ...existing, blocks } } }
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

    try {
      await pty.start({
        shell: profile?.shell,
        cwd: profile?.cwd,
        connectVia: profile?.connectVia,
        env: Object.fromEntries((profile?.env ?? []).map((e) => [e.key, e.value])),
        integrationDir: get().host?.integrationDir,
        cols: 120,
        rows: 32,
      })
      if (profile?.startupCmd) {
        await pty.run(profile.startupCmd)
      }
    } catch (err) {
      console.error('trmnl: failed to spawn shell', err)
    }

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

  activateSession: (pane, index) =>
    set((s) => ({ panes: { ...s.panes, [pane]: { ...s.panes[pane], active: index } } })),

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

  async submitInput(id) {
    const session = get().sessions[id]
    if (!session) return
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
    ghostSource: ghost.includes(stored.ghostSource as GhostSource)
      ? (stored.ghostSource as GhostSource)
      : DEFAULT_SETTINGS.ghostSource,
    restoreOnLaunch:
      typeof stored.restoreOnLaunch === 'boolean'
        ? stored.restoreOnLaunch
        : DEFAULT_SETTINGS.restoreOnLaunch,
    scrollbackCap:
      typeof stored.scrollbackCap === 'number' && stored.scrollbackCap > 0
        ? stored.scrollbackCap
        : DEFAULT_SETTINGS.scrollbackCap,
  }
}

/** Apply the token-level theme to :root. */
function applyTheme(settings: Settings): void {
  const root = document.documentElement
  root.style.setProperty('--ac', settings.accent)
  root.dataset.density = settings.density
}

/** Debounced write of the persisted slice. Settings save immediately. */
let saveTimer: number | null = null
function persist(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    const { settingsValues, profiles } = useStore.getState()
    void invoke('config_save', {
      contents: JSON.stringify({ settings: settingsValues, profiles }, null, 2),
    }).catch((err) => console.error('trmnl: could not save config', err))
  }, 180)
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
