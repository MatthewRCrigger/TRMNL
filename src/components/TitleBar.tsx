/** Title bar.
 *
 * The traffic lights are NATIVE — macOS draws and manages them via the
 * transparent titlebar. We only reserve space for the cluster. The prototype
 * drew them by hand because it ran in a browser; reimplementing them would mean
 * owning window drag, zoom, fullscreen, snapping and Mission Control behavior,
 * which an earlier version of the design was rolled back specifically to avoid.
 *
 * The whole bar is a drag region; every control inside it opts out.
 */

import { useStore } from '../state/store'

/** Width reserved for the native traffic-light cluster. */
const TRAFFIC_LIGHTS_WIDTH = 78

export function TitleBar() {
  const host = useStore((s) => s.host)
  const split = useStore((s) => s.split)
  const splitDir = useStore((s) => s.splitDir)
  const toggleSplit = useStore((s) => s.toggleSplit)
  const closePane = useStore((s) => s.closePane)
  const openPalette = useStore((s) => s.openPalette)
  const openSettings = useStore((s) => s.openSettings)
  const identityName = useStore((s) => s.settingsValues.identityName)
  const accent = useStore((s) => s.settingsValues.accent)

  const sessionId = useStore((s) => s.activeSessionId())
  const session = useStore((s) => (sessionId ? s.sessions[sessionId] : undefined))

  const layout: 'solo' | 'row' | 'col' = split ? splitDir : 'solo'

  return (
    /* `data-tauri-drag-region` is what Tauri honours for window dragging —
       `-webkit-app-region: drag` is an Electron feature and does nothing here.
       Non-draggable children stop the mousedown before it reaches this node. */
    <div className="titlebar" data-tauri-drag-region>
      <span data-tauri-drag-region style={{ width: TRAFFIC_LIGHTS_WIDTH, flex: 'none' }} />

      <nav className="titlebar__crumb" data-tauri-drag-region aria-label="Location">
        <span className="titlebar__parent" data-tauri-drag-region>{parentOf(session?.cwd, host?.home)}</span>
        <span className="titlebar__sep" data-tauri-drag-region>/</span>
        <span className="titlebar__leaf" data-tauri-drag-region>{session?.name ?? 'shell'}</span>
      </nav>

      {session?.branch && <span className="titlebar__branch" data-tauri-drag-region>⑂ {session.branch}</span>}

      <div className="titlebar__layout no-drag" role="group" aria-label="Pane layout">
        <LayoutButton
          kind="solo"
          active={layout === 'solo'}
          title="Solo pane"
          onClick={() => split && closePane()}
        />
        <LayoutButton
          kind="row"
          active={layout === 'row'}
          title="Split right — ⌘D"
          onClick={() => toggleSplit('row')}
        />
        <LayoutButton
          kind="col"
          active={layout === 'col'}
          title="Split down — ⌘⇧D"
          onClick={() => toggleSplit('col')}
        />
      </div>

      <button className="titlebar__palette no-drag" onClick={openPalette} type="button">
        <span className="titlebar__palettetext">Search history, hosts, commands…</span>
        <span className="kbd">⌘K</span>
      </button>

      {/* The swatch stays because it is the only live accent readout in the
          chrome, and its colour still names the identity the panel opens on. */}
      <button
        className="titlebar__settings no-drag"
        onClick={() => openSettings('appearance')}
        title={`Settings — identity ${identityName}`}
        aria-label={`Settings — identity ${identityName}`}
        type="button"
      >
        <span className="titlebar__swatch" style={{ background: accent }} />
        SETTINGS
      </button>
    </div>
  )
}

/**
 * Pane layout glyph, drawn with CSS borders rather than an icon: a 12×10 box
 * where one thick border indicates the split axis. The handoff notes these are
 * better than most icon-set equivalents and should be kept.
 */
function LayoutButton({
  kind,
  active,
  title,
  onClick,
}: {
  kind: 'solo' | 'row' | 'col'
  active: boolean
  title: string
  onClick: () => void
}) {
  return (
    <button
      className="layoutbtn is-btn"
      data-active={active}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      type="button"
    >
      <span
        className="layoutbtn__glyph"
        style={{
          borderLeftWidth: kind === 'row' ? 5 : 1,
          borderTopWidth: kind === 'col' ? 5 : 1,
        }}
      />
    </button>
  )
}

function parentOf(cwd?: string, home?: string): string {
  if (!cwd) return '~'
  const pretty = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  const parts = pretty.split('/').filter(Boolean)
  if (parts.length <= 1) return pretty.startsWith('~') ? '~' : '/'
  const parent = parts.slice(0, -1).join('/')
  return pretty.startsWith('~') ? parent : `/${parent}`
}
