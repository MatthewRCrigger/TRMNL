/** Window shell: top bar, panes, divider, and the modal surfaces.
 *
 * The whole window is a double frame in --line-100 — the outermost container of
 * a view, which is the one place the figure is allowed. Everything inside it is
 * single hairlines, or the screen turns to corduroy.
 *
 * There is no boot sequence, no identity sweep and no divider trace. GRID's
 * motion rules forbid entrance animation outright: a machine display either
 * shows a state or it doesn't. What replaces the cold boot is the static attach
 * frame, which is what is on screen for the ~40ms before first paint rather
 * than a sequence anyone waits through.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { formatWindowTitle } from './lib/windowTitle'
import { formatChord, resolveKeybindings } from './lib/keybindings'
import { AttachFrame } from './components/AttachFrame'
import { CloseConfirm } from './components/CloseConfirm'
import { ContextMenu } from './components/ContextMenu'
import { Pane } from './components/Pane'
import { Palette } from './components/Palette'
import { Search } from './components/Search'
import { Settings } from './components/Settings'
import { TelemetryBar } from './components/TelemetryBar'
import { TopBar } from './components/TopBar'
import { Frame } from './components/grid'
import { listenForMenuEvents } from './lib/menuEvents'
import { listenForConfigSync, useStore } from './state/store'

/**
 * Module scope, so it survives a re-mount of App but not a real app launch.
 * The attach frame is shown once per launch and never again — a new session, a
 * split and a session switch all leave this alone, and none of them re-mount
 * App anyway.
 */
let attachConsumed = false

export function App() {
  const split = useStore((s) => s.split)
  const splitDir = useStore((s) => s.splitDir)
  const paneSize = useStore((s) => s.paneSize)
  const setPaneSize = useStore((s) => s.setPaneSize)
  const paneMaximized = useStore((s) => s.paneMaximized)
  const focus = useStore((s) => s.focus)
  const setFocus = useStore((s) => s.setFocus)

  const init = useStore((s) => s.init)
  const started = useRef(false)

  // Drives the attach frame's removal. It flips when init settles — the frame
  // is what is on screen *until there is something to show*, not a timed
  // sequence. Read from the module-scope latch so a re-mount after launch
  // (StrictMode, HMR) does not replay it.
  const [initSettled, setInitSettled] = useState(attachConsumed)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // `finally`, not `then`: a failed init must still release the frame,
    // otherwise an error state would sit behind a splash.
    void init().finally(() => {
      attachConsumed = true
      setInitSettled(true)
    })
  }, [init])

  useGlobalKeys()
  useWindowTitle()

  // The native menu is where Settings / New Session / Close Session now come
  // from, including their chords — see lib/menuEvents.ts.
  useEffect(() => listenForMenuEvents(), [])

  // Settings and profiles are application-global, so a change in another window
  // has to land here too — otherwise each window shows a different profile list
  // until it is reloaded.
  useEffect(() => listenForConfigSync(), [])

  /* --- divider drag ------------------------------------------------------- */

  const framRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onDividerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      dragging.current = true
      const target = event.currentTarget as HTMLElement
      // Pointer capture keeps events coming even when the cursor outruns the
      // 4px divider.
      target.setPointerCapture(event.pointerId)
    },
    [],
  )

  const onDividerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragging.current) return
      const host = framRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const pct =
        splitDir === 'row'
          ? ((event.clientX - rect.left) / rect.width) * 100
          : ((event.clientY - rect.top) / rect.height) * 100
      setPaneSize(pct)
    },
    [splitDir, setPaneSize],
  )

  const onDividerUp = useCallback((event: React.PointerEvent) => {
    dragging.current = false
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
  }, [])

  return (
    /* The window's double frame: outer 2px / 8px radius / 4px of void / inner
       2px / 4px radius. Reserved for the outermost container of a view, which
       this is. */
    <Frame className="frame" color="var(--line-100)">
      <TopBar />

      <div className="frame__body">
        <div
          className="panes"
          data-dir={splitDir}
          ref={framRef}
          style={{ flexDirection: splitDir === 'row' ? 'row' : 'column' }}
        >
          {/* Maximized hides the unfocused pane's DOM entirely rather than
              just collapsing its flex box — its session keeps running in the
              background, but an off-screen xterm.js grid (for any takeover
              program) is not worth keeping laid out. */}
          {(!split || !paneMaximized || focus === 'a') && (
            <div
              className="panes__slot"
              style={
                !split
                  ? { flex: '1 1 auto' }
                  : paneMaximized
                    ? { flex: '1 1 auto' }
                    : { flex: `0 0 ${paneSize}%` }
              }
            >
              <Pane pane="a" showClose={false} />
            </div>
          )}

          {/* A single 1px --line-300 line, not a 4px slab with a grip. Depth
              does the work instead: the focused pane sits on --void and the
              unfocused one on --surface-1. The hit area is widened by a
              transparent ::before rather than by the line itself. */}
          {split && !paneMaximized && (
            <div
              className="divider"
              data-dir={splitDir}
              data-dragging={dragging.current}
              onPointerDown={onDividerDown}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
              onPointerCancel={onDividerUp}
              role="separator"
              aria-orientation={splitDir === 'row' ? 'vertical' : 'horizontal'}
              aria-label="Resize panes"
            />
          )}

          {split && (!paneMaximized || focus === 'b') && (
            <div className="panes__slot" style={{ flex: paneMaximized ? '1 1 auto' : 1 }}>
              <Pane pane="b" showClose />
            </div>
          )}
        </div>
      </div>

      <TelemetryBar />

      {/* Replaces the cold boot. Nothing draws in, nothing resolves from wide
          tracking — it is what is on screen before first paint, not a sequence. */}
      {!attachConsumed && !initSettled && <AttachFrame />}

      <Palette />
      <Settings />
      <Search />
      <ContextMenu />
      <CloseConfirm />

      {/* Focus-follows-click is handled per pane; this catches the gap between
          them so a click never lands nowhere. */}
      <div className="frame__sink" onMouseDown={() => setFocus(focus)} aria-hidden />
    </Frame>
  )
}

/**
 * Scroll to the previous/next command block in the focused pane.
 *
 * Works off the rendered DOM rather than store indices so it lands on what the
 * user can actually see — a folded or filtered block is still a real anchor.
 */
function jumpBlock(direction: 1 | -1): void {
  const pane = document.querySelector<HTMLElement>('.pane[data-focused="true"]')
  const stream = pane?.querySelector<HTMLElement>('.pane__stream')
  if (!stream) return

  const blocks = Array.from(stream.querySelectorAll<HTMLElement>('.block'))
  if (blocks.length === 0) return

  // The block nearest the top of the viewport is the current reading position.
  const top = stream.scrollTop
  let current = 0
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i]
    if (!el) continue
    if (el.offsetTop - stream.offsetTop <= top + 4) current = i
  }

  const next = Math.min(blocks.length - 1, Math.max(0, current + direction))
  const target = blocks[next]
  if (!target) return
  stream.scrollTo({ top: target.offsetTop - stream.offsetTop, behavior: 'smooth' })

  // A brief flash marks where you landed; without it a jump between two similar
  // blocks is hard to perceive.
  target.setAttribute('data-jumped', 'true')
  window.setTimeout(() => target.removeAttribute('data-jumped'), 600)
}

/**
 * Keep the macOS window title describing the focused session.
 *
 * Subscribed to the store directly rather than through selectors, because the
 * title depends on almost everything — focus, the active session, its cwd, its
 * running block, its grid — and pulling all of that through `useStore` would
 * re-render the whole window shell on every output chunk just to compute a
 * string. The subscriber runs on every store write instead, which is cheap: it
 * reads five fields, formats them, and compares.
 *
 * That comparison is the important part. Output streaming updates the store many
 * times a second while producing an identical title, and `setTitle` is an IPC
 * call to the native side — so the guard is what keeps this from flooding the
 * bridge. The title only actually changes on the transitions that matter: a
 * command starting or settling, a cd, a focus or session switch, a resize.
 */
function useWindowTitle(): void {
  useEffect(() => {
    // Held outside the subscriber so it survives across store writes; the empty
    // initial value guarantees the first computed title is always sent, even if
    // it is the same "CRGGR.sh" the config booted with.
    let applied = ''

    const sync = (state: ReturnType<typeof useStore.getState>) => {
      const pane = state.panes[state.focus]
      const sessionId = pane.sessions[pane.active]
      const session = sessionId ? state.sessions[sessionId] : undefined

      // Only the last block can be running — a session runs one command at a
      // time — so this is the command the window is currently occupied with.
      const last = session?.blocks.at(-1)
      const running = last?.running ? last : undefined

      const title = formatWindowTitle({
        cwd: session?.cwd,
        // A block opened by an unintegrated shell carries no command text; the
        // process tree is the only description of what is running in that case.
        command: running ? running.cmd || session?.tools[0] : undefined,
        shell: session?.shell,
        home: state.host?.home,
        cols: session?.cols,
        rows: session?.rows,
      })

      if (title === applied) return
      applied = title
      // Best-effort: a title that fails to apply is cosmetic, and throwing here
      // would take down a store subscriber on every subsequent write.
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => {})
    }

    sync(useStore.getState())
    return useStore.subscribe(sync)
  }, [])
}

/**
 * Global chords. Esc closes in priority order: settings → palette → search —
 * neither remappable nor part of the resolved keymap below.
 *
 * ⌘T, ⌘W and ⌘, are absent on purpose: the native menu declares them as key
 * equivalents, so AppKit performs the menu item and this handler never sees
 * the chord. The behaviour lives in lib/menuEvents.ts, and they are not part
 * of the remappable set in lib/keybindings.ts for the same reason — see that
 * module's header comment.
 */
function useGlobalKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useStore.getState()

      if (event.key === 'Escape') {
        // Priority order: close-confirm → settings → palette → search.
        // The confirm dialog sits above everything else it could be layered
        // over, so backing out of it takes priority over any other overlay.
        if (store.closeConfirm) {
          store.cancelClose()
          event.preventDefault()
        } else if (store.settings.open) {
          store.closeSettings()
          event.preventDefault()
        } else if (store.palette.open) {
          store.closePalette()
          event.preventDefault()
        } else if (store.search.open) {
          store.closeSearch()
          event.preventDefault()
        }
        return
      }

      const chord = formatChord(event)
      if (chord === null) return // A bare modifier keypress, not a complete chord.

      const bindings = resolveKeybindings(store.settingsValues.keybindings)

      switch (chord) {
        case bindings.palette:
          event.preventDefault()
          if (store.palette.open) store.closePalette()
          else store.openPalette()
          break
        case bindings.search:
          event.preventDefault()
          if (store.search.open) store.closeSearch()
          else store.openSearch()
          break
        case bindings['prev-block']:
          // ⌘[ / ⌘] step between command blocks — the payoff of the block model.
          event.preventDefault()
          jumpBlock(-1)
          break
        case bindings['next-block']:
          event.preventDefault()
          jumpBlock(1)
          break
        case bindings['split-right']:
          event.preventDefault()
          store.toggleSplit('row')
          break
        case bindings['split-down']:
          event.preventDefault()
          store.toggleSplit('col')
          break
        case bindings['maximize-pane']:
          event.preventDefault()
          store.toggleMaximizePane()
          break
        case bindings['focus-left']:
          event.preventDefault()
          store.setFocus('a')
          break
        case bindings['focus-right']:
          if (store.split) {
            event.preventDefault()
            store.setFocus('b')
          }
          break
        case bindings['clear-buffer']: {
          const id = store.activeSessionId()
          if (id) {
            store.clearBuffer(id)
            event.preventDefault()
          }
          break
        }
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
