/** `SESSION .INIT` — the panel that opens every session.
 *
 * It stays at the top of the stream for the session's life rather than being
 * swapped out by the first command, so scrolling all the way back always
 * returns you to where the session started.
 *
 * Its `ATTACHED` badge and the four-row identity grid are permanent; the
 * suggestions, recents and key hints below are cold-start scaffolding and drop
 * away once there is real history, where they would be stale noise sitting on
 * top of it.
 *
 * The DETECTED line and every suggestion are real product behaviour: the cwd is
 * inspected on the Rust side and each suggestion comes from a file that was
 * actually read. Never show a suggestion that would fail.
 */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import type { HostInfo, PanelSettings, Session } from '../state/store'
import { Badge, KeyCap, Panel } from './grid'

interface Detection {
  stack: string
  source: string
  suggestions: { cmd: string; note: string }[]
  branch?: string
}

interface Props {
  /** True once the session has run something; collapses the cold-start sections. */
  started?: boolean
  session: Session
  host: HostInfo | null
  compact: boolean
  panel: PanelSettings
  /** Total blocks in the session, for the panel's `000 | 047` index. */
  total: number
  onRun: (cmd: string) => void
}

export function Welcome({ session, host, compact, started = false, panel, total, onRun }: Props) {
  const [detection, setDetection] = useState<Detection | null>(null)

  useEffect(() => {
    let cancelled = false
    invoke<Detection>('detect_dir', { path: session.cwd })
      .then((d) => {
        if (!cancelled) setDetection(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [session.cwd])

  const recent = [...session.history].reverse().slice(0, 3)
  const branch = session.branch || detection?.branch

  return (
    <Panel
      className="init"
      data-compact={compact || undefined}
      data-started={started || undefined}
      heading="SESSION .INIT"
      panelBorder={panel.panelBorder}
      headerBorder
      // The init panel's body is a key/value grid, not output — a well around it
      // would frame a layout rather than a machine's words.
      contentBorder={false}
      // Never filled: this is not the block you are reading, it is where the
      // session began. A filled header here would compete with the latest block
      // for the eye every time you scrolled to the top.
      headerFilled={false}
      // `000 | 047` once there is a stream to be at the top of. With no blocks
      // yet the total is 0, and `000 | 000` reads as a broken counter rather
      // than as an empty session — so the pair collapses to the position alone.
      index={total > 0 ? { current: 0, total } : { current: 0 }}
      headerRight={
        <Badge tone="success" dot>
          ATTACHED
        </Badge>
      }
    >
      <div className="init__grid">
        <span className="init__key">PATH</span>
        <span className="init__val init__val--bright">{prettyPath(session.cwd, host?.home)}</span>

        <span className="init__key">BRANCH</span>
        <span className="init__val">{branch ? <>⑂ {branch}</> : '—'}</span>

        <span className="init__key">DETECTED</span>
        <span className="init__val">{detection?.stack || '…'}</span>

        <span className="init__key">SHELL</span>
        <span className="init__val">
          {shellName(host?.shell)} · {session.host}
        </span>
      </div>

      {!started && detection && detection.suggestions.length > 0 && (
        <section className="init__section">
          <div className="init__sechead">
            <span className="init__seclabel">SUGGESTED</span>
            <span className="leader" />
            <span className="init__source">{detection.source}</span>
          </div>
          {detection.suggestions.map((s) => (
            <button className="init__cmd" key={s.cmd} onClick={() => onRun(s.cmd)} type="button">
              <span className="init__sigil">$</span>
              <span className="init__cmdtext">{s.cmd}</span>
              <span className="init__note">{s.note}</span>
              <span className="init__cmdgap" />
              <KeyCap size="sm">↵</KeyCap>
            </button>
          ))}
        </section>
      )}

      {!started && recent.length > 0 && (
        <section className="init__section">
          <div className="init__sechead">
            <span className="init__seclabel">RECENT</span>
            <span className="leader" />
          </div>
          {recent.map((cmd) => (
            <button className="init__cmd" key={cmd} onClick={() => onRun(cmd)} type="button">
              <span className="init__sigil">$</span>
              <span className="init__cmdtext">{cmd}</span>
            </button>
          ))}
        </section>
      )}

      {!started && (
        <div className="init__hints">
          <span className="init__hint">
            <KeyCap size="sm">⌘K</KeyCap> PALETTE
          </span>
          <span className="init__hint">
            <KeyCap size="sm">⌘D</KeyCap> SPLIT
          </span>
          <span className="init__hint">
            <KeyCap size="sm">⇥</KeyCap> ACCEPT SUGGESTION
          </span>
        </div>
      )}
    </Panel>
  )
}

function prettyPath(path: string, home?: string): string {
  if (home && path.startsWith(home)) {
    const rest = path.slice(home.length)
    return rest === '' ? '~' : `~${rest}`
  }
  return path
}

/** Just the shell's basename — the full path is in Settings, not the masthead. */
function shellName(shell?: string): string {
  if (!shell) return '—'
  return shell.split('/').at(-1) ?? shell
}
