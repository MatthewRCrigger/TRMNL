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
  const [copied, setCopied] = useState(false)

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

  const copy = async () => {
    try {
      const text = [block.cmd, ...block.lines.map((l) => l.text)].join('\n')
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
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
    <div className="block" style={{ borderLeftColor: spineVar(state) }}>
      <div className="block__head">
        <span className="block__prompt">❯</span>
        <span className="block__cmd">{block.cmd}</span>
        <span className="rule" />

        {running ? (
          <button className="block__cancel no-drag" onClick={onCancel} type="button">
            ⌃C CANCEL
          </button>
        ) : (
          <span className="block__actions">
            <button className="block__action" onClick={copy} type="button">
              {copied ? 'COPIED' : 'COPY'}
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
