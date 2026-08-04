/** Window shell: title bar, rail, panes, divider, and the modal surfaces. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { formatWindowTitle } from './lib/windowTitle'
import { formatChord, resolveKeybindings } from './lib/keybindings'
import { Appearance } from './components/Appearance'
import { Boot } from './components/Boot'
import { ContextMenu } from './components/ContextMenu'
import { Pane } from './components/Pane'
import { Palette } from './components/Palette'
import { Search } from './components/Search'
import { Settings } from './components/Settings'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { listenForMenuEvents } from './lib/menuEvents'
import { listenForConfigSync, useStore } from './state/store'

/**
 * Module scope, so it survives a re-mount of App but not a real app launch.
 * That is what makes the boot sequence once-per-launch: a new session, a split
 * and a session switch all leave this alone, and none of them re-mount App
 * anyway.
 */
let bootConsumed = false

export function App() {
  const split = useStore((s) => s.split)
  const splitDir = useStore((s) => s.splitDir)
  const paneSize = useStore((s) => s.paneSize)
  const setPaneSize = useStore((s) => s.setPaneSize)
  const paneMaximized = useStore((s) => s.paneMaximized)
  const focus = useStore((s) => s.focus)
  const setFocus = useStore((s) => s.setFocus)

  const sweep = useStore((s) => s.identitySweep)
  const bootSequence = useStore((s) => s.settingsValues.bootSequence)

  const init = useStore((s) => s.init)
  const started = useRef(false)

  // Drives the cold-boot overlay's exit. It flips when init settles, so the
  // animation can never outlive real initialisation. Read from the module-scope
  // latch so a re-mount after launch (StrictMode, HMR) does not replay the boot.
  const [initSettled, setInitSettled] = useState(bootConsumed)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // `finally`, not `then`: a failed init must still release the overlay,
    // otherwise an error state would sit behind a decorative animation.
    void init().finally(() => {
      bootConsumed = true
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
    <div className="frame">
      <TitleBar />

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
            >
              <DividerTrace />
              <span className="divider__grip" />
            </div>
          )}

          {split && (!paneMaximized || focus === 'b') && (
            <div className="panes__slot" style={{ flex: paneMaximized ? '1 1 auto' : 1 }}>
              <Pane pane="b" showClose />
            </div>
          )}
        </div>
      </div>

      <StatusBar />

      {/* Keyed on the nonce so a switch mid-sweep remounts the band from its
          start frame rather than reusing an element already part-way across. */}
      {sweep && <IdentitySweep key={sweep.id} id={sweep.id} color={sweep.color} />}

      {/* Mounts on the first paint, before the persisted setting is known — the
          animation has to start with the window or it is pointless. `ready`
          carries both exit conditions: init settling, and the stored setting
          turning out to be off (init is what loads it). */}
      {!bootConsumed && <Boot ready={initSettled || !bootSequence} />}

      <Palette />
      <Appearance />
      <Settings />
      <Search />
      <ContextMenu />

      {/* Focus-follows-click is handled per pane; this catches the gap between
          them so a click never lands nowhere. */}
      <div
        className="frame__sink"
        onMouseDown={() => setFocus(focus)}
        aria-hidden
      />
    </div>
  )
}

const SWEEP_MS = 250

/**
 * One pass of the incoming accent across the window.
 *
 * Keyed on the store's nonce by the parent, so a switch made mid-sweep replaces
 * this element rather than restarting it — five fast switches leave exactly one
 * band in flight, carrying the fifth colour.
 *
 * Teardown is belt-and-braces on purpose. `animationend` is the normal path, but
 * it never fires if the animation is dropped (a hidden window throttles frames,
 * `animation: none` from a user stylesheet, an unmount race), and a stuck
 * full-window layer is the worst possible failure even though it cannot swallow
 * clicks. The timer guarantees the element is gone; both paths are nonce-guarded
 * in the store so whichever loses the race is a no-op.
 */
function IdentitySweep({ id, color }: { id: number; color: string }) {
  const applyIdentity = useStore((s) => s.applyIdentity)
  const endIdentitySweep = useStore((s) => s.endIdentitySweep)

  useEffect(() => {
    // The swap lands at the midpoint so the trailing half reveals repainted UI.
    const swap = window.setTimeout(applyIdentity, SWEEP_MS / 2)
    // Generous margin over the animation so the timer is a backstop, not a race
    // with animationend.
    const done = window.setTimeout(() => endIdentitySweep(id), SWEEP_MS + 150)
    return () => {
      clearTimeout(swap)
      clearTimeout(done)
      // Unmounting before the midpoint must still commit the colour, or a switch
      // superseded early would leave --ac on the previous identity.
      applyIdentity()
    }
  }, [id, applyIdentity, endIdentitySweep])

  return (
    <div
      className="frame__sweep"
      style={{ '--sweep-ac': color } as React.CSSProperties}
      onAnimationEnd={() => endIdentitySweep(id)}
      aria-hidden
    />
  )
}

/**
 * The divider drawing itself along its length when a split is created.
 *
 * Fires on appearance only. The parent mounts this with the divider, and
 * `appeared` latches false once the trace is done, which unmounts the element —
 * so a re-render, a drag, or a later change of split axis cannot re-trigger it.
 * The divider itself is never animated: the trace is a throwaway child, so the
 * full 4px hit area is draggable from the first frame and onDividerDown/Move/Up
 * are untouched. It also never sees pointer events (`pointer-events: none`).
 *
 * animationend is the normal teardown; the timer is the backstop for when it does
 * not arrive (throttled frames in a hidden window, a user stylesheet killing the
 * animation). Whichever fires first wins and the other is a no-op.
 */
function DividerTrace() {
  const [appeared, setAppeared] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setAppeared(false), 400)
    return () => clearTimeout(timer)
  }, [])

  if (!appeared) return null

  // data-dir on the parent .divider selects the axis; see .divider__trace.
  return (
    <span
      className="divider__trace"
      onAnimationEnd={() => setAppeared(false)}
      aria-hidden
    />
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
    // it is the same "TRMNL" the config booted with.
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
 * Global chords. Esc closes in priority order: settings → appearance → palette
 * → search — neither remappable nor part of the resolved keymap below.
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
        // Priority order: settings → appearance → palette → search.
        if (store.settings.open) {
          store.closeSettings()
          event.preventDefault()
        } else if (store.appearance.open) {
          store.toggleAppearance(false)
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
