/** Horizontal tab strip for one pane's sessions — replaces the old vertical rail. */

import { useRef, useState } from 'react'

import { profileAccent, useStore, type PaneId } from '../state/store'

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
  const profiles = useStore((s) => s.profiles)
  const activateSession = useStore((s) => s.activateSession)
  const reorderSession = useStore((s) => s.reorderSession)
  const openSettings = useStore((s) => s.openSettings)

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // Pointer capture lives on the strip, not on individual tabs — the same
  // shape as the pane divider's drag in App.tsx. A tab-scoped listener loses
  // the pointer the moment a fast drag overshoots onto a neighbour or off the
  // strip; capturing here means every move and the final up are always seen
  // regardless of what element sits under the cursor.
  const stripRef = useRef<HTMLDivElement>(null)
  const pressIndex = useRef<number | null>(null)
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

  const onTabPointerDown = (index: number, event: React.PointerEvent) => {
    pressIndex.current = index
    pressX.current = event.clientX
    dragging.current = false
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onTabPointerMove = (event: React.PointerEvent) => {
    if (pressIndex.current === null) return
    if (!dragging.current) {
      if (Math.abs(event.clientX - pressX.current) < DRAG_THRESHOLD_PX) return
      dragging.current = true
      setDragIndex(pressIndex.current)
    }
    const over = indexAtX(event.clientX)
    setOverIndex(over === -1 ? null : over)
  }

  const onTabPointerUp = (event: React.PointerEvent) => {
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
    if (dragging.current && pressIndex.current !== null && overIndex !== null) {
      if (pressIndex.current !== overIndex) {
        reorderSession(pane, pressIndex.current, overIndex)
      }
    }
    pressIndex.current = null
    dragging.current = false
    setDragIndex(null)
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
            dragging={index === dragIndex}
            dragOver={index === overIndex && index !== dragIndex}
            accent={profileAccent(profiles, session.profileId) ?? undefined}
            onActivate={() => activateSession(pane, index)}
            onPointerDown={(e) => onTabPointerDown(index, e)}
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
        +
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
  accent,
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
  accent?: string
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
      <span
        className="dot"
        style={{ color: remote ? 'var(--warn)' : (accent ?? 'var(--ac)') }}
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
      {remote && <span className="panetab__link" aria-label="remote">⇄</span>}

      <button
        className="panetab__close is-btn is-btn--danger"
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
        ✕
      </button>
    </div>
  )
}
