/** One command execution, rendered as an addressable unit. */

import { memo, useEffect, useState } from 'react'

import {
  blockState,
  chipLabel,
  formatDuration,
  formatElapsed,
  spineVar,
  type Block as BlockModel,
} from '../term/types'
import { Structured } from './Structured'

interface Props {
  block: BlockModel
  foldThreshold: number
  /** The newest block in the stream; it never folds on its own. */
  isLatest: boolean
  onCancel: () => void
  onRerun: (cmd: string) => void
  onToggleFold: () => void
}

const TONE_VAR: Record<string, string> = {
  txt: 'var(--fg)',
  dim: 'var(--fgd)',
  dd: 'var(--fgdd)',
  acc: 'var(--ac)',
  err: 'var(--err)',
  wrn: 'var(--warn)',
}

export const Block = memo(function Block({
  block,
  foldThreshold,
  isLatest,
  onCancel,
  onRerun,
  onToggleFold,
}: Props) {
  const state = blockState(block)
  const running = state === 'running' || state === 'live'
  const [copied, setCopied] = useState<'output' | 'command' | null>(null)

  // Live elapsed timer, ticking only while the block runs.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [running])

  const duration = running
    ? formatElapsed(now - block.t0)
    : block.ms !== undefined
      ? formatDuration(block.ms)
      : ''

  const copy = async (what: 'output' | 'command') => {
    try {
      const text =
        what === 'command' ? block.cmd : block.lines.map((l) => l.text).join('\n')
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(null), 1200)
    } catch {
      // Clipboard can be unavailable; failing silently is better than throwing.
    }
  }

  // Structured blocks never fold.
  //
  // The newest block stays open regardless of length: you are reading the thing
  // you just ran, and folding it out from under you is hostile. It collapses
  // only once a newer block takes over as the active one — `isLatest` goes
  // false and, unless the user has explicitly expanded it, the fold applies.
  const foldable = !block.structured && block.lines.length > foldThreshold
  const canFold = foldable && !isLatest
  const expanded = block.expanded ?? false
  const collapsed = canFold && !expanded
  const visibleLines = collapsed ? block.lines.slice(0, 6) : block.lines
  const hiddenCount = block.lines.length - visibleLines.length

  return (
    <div
      className="block"
      data-block-id={block.id}
      // A command that produced nothing has no body, so the header must not draw
      // a divider into empty space.
      data-empty={!block.structured && visibleLines.length === 0}
      // A block that claimed an accent keeps it for good, so the record of what
      // ran stays legible after the global accent reverts. Overriding --ac on the
      // block itself rather than styling the header directly means the spine,
      // chips and every color-mix-derived hairline inside follow along — the same
      // property that makes the global switcher work, scoped to one block.
      style={
        block.accent
          ? ({ borderLeftColor: spineVar(state), '--ac': block.accent } as React.CSSProperties)
          : { borderLeftColor: spineVar(state) }
      }
    >
      <div className="block__head">
        {/* Ordinal first: it makes the stream read as an addressable log rather
            than loose scrollback, and gives ⌘[/⌘] and search hits a referent the
            user can actually see. Zero-padded to a fixed width so it cannot
            reflow the row at 99 → 100. */}
        <span className="block__seq">{String(block.seq).padStart(4, '0')}</span>
        <span className="block__prompt">❯</span>
        <span className="block__cmd">{block.cmd}</span>
        {/* Spacer only. The design used a hairline here to separate the command
            from its status, but that was for the spine-only layout — the box now
            provides the separation and the rule just adds noise. */}
        <span className="block__gap" />

        {running ? (
          <button className="block__cancel no-drag" onClick={onCancel} type="button">
            ⌃C CANCEL
          </button>
        ) : (
          <span className="block__actions">
            {/* Output and command are separate: wanting one without the other is
                the common case, and a single COPY that grabs both serves neither. */}
            <button
              className="block__action"
              onClick={() => void copy('output')}
              title="Copy output"
              type="button"
            >
              {copied === 'output' ? 'COPIED' : 'COPY OUT'}
            </button>
            <button
              className="block__action"
              onClick={() => void copy('command')}
              title="Copy command"
              type="button"
            >
              {copied === 'command' ? 'COPIED' : 'COPY CMD'}
            </button>
            <button
              className="block__action"
              onClick={() => onRerun(block.cmd)}
              type="button"
            >
              RERUN
            </button>
          </span>
        )}

        <span className="block__chip" data-state={state}>
          <span
            className="dot"
            style={{
              width: 5,
              height: 5,
              // Kept mounted at opacity 0 on settled blocks so the row does not
              // reflow between states.
              opacity: running ? undefined : 0,
              animation: running ? 'pul 1.4s ease-in-out infinite' : 'none',
            }}
          />
          {chipLabel(block, state)}
        </span>

        <span className="block__dur">{duration}</span>
        <span className="block__ts">{block.ts}</span>
      </div>

      {block.structured ? (
        <Structured data={block.structured} onRun={onRerun} />
      ) : (
        visibleLines.length > 0 && (
          <div className="block__out">
            {visibleLines.map((line, i) => (
              <div
                key={i}
                className="block__line"
                style={{ color: TONE_VAR[line.tone] ?? 'var(--fg)' }}
              >
                {line.text || ' '}
              </div>
            ))}
          </div>
        )
      )}

      {canFold && (
        <button className="block__fold" onClick={onToggleFold} type="button">
          {collapsed ? `⌄ ${hiddenCount} MORE LINES` : '⌃ COLLAPSE'}
        </button>
      )}
    </div>
  )
})
