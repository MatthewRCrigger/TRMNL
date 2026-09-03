/** One command execution, rendered as an addressable unit — a GRID panel.
 *
 * This is the single biggest change of the rebuild. A block was a bare left
 * border, then a box with a filled accent header. It is now a panel, and the
 * panel's own six toggles carry the state: exit status is the border colour and
 * the header fill, not a chip bolted onto a header. See `blockPanel` in
 * term/types.ts for the mapping.
 *
 * The panel heading names what the block *is* — `BUILD .OUTPUT`, `GIT .STATUS`
 * — using the origin theme's `WORD .WORD` convention, so a stream of blocks
 * reads as a log of typed things rather than a run of identical boxes.
 */

import { memo, useEffect, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'

import { hasLink, linkify } from '../term/linkify'
import {
  blockBadge,
  blockPanel,
  blockState,
  blockToMarkdown,
  formatDuration,
  formatElapsed,
  type Block as BlockModel,
} from '../term/types'
import { Badge, Button, Panel, PanelWell, Prompt, TerminalLine, type LineTone } from './grid'
import type { PanelSettings } from '../state/store'
import { Structured } from './Structured'

interface Props {
  block: BlockModel
  foldThreshold: number
  /** The newest block in the stream; it never folds on its own. */
  isLatest: boolean
  /** The user's panel toggles — the four they control; state owns the rest. */
  panel: PanelSettings
  /** Above this many lines a block drops its frame entirely. */
  rawDumpThreshold: number
  cwd: string
  user: string
  host: string
  onCancel: () => void
  onRerun: (cmd: string) => void
  onToggleFold: () => void
}

/** The store's line tones, mapped onto TerminalLine's. */
const TONE: Record<string, LineTone> = {
  txt: 'default',
  dim: 'meta',
  dd: 'meta',
  acc: 'accent',
  err: 'danger',
  wrn: 'accent',
}

/** The panel heading for a block, from whichever renderer claimed its output. */
function headingFor(block: BlockModel): string {
  switch (block.structured?.kind) {
    case 'build':
      return 'BUILD .OUTPUT'
    case 'git':
      return 'GIT .STATUS'
    case 'serve':
      return 'SERVE .LIVE'
    case 'test':
      return 'TEST .RESULT'
    case 'err':
      return 'ERROR .OUTPUT'
    case 'list':
      return 'LIST .OUTPUT'
    default:
      return block.interactive ? 'INTERACTIVE .SESSION' : 'SHELL .STREAM'
  }
}

export const Block = memo(function Block({
  block,
  foldThreshold,
  isLatest,
  panel,
  rawDumpThreshold,
  cwd,
  user,
  host,
  onCancel,
  onRerun,
  onToggleFold,
}: Props) {
  const state = blockState(block)
  const running = state === 'running' || state === 'live'
  const [copied, setCopied] = useState<'output' | 'command' | 'markdown' | null>(null)

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

  const copy = async (what: 'output' | 'command' | 'markdown') => {
    try {
      const text =
        what === 'command'
          ? block.cmd
          : what === 'markdown'
            ? blockToMarkdown(block)
            : block.lines.map((l) => l.text).join('\n')
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

  const state_ = blockPanel(block, { isLatest, rawDumpThreshold })
  const badge = blockBadge(block, isLatest)

  const body = (
    <>
      <Prompt
        user={user}
        host={host}
        path={cwd}
        command={block.cmd}
        // Amber is the prompt's home, but a block that failed or is running
        // says so in its own signal here too — the prompt row is the line the
        // eye lands on first inside the panel.
        tone={state === 'failure' || state === 'cancelled' ? 'danger' : running ? 'live' : 'accent'}
        meta={
          <>
            {duration && <span>{duration}</span>}
            <span>{block.ts}</span>
          </>
        }
      />

      {block.structured ? (
        <div className="block__content">
          <Structured data={block.structured} onRun={onRerun} />
        </div>
      ) : (
        visibleLines.length > 0 &&
        (panel.contentBorder ? (
          <PanelWell className="block__content">
            <Lines lines={visibleLines} />
          </PanelWell>
        ) : (
          <div className="block__content">
            <Lines lines={visibleLines} />
          </div>
        ))
      )}

      {/* A text row, not a third band: the fold is an affordance on the output,
          not another framed region inside an already-framed panel. */}
      {canFold && (
        <button className="block__fold" onClick={onToggleFold} type="button">
          {collapsed ? `${hiddenCount} MORE LINES` : 'COLLAPSE'}
        </button>
      )}
    </>
  )

  return (
    <Panel
      className="block"
      data-block-id={block.id}
      // The user's toggles supply the geometry; the block's own state supplies
      // the colour and the fill. A user who turns headerFilled off loses the
      // emphasis on the latest block but keeps the red border on a failure —
      // status is not a preference.
      showPanel={state_.showPanel}
      panelBorder={panel.panelBorder}
      headerBorder={panel.headerBorder}
      contentBorder={panel.contentBorder}
      headerFilled={panel.headerFilled && state_.headerFilled}
      panelColor={state_.panelColor}
      heading={state_.showPanel ? headingFor(block) : undefined}
      index={{ current: block.seq }}
      headerRight={
        <>
          {/* Actions occupy their space at all times so the header row never
              reflows as the pointer enters or leaves the block. */}
          <span className="block__actions">
            {running ? (
              <Button size="sm" variant="signal" tone="danger" onClick={onCancel}>
                ⌃C CANCEL
              </Button>
            ) : (
              <>
                {/* Output and command are separate: wanting one without the
                    other is the common case, and a single COPY that grabs both
                    serves neither. */}
                <Button size="sm" variant="ghost" onClick={() => void copy('output')} title="Copy output">
                  {copied === 'output' ? 'COPIED' : 'COPY OUT'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void copy('command')} title="Copy command">
                  {copied === 'command' ? 'COPIED' : 'COPY CMD'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void copy('markdown')}
                  title="Copy command, output and exit status as markdown"
                >
                  {copied === 'markdown' ? 'COPIED' : 'COPY MD'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onRerun(block.cmd)}>
                  RERUN
                </Button>
              </>
            )}
          </span>
          <Badge tone={badge.tone} dot={badge.dot}>
            {badge.label}
          </Badge>
        </>
      }
    >
      {body}
    </Panel>
  )
})

function Lines({ lines }: { lines: { text: string; tone: string }[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <TerminalLine key={i} tone={TONE[line.tone] ?? 'default'} data-line-text={line.text}>
          {line.text ? (hasLink(line.text) ? <LineContent text={line.text} /> : line.text) : ' '}
        </TerminalLine>
      ))}
    </>
  )
}

/**
 * One line's text, with any bare URLs split out as clickable spans.
 *
 * Plain click still falls through to normal text selection — a link inside
 * scrollback is still text you may want to select and copy, and a bare click
 * opening it would fight click-drag the moment a URL sits under the pointer.
 * ⌘-click is the escape hatch that means "no, actually open this", matching
 * how Terminal.app, iTerm2 and VS Code's terminal all treat it.
 */
function LineContent({ text }: { text: string }) {
  const tokens = linkify(text)
  return (
    <>
      {tokens.map((token, i) =>
        token.kind === 'link' ? (
          <span
            key={i}
            className="block__link"
            data-url={token.url}
            title="⌘-click to open"
            onClick={(e) => {
              if (!e.metaKey) return
              e.stopPropagation()
              void openUrl(token.url).catch(() => {})
            }}
          >
            {token.text}
          </span>
        ) : (
          <span key={i}>{token.text}</span>
        ),
      )}
    </>
  )
}
