/** The top bar: wordmark, leader, view tabs, session count.
 *
 * The traffic lights are NATIVE — macOS draws and manages them via the
 * transparent titlebar. We only reserve space for the cluster. The prototype
 * drew them by hand because it ran in a browser; reimplementing them would mean
 * owning window drag, zoom, fullscreen, snapping and Mission Control behaviour,
 * which an earlier version of the design was rolled back specifically to avoid.
 *
 * The whole bar is a drag region; every control inside it opts out.
 *
 * The identity swatch that used to sit here is gone with the identity system —
 * GRID is functionally monochrome, so there is no live accent for it to read
 * out and no identity for its colour to name.
 */

import { useStore, type SettingsTab } from '../state/store'
import { Tabs, Wordmark, type TabItem } from './grid'

/** Width reserved for the native traffic-light cluster. */
const TRAFFIC_LIGHTS_WIDTH = 78

type View = 'stream' | 'history' | 'settings'

const VIEWS: readonly TabItem<View>[] = [
  { id: 'stream', label: 'STREAM' },
  { id: 'history', label: 'HISTORY' },
  { id: 'settings', label: 'SETTINGS' },
]

export function TopBar() {
  const openPalette = useStore((s) => s.openPalette)
  const openSettings = useStore((s) => s.openSettings)
  const settingsOpen = useStore((s) => s.settings.open)
  const paletteOpen = useStore((s) => s.palette.open)

  // Sessions across both panes — the window's whole load, not the focused
  // pane's, which is what makes the number worth showing at all.
  const sessionCount = useStore((s) => Object.keys(s.sessions).length)

  // HISTORY is the palette: searching what you have run *is* the history view,
  // and a second surface listing the same commands would be two answers to one
  // question.
  const active: View = settingsOpen ? 'settings' : paletteOpen ? 'history' : 'stream'

  const select = (view: View) => {
    switch (view) {
      case 'settings':
        openSettings('panels' satisfies SettingsTab)
        break
      case 'history':
        openPalette()
        break
      default:
        // STREAM is the base state: selecting it closes whatever is over it.
        if (settingsOpen) useStore.getState().closeSettings()
        if (paletteOpen) useStore.getState().closePalette()
    }
  }

  return (
    /* `data-tauri-drag-region` is what Tauri honours for window dragging —
       `-webkit-app-region: drag` is an Electron feature and does nothing here.
       Non-draggable children stop the mousedown before it reaches this node. */
    <div className="topbar" data-tauri-drag-region>
      <span data-tauri-drag-region style={{ width: TRAFFIC_LIGHTS_WIDTH, flex: 'none' }} />

      <Wordmark size={20} />

      <span className="leader" data-tauri-drag-region />

      <div className="no-drag">
        <Tabs items={VIEWS} active={active} onSelect={select} />
      </div>

      <span className="topbar__count" data-tauri-drag-region>
        SESSIONS · {sessionCount}
      </span>
    </div>
  )
}
