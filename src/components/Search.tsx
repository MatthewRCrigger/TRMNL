/** `SCROLLBACK .FIND` — ⌘⇧F.
 *
 * A panel, not a dialog: it is non-modal and anchored, so the stream stays
 * live behind it and stepping through hits scrolls the blocks underneath. It
 * sits top-right of the pane specifically so it never covers the composer —
 * searching and typing are not mutually exclusive.
 *
 * Searches commands and output across the focused session's blocks.
 */

import { useEffect, useMemo, useRef } from 'react'

import { useStore } from '../state/store'
import { Icon, Pagination, Panel } from './grid'

export interface SearchHit {
  blockId: string
  /** The block's per-session ordinal, so a hit reads as a coordinate. */
  seq: number
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
    <Panel
      className="search"
      heading="SCROLLBACK .FIND"
      // --line-100 rather than the panel default: this floats over the stream,
      // so it has to read as nearer than everything behind it — and brightness
      // is how nearness is expressed here, there being no shadow to reach for.
      panelColor="var(--line-100)"
      contentBorder={false}
      headerMeta={query ? <span className="search__echo">{query}</span> : undefined}
      headerRight={
        <button className="search__close" onClick={closeSearch} aria-label="Close search" type="button">
          <Icon name="x" size={12} />
        </button>
      }
    >
      <div className="search__bar">
        <div className="search__field">
          <input
            ref={inputRef}
            className="search__input"
            value={query}
            placeholder="find in scrollback…"
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            aria-label="Search scrollback"
          />
          {!query && <span className="search__caret" aria-hidden />}
        </div>

        <Pagination
          label="MATCH"
          current={hits.length === 0 ? 0 : activeIndex + 1}
          total={hits.length}
          onPrev={() => moveSearchSelection(-1, hits.length)}
          onNext={() => moveSearchSelection(1, hits.length)}
        />
      </div>

      {query && hits.length > 0 && (
        <div className="search__results">
          {hits.slice(0, 40).map((hit, i) => (
            <button
              className="search__hit"
              data-active={i === activeIndex || undefined}
              key={`${hit.blockId}-${i}`}
              onClick={() => useStore.getState().setSearchIndex(i)}
              type="button"
            >
              <span className="search__seq">{String(hit.seq).padStart(3, '0')}</span>
              <span className="search__line">
                {hit.line.slice(Math.max(0, hit.at - 24), hit.at)}
                <mark className="search__mark">{hit.line.slice(hit.at, hit.at + hit.length)}</mark>
                {hit.line.slice(hit.at + hit.length, hit.at + hit.length + 48)}
              </span>
            </button>
          ))}
        </div>
      )}

      {query && hits.length === 0 && <div className="search__empty">NO MATCHES</div>}
    </Panel>
  )
}

/** Case-insensitive substring search across commands and output lines. */
function findHits(
  blocks: { id: string; seq: number; cmd: string; lines: { text: string }[] }[],
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
        seq: block.seq,
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
        seq: block.seq,
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
