/** Scrollback search — ⌘⇧F.
 *
 * The keybinding was in the design's keymap with no UI specified, so this is a
 * minimal treatment built from existing vocabulary (the palette's panel, the
 * block spine, micro-labels) rather than a new visual language.
 *
 * Searches commands and output across the focused session's blocks and lets the
 * user step through matches; selecting one scrolls it into view and flags it.
 */

import { useEffect, useMemo, useRef } from 'react'

import { useStore } from '../state/store'

export interface SearchHit {
  blockId: string
  /** Which command the hit belongs to, for the result row. */
  cmd: string
  /** The matching line, or the command itself when the command matched. */
  line: string
  /** Character offset of the match within `line`, for highlighting. */
  at: number
  length: number
  source: 'cmd' | 'output'
}

export function Search() {
  const open = useStore((s) => s.search.open)
  const query = useStore((s) => s.search.query)
  const activeIndex = useStore((s) => s.search.activeIndex)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const closeSearch = useStore((s) => s.closeSearch)
  const moveSearchSelection = useStore((s) => s.moveSearchSelection)

  const sessionId = useStore((s) => s.activeSessionId())
  const blocks = useStore((s) => (sessionId ? s.sessions[sessionId]?.blocks : undefined))

  const inputRef = useRef<HTMLInputElement>(null)

  const hits = useMemo(() => findHits(blocks ?? [], query), [blocks, query])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Scroll the selected hit into view and mark it, so stepping through results
  // moves the stream behind the panel.
  useEffect(() => {
    if (!open) return
    const hit = hits[activeIndex]
    if (!hit) return
    const el = document.querySelector<HTMLElement>(`[data-block-id="${hit.blockId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.setAttribute('data-search-hit', 'true')
    return () => el?.removeAttribute('data-search-hit')
  }, [open, hits, activeIndex])

  if (!open) return null

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'Enter':
        event.preventDefault()
        // Shift+Enter steps backwards, matching find-in-page conventions.
        moveSearchSelection(event.shiftKey ? -1 : 1, hits.length)
        break
      case 'ArrowDown':
        event.preventDefault()
        moveSearchSelection(1, hits.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveSearchSelection(-1, hits.length)
        break
      default:
        break
    }
  }

  return (
    <div className="search" role="dialog" aria-label="Search scrollback">
      <span className="bracket bracket--tl" style={{ width: 11, height: 11 }} />

      <div className="search__bar">
        <span className="micro">SEARCH</span>
        <input
          ref={inputRef}
          className="search__input"
          value={query}
          placeholder="Find in scrollback…"
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          aria-label="Search scrollback"
        />
        <span className="search__count">
          {query ? `${hits.length === 0 ? 0 : activeIndex + 1}/${hits.length}` : '—'}
        </span>
        <button
          className="search__step"
          onClick={() => moveSearchSelection(-1, hits.length)}
          disabled={hits.length === 0}
          aria-label="Previous match"
          type="button"
        >
          ↑
        </button>
        <button
          className="search__step"
          onClick={() => moveSearchSelection(1, hits.length)}
          disabled={hits.length === 0}
          aria-label="Next match"
          type="button"
        >
          ↓
        </button>
        <button className="search__close" onClick={closeSearch} aria-label="Close search" type="button">
          ✕
        </button>
      </div>

      {query && hits.length > 0 && (
        <div className="search__results">
          {hits.slice(0, 40).map((hit, i) => (
            <button
              className="search__hit"
              data-active={i === activeIndex}
              key={`${hit.blockId}-${i}`}
              onClick={() => useStore.getState().setSearchIndex(i)}
              type="button"
            >
              <span className="search__hitcmd">{hit.cmd || '—'}</span>
              <span className="search__hitline">
                {hit.line.slice(Math.max(0, hit.at - 24), hit.at)}
                <mark className="search__mark">
                  {hit.line.slice(hit.at, hit.at + hit.length)}
                </mark>
                {hit.line.slice(hit.at + hit.length, hit.at + hit.length + 48)}
              </span>
              <span className="search__hitsrc micro">{hit.source}</span>
            </button>
          ))}
        </div>
      )}

      {query && hits.length === 0 && <div className="search__empty">No matches</div>}

      <div className="search__foot">
        <span>↵ NEXT</span>
        <span>⇧↵ PREVIOUS</span>
        <span>ESC CLOSE</span>
      </div>
    </div>
  )
}

/** Case-insensitive substring search across commands and output lines. */
function findHits(
  blocks: { id: string; cmd: string; lines: { text: string }[] }[],
  query: string,
): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const hits: SearchHit[] = []
  for (const block of blocks) {
    const cmdAt = block.cmd.toLowerCase().indexOf(needle)
    if (cmdAt !== -1) {
      hits.push({
        blockId: block.id,
        cmd: block.cmd,
        line: block.cmd,
        at: cmdAt,
        length: needle.length,
        source: 'cmd',
      })
    }

    for (const line of block.lines) {
      const at = line.text.toLowerCase().indexOf(needle)
      if (at === -1) continue
      hits.push({
        blockId: block.id,
        cmd: block.cmd,
        line: line.text,
        at,
        length: needle.length,
        source: 'output',
      })
      // One hit per line keeps the result list readable on repetitive output.
    }
  }

  return hits
}
