/** Command palette — ⌘K. */

import { useEffect, useMemo, useRef } from 'react'

import { rank } from '../lib/fuzzy'
import { useStore } from '../state/store'

type ItemAction =
  | { type: 'new-session'; profileId?: string }
  | { type: 'split'; dir: 'row' | 'col' }
  | { type: 'close-pane' }
  | { type: 'run'; cmd: string }
  | { type: 'clear' }
  | { type: 'appearance' }
  | { type: 'settings' }

interface Item {
  group: string
  label: string
  description?: string
  kbd?: string
  action: ItemAction
  /** Times run, for frequency ranking. */
  uses?: number
}

/** Selecting a RUN item waits out the dismiss animation before executing. */
const RUN_DELAY_MS = 40

export function Palette() {
  const open = useStore((s) => s.palette.open)
  const query = useStore((s) => s.palette.query)
  const activeIndex = useStore((s) => s.palette.activeIndex)
  const setQuery = useStore((s) => s.setPaletteQuery)
  const closePalette = useStore((s) => s.closePalette)
  const movePaletteSelection = useStore((s) => s.movePaletteSelection)
  const setPaletteIndex = useStore((s) => s.setPaletteIndex)

  const profiles = useStore((s) => s.profiles)
  const sessionId = useStore((s) => s.activeSessionId())
  const history = useStore((s) => (sessionId ? s.sessions[sessionId]?.history : undefined))

  const newSession = useStore((s) => s.newSession)
  const toggleSplit = useStore((s) => s.toggleSplit)
  const closePane = useStore((s) => s.closePane)
  const closeSession = useStore((s) => s.closeSession)
  const runCommand = useStore((s) => s.runCommand)
  const clearBuffer = useStore((s) => s.clearBuffer)
  const toggleAppearance = useStore((s) => s.toggleAppearance)
  const openSettings = useStore((s) => s.openSettings)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<Item[]>(() => {
    const uses = new Map<string, number>()
    for (const cmd of history ?? []) uses.set(cmd, (uses.get(cmd) ?? 0) + 1)

    const base: Item[] = [
      { group: 'SESSION', label: 'New Tab', description: 'local shell', kbd: '⌘T', action: { type: 'new-session' } },
      { group: 'SESSION', label: 'Split Right', description: 'vertical pane', kbd: '⌘D', action: { type: 'split', dir: 'row' } },
      { group: 'SESSION', label: 'Split Down', description: 'horizontal pane', kbd: '⌘⇧D', action: { type: 'split', dir: 'col' } },
      { group: 'SESSION', label: 'Close Session', kbd: '⌘W', action: { type: 'close-pane' } },
    ]

    for (const profile of profiles) {
      base.push({
        group: 'CONNECT',
        label: profile.connectVia !== 'local' ? profile.connectVia : profile.name,
        description: profile.connectVia !== 'local' ? `ssh · ${profile.name}` : profile.cwd,
        kbd: '↵',
        action: { type: 'new-session', profileId: profile.id },
      })
    }

    // Real history, most recent first, rather than a hardcoded list.
    const seen = new Set<string>()
    for (const cmd of [...(history ?? [])].reverse()) {
      if (seen.has(cmd)) continue
      seen.add(cmd)
      if (seen.size > 12) break
      base.push({
        group: 'RUN',
        label: cmd,
        kbd: '↵',
        action: { type: 'run', cmd },
        uses: uses.get(cmd) ?? 0,
      })
    }

    base.push(
      { group: 'SYSTEM', label: 'Clear Buffer', kbd: '⌃L', action: { type: 'clear' } },
      { group: 'SYSTEM', label: 'Appearance…', kbd: '⌘,', action: { type: 'appearance' } },
      { group: 'SYSTEM', label: 'All Settings…', action: { type: 'settings' } },
    )

    return base
  }, [profiles, history])

  const results = useMemo(() => {
    if (!query.trim()) return items
    return rank(
      query.trim(),
      items,
      (item) => [item.label, item.description ?? ''],
      (item) => item.uses ?? 0,
    ).map((r) => r.item)
  }, [items, query])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keep the active row in view as the selection moves.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  if (!open) return null

  const activate = (item: Item) => {
    closePalette()
    const run = () => {
      switch (item.action.type) {
        case 'new-session':
          void newSession(item.action.profileId)
          break
        case 'split':
          toggleSplit(item.action.dir)
          break
        case 'close-pane':
          if (useStore.getState().split) {
            closePane()
          } else if (sessionId) {
            void closeSession(sessionId)
          }
          break
        case 'run':
          void runCommand(item.action.cmd)
          break
        case 'clear':
          if (sessionId) clearBuffer(sessionId)
          break
        case 'appearance':
          toggleAppearance(true)
          break
        case 'settings':
          openSettings()
          break
      }
    }
    // Only RUN needs the delay; the rest are instant UI changes.
    if (item.action.type === 'run') window.setTimeout(run, RUN_DELAY_MS)
    else run()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        movePaletteSelection(1, results.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        movePaletteSelection(-1, results.length)
        break
      case 'Enter': {
        event.preventDefault()
        const item = results[activeIndex]
        if (item) activate(item)
        break
      }
      default:
        break
    }
  }

  // Group headers are inserted as the list is walked, so ordering follows rank.
  let lastGroup = ''

  return (
    <div className="overlay" onMouseDown={closePalette}>
      <div
        className="palette"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <span className="bracket bracket--tl" style={{ width: 11, height: 11 }} />
        <span className="bracket bracket--br" style={{ width: 11, height: 11 }} />

        <div className="palette__head">
          <span className="micro">COMMAND PALETTE</span>
          <span className="palette__count">{results.length} MATCHES</span>
        </div>

        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          placeholder="Search sessions, hosts, commands…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          aria-label="Search"
        />

        <div className="palette__results" ref={listRef}>
          {results.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <div key={`${item.group}-${item.label}-${i}`}>
                {header && <div className="palette__group micro">{header}</div>}
                <button
                  className="palette__item"
                  data-active={i === activeIndex}
                  onClick={() => activate(item)}
                  onMouseEnter={() => setPaletteIndex(i)}
                  type="button"
                >
                  <span className="palette__label">{item.label}</span>
                  <span className="rule" />
                  {item.description && (
                    <span className="palette__desc">{item.description}</span>
                  )}
                  {item.kbd && <span className="kbd">{item.kbd}</span>}
                </button>
              </div>
            )
          })}
          {results.length === 0 && <div className="palette__empty">No matches</div>}
        </div>

        <div className="palette__foot">
          <span>↑↓ NAVIGATE</span>
          <span>↵ SELECT</span>
          <span>ESC CLOSE</span>
        </div>
      </div>
    </div>
  )
}
