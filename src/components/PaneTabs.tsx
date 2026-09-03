/** Horizontal tab strip for one pane's sessions.
 *
 * The dot is the tab's whole state vocabulary: amber for the active local
 * session, --line-200 for an idle one, cyan for a remote host. Colour is a
 * signal here rather than an identity — profiles no longer carry accents, so a
 * tab says *what kind of session this is*, not whose it is.
 */

import { useRef, useState } from 'react'

import { useStore, type PaneId } from '../state/store'
import { Icon } from './grid'

interface Props {
  pane: PaneId
}

/** Pointer must travel this far before a press counts as a drag rather than a
 *  click — otherwise every plain click on a tab would flash the dragging style
 *  for the one frame between pointerdown and pointerup. */
const DRAG_THRESHOLD_PX = 4

export function PaneTabs({ pane }: Props) {
  const paneState = useStore((s) => s.panes[pane])
  const sessions = useStore((s) => s.sessions)
  const activateSession = useStore((s) => s.activateSession)
  const reorderSession = useStore((s) => s.reorderSession)
  const openSettings = useStore((s) => s.openSettings)

  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // The pressed tab captures the pointer (see onTabPointerDown), so every
  // move and the final up keep going to it even once the cursor overshoots
  // onto a neighbour or off the strip — without capture, a fast drag would
  // lose tracking the moment it left the element that started it. `indexAtX`
  // then measures every tab's live position rather than trusting
  // event.target, since target is pinned to the captured element throughout.
  //
  // The press is tracked by session id, not index: closing a tab elsewhere
  // (a keybinding, another window) while this one is mid-drag would shift
  // every index after it, and re-resolving id -> index on each move and on
  // commit is what keeps the drag pinned to the session actually grabbed.
  const stripRef = useRef<HTMLDivElement>(null)
  const pressId = useRef<string | null>(null)
  const pressX = useRef(0)
  const dragging = useRef(false)

  const ids = paneState.sessions

  const indexAtX = (clientX: number): number => {
    const strip = stripRef.current
    if (!strip) return -1
    const tabs = strip.querySelectorAll<HTMLElement>('[data-tab-index]')
    for (const tab of tabs) {
      const rect = tab.getBoundingClientRect()
      if (clientX >= rect.left && clientX < rect.right) {
        return Number(tab.dataset.tabIndex)
      }
    }
    return -1
  }

  const onTabPointerDown = (id: string, event: React.PointerEvent) => {
    pressId.current = id
    pressX.current = event.clientX
    dragging.current = false
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onTabPointerMove = (event: React.PointerEvent) => {
    if (pressId.current === null) return
    if (!dragging.current) {
      if (Math.abs(event.clientX - pressX.current) < DRAG_THRESHOLD_PX) return
      dragging.current = true
      setDragId(pressId.current)
    }
    const over = indexAtX(event.clientX)
    setOverIndex(over === -1 ? null : over)
  }

  const onTabPointerUp = (event: React.PointerEvent) => {
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
    if (dragging.current && pressId.current !== null && overIndex !== null) {
      const fromIndex = ids.indexOf(pressId.current)
      if (fromIndex !== -1 && fromIndex !== overIndex) {
        reorderSession(pane, fromIndex, overIndex)
      }
    }
    pressId.current = null
    dragging.current = false
    setDragId(null)
    setOverIndex(null)
  }

  return (
    <div className="panetabs" role="tablist" ref={stripRef}>
      {ids.map((id, index) => {
        const session = sessions[id]
        if (!session) return null
        return (
          <PaneTab
            key={id}
            id={id}
            index={index}
            active={index === paneState.active}
            dragging={id === dragId}
            dragOver={index === overIndex && id !== dragId}
            onActivate={() => activateSession(pane, index)}
            onPointerDown={(e) => onTabPointerDown(id, e)}
            onPointerMove={onTabPointerMove}
            onPointerUp={onTabPointerUp}
          />
        )
      })}

      <button
        className="panetabs__new"
        onClick={() => openSettings('profiles')}
        title="New session"
        aria-label="New session"
        type="button"
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}

function PaneTab({
  id,
  index,
  active,
  dragging,
  dragOver,
  onActivate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  id: string
  index: number
  active: boolean
  dragging: boolean
  dragOver: boolean
  onActivate: () => void
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
}) {
  const session = useStore((s) => s.sessions[id])
  const closeSession = useStore((s) => s.closeSession)
  const renameSession = useStore((s) => s.renameSession)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!session) return null
  const remote = session.host !== 'local'

  const commitRename = () => {
    setEditing(false)
    renameSession(id, draft)
  }

  return (
    <div
      className="panetab"
      data-tab-index={index}
      data-active={active}
      data-dragging={dragging}
      data-drag-over={dragOver}
      data-remote={remote}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
        }
      }}
      onPointerDown={(e) => {
        if (editing) return
        onPointerDown(e)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={remote ? `${session.name} · ${session.host}` : session.name}
    >
      {/* Cyan says remote before anything else on the tab does — which machine
          you are typing into is the most consequential thing to be wrong about.
          Amber is the active local session; an idle one recedes to --line-200. */}
      <span
        className="dot"
        style={{
          color: remote
            ? 'var(--signal-cyan)'
            : active
              ? 'var(--signal-amber)'
              : 'var(--line-200)',
        }}
      />
      {editing ? (
        <input
          className="panetab__name panetab__name-edit"
          value={draft}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitRename()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
        />
      ) : (
        <span
          className="panetab__name"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setDraft(session.name)
            setEditing(true)
          }}
        >
          {session.name}
        </span>
      )}
      {remote && (
        <span className="panetab__globe" aria-label="remote">
          <Icon name="globe" size={12} />
        </span>
      )}

      <button
        className="panetab__close"
        onClick={(e) => {
          // Otherwise the tab's own click would re-activate what was just closed.
          e.stopPropagation()
          void closeSession(id)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={`Close ${session.name}`}
        aria-label={`Close ${session.name}`}
        type="button"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
