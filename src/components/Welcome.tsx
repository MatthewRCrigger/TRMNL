/** Fresh-session (welcome) state.
 *
 * Shown in place of the block stream when a session has zero blocks — every new
 * session, every empty profile, every fresh split pane.
 *
 * The DETECTED line and SUGGESTED commands are real product behavior: the cwd is
 * inspected on the Rust side and every suggestion comes from a file that was
 * actually read. Never show a suggestion that would fail.
 */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import type { HostInfo, Session } from '../state/store'

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
  onRun: (cmd: string) => void
}

export function Welcome({ session, host, compact, started = false, onRun }: Props) {
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

  return (
    <div className="welcome" data-compact={compact} data-started={started}>
      <div className="welcome__mark">
        <span className="welcome__word">TRMNL</span>
        <span className="welcome__ver">
          {host ? `${host.version} · DARWIN ${host.osVersion} ${host.arch.toUpperCase()}` : ''}
        </span>
      </div>

      <div className="welcome__grid">
        <span className="welcome__key">SESSION</span>
        <span className="welcome__val">
          {session.name} · {session.host}
        </span>

        <span className="welcome__key">PATH</span>
        <span className="welcome__val">{prettyPath(session.cwd, host?.home)}</span>

        <span className="welcome__key">BRANCH</span>
        <span className="welcome__val">
          {session.branch || detection?.branch ? (
            <>⑂ {session.branch || detection?.branch}</>
          ) : (
            '—'
          )}
        </span>

        <span className="welcome__key">DETECTED</span>
        <span className="welcome__val">{detection?.stack || '…'}</span>
      </div>

      {/* Suggestions, recents and the key hints are all cold-start scaffolding.
          Once the session has real history they would be stale noise sitting above
          it, so they drop away and the masthead keeps only the identity grid. */}
      {!started && detection && detection.suggestions.length > 0 && (
        <section className="welcome__section">
          <div className="welcome__head">
            <span className="micro">SUGGESTED</span>
            <span className="welcome__source">{detection.source}</span>
            <span className="rule" />
          </div>
          {detection.suggestions.map((s) => (
            <button
              className="welcome__cmd"
              key={s.cmd}
              onClick={() => onRun(s.cmd)}
              type="button"
            >
              <span className="welcome__chev">❯</span>
              <span className="welcome__cmdtext">{s.cmd}</span>
              <span className="welcome__note">{s.note}</span>
              <span className="kbd">↵</span>
            </button>
          ))}
        </section>
      )}

      {!started && recent.length > 0 && (
        <section className="welcome__section">
          <div className="welcome__head">
            <span className="micro">RECENT</span>
            <span className="rule" />
          </div>
          {recent.map((cmd) => (
            <button
              className="welcome__recent"
              key={cmd}
              onClick={() => onRun(cmd)}
              type="button"
            >
              <span className="welcome__chev">❯</span>
              <span className="welcome__cmdtext">{cmd}</span>
            </button>
          ))}
        </section>
      )}

      {!started && (
      <div className="welcome__hints">
        <span>
          <span className="welcome__hintkey">⌘K</span> PALETTE
        </span>
        <span>
          <span className="welcome__hintkey">⌘D</span> SPLIT
        </span>
        <span>
          <span className="welcome__hintkey">⇥</span> ACCEPT SUGGESTION
        </span>
        <span className="welcome__eol">END OF LINE</span>
      </div>
      )}
    </div>
  )
}

function prettyPath(path: string, home?: string): string {
  if (home && path.startsWith(home)) {
    const rest = path.slice(home.length)
    return rest === '' ? '~' : `~${rest}`
  }
  return path
}
