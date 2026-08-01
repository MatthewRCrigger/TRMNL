/** Window shell: title bar, rail, panes, divider, and the modal surfaces. */

import { useCallback, useEffect, useRef } from 'react'

import { Appearance } from './components/Appearance'
import { Pane } from './components/Pane'
import { Palette } from './components/Palette'
import { Rail } from './components/Rail'
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

/** Global chords. Esc closes in priority order: settings → appearance → palette. */
function useGlobalKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useStore.getState()
      const meta = event.metaKey

      if (event.key === 'Escape') {
        if (store.settings.open) {
          store.closeSettings()
          event.preventDefault()
        } else if (store.appearance.open) {
          store.toggleAppearance(false)
          event.preventDefault()
        } else if (store.palette.open) {
          store.closePalette()
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
        case 'd':
          event.preventDefault()
          store.toggleSplit(event.shiftKey ? 'col' : 'row')
          break
        case 't':
          event.preventDefault()
          void store.newSession()
          break
        case 'w':
          event.preventDefault()
          if (store.split) store.closePane()
          break
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
