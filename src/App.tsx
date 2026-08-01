/** Window shell: title bar, rail, panes, divider, and the modal surfaces. */

import { useCallback, useEffect, useRef } from 'react'

import { Appearance } from './components/Appearance'
import { Pane } from './components/Pane'
import { Palette } from './components/Palette'
import { Rail } from './components/Rail'
import { Search } from './components/Search'
import { Settings } from './components/Settings'
import { TitleBar } from './components/TitleBar'
import { useStore } from './state/store'

export function App() {
  const split = useStore((s) => s.split)
  const splitDir = useStore((s) => s.splitDir)
  const paneSize = useStore((s) => s.paneSize)
  const setPaneSize = useStore((s) => s.setPaneSize)
  const focus = useStore((s) => s.focus)
  const setFocus = useStore((s) => s.setFocus)
  const syncRailForWidth = useStore((s) => s.syncRailForWidth)

  const init = useStore((s) => s.init)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void init()
  }, [init])

  // Auto-collapse the rail on narrow windows.
  useEffect(() => {
    const onResize = () => syncRailForWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [syncRailForWidth])

  useGlobalKeys()

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
        <Rail />

        <div
          className="panes"
          data-dir={splitDir}
          ref={framRef}
          style={{ flexDirection: splitDir === 'row' ? 'row' : 'column' }}
        >
          <div
            className="panes__slot"
            style={split ? { flex: `0 0 ${paneSize}%` } : { flex: '1 1 auto' }}
          >
            <Pane pane="a" showClose={false} />
          </div>

          {split && (
            <>
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
                <span className="divider__grip" />
              </div>

              <div className="panes__slot" style={{ flex: 1 }}>
                <Pane pane="b" showClose />
              </div>
            </>
          )}
        </div>
      </div>

      <Palette />
      <Appearance />
      <Settings />
      <Search />

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

/** Global chords. Esc closes in priority order: settings → appearance → palette → search. */
function useGlobalKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useStore.getState()
      const meta = event.metaKey

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

      if (!meta) {
        // ⌃L clears the buffer.
        if (event.ctrlKey && event.key.toLowerCase() === 'l') {
          const id = store.activeSessionId()
          if (id) {
            store.clearBuffer(id)
            event.preventDefault()
          }
        }
        return
      }

      switch (event.key.toLowerCase()) {
        case 'k':
          event.preventDefault()
          if (store.palette.open) store.closePalette()
          else store.openPalette()
          break
        case 'f':
          // ⌘⇧F only; plain ⌘F is left to the webview.
          if (event.shiftKey) {
            event.preventDefault()
            if (store.search.open) store.closeSearch()
            else store.openSearch()
          }
          break
        case '[':
        case ']':
          // ⌘[ / ⌘] step between command blocks — the payoff of the block model.
          event.preventDefault()
          jumpBlock(event.key === ']' ? 1 : -1)
          break
        case 'd':
          event.preventDefault()
          store.toggleSplit(event.shiftKey ? 'col' : 'row')
          break
        case 't':
          event.preventDefault()
          void store.newSession()
          break
        case 'w': {
          event.preventDefault()
          // Split: close the pane. Solo: close the session — otherwise ⌘W would
          // do nothing at all in the common case.
          if (store.split) {
            store.closePane()
          } else {
            const id = store.activeSessionId()
            if (id) void store.closeSession(id)
          }
          break
        }
        case ',':
          event.preventDefault()
          if (store.settings.open) store.closeSettings()
          else store.openSettings()
          break
        case 'arrowleft':
          if (event.altKey) {
            event.preventDefault()
            store.setFocus('a')
          }
          break
        case 'arrowright':
          if (event.altKey && store.split) {
            event.preventDefault()
            store.setFocus('b')
          }
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
