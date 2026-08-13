/** One pane: header, block stream, composer. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { getPty, useStore, type PaneId } from '../state/store'
import { Block } from './Block'
import { Composer } from './Composer'
import { PaneTabs } from './PaneTabs'
import { TerminalView } from './TerminalView'
import { Welcome } from './Welcome'

interface Props {
  pane: PaneId
  showClose: boolean
}

/** Distance from the bottom that still counts as "stuck to bottom". */
const STICK_SLOP = 24

export function Pane({ pane, showClose }: Props) {
  const focus = useStore((s) => s.focus)
  const split = useStore((s) => s.split)
  const paneMaximized = useStore((s) => s.paneMaximized)
  const host = useStore((s) => s.host)
  const foldThreshold = useStore((s) => s.settingsValues.foldThreshold)
  const paneState = useStore((s) => s.panes[pane])
  const sessions = useStore((s) => s.sessions)
  const setFocus = useStore((s) => s.setFocus)
  const closePane = useStore((s) => s.closePane)
  const setSessionInput = useStore((s) => s.setSessionInput)
  const submitInput = useStore((s) => s.submitInput)
  const runCommand = useStore((s) => s.runCommand)
  const cancelCurrent = useStore((s) => s.cancelCurrent)
  const dismissTakeover = useStore((s) => s.dismissTakeover)
  const acceptGhost = useStore((s) => s.acceptGhost)
  const requestCompletion = useStore((s) => s.requestCompletion)
  const recallHistory = useStore((s) => s.recallHistory)
  const toggleBlockFold = useStore((s) => s.toggleBlockFold)
  const setSessionSize = useStore((s) => s.setSessionSize)
  const newSession = useStore((s) => s.newSession)

  const sessionId = paneState.sessions[paneState.active] ?? null
  const session = sessionId ? sessions[sessionId] : undefined
  const focused = focus === pane
  const pty = sessionId ? getPty(sessionId) : undefined

  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showJump, setShowJump] = useState(false)

  // "Stick to bottom unless scrolled away" — the prototype auto-scrolled
  // unconditionally, which fights the user the moment they scroll up.
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLOP
    stick.current = atBottom
    setShowJump(!atBottom)
  }, [])

  const blockCount = session?.blocks.length ?? 0
  const lastLineCount = session?.blocks.at(-1)?.lines.length ?? 0

  // Growing the window can bring the bottom of the content back into view
  // without a scroll event ever firing — re-check "at bottom" whenever the
  // scroll container's own size changes, not just when its content does.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onScroll])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [blockCount, lastLineCount])

  const jumpToLatest = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stick.current = true
    setShowJump(false)
  }

  // Report the pane's character grid to the PTY so the shell can reflow.
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !sessionId) return
    // During a takeover the terminal renderer measures its own grid and reports
    // the authoritative size. Two writers would fight, and this one is only an
    // estimate — so it stands down while the terminal owns the pane.
    if (session?.takeover) return

    const report = () => {
      // Approximate the cell box from the block output metrics: 12px Geist Mono
      // is ~7.2px wide, and line-height comes from the density token.
      const style = getComputedStyle(el)
      const lh = Number.parseFloat(style.getPropertyValue('--lh')) || 1.62
      const cols = Math.max(20, Math.floor((el.clientWidth - 32) / 7.2))
      const rows = Math.max(6, Math.floor(el.clientHeight / (12 * lh)))
      void getPty(sessionId)?.resize(cols, rows)
      setSessionSize(sessionId, cols, rows)
      // The pane growing can bring the bottom of the stream back into view
      // without a scroll event ever firing — this observer already fires on
      // every window resize, so piggyback the same re-check here rather than
      // trust the scroll container's own (WKWebView-flaky) ResizeObserver alone.
      onScroll()
    }

    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sessionId, session?.takeover, setSessionSize, onScroll])

  if (!session || !sessionId) {
    return <div className="pane" data-focused={focused} />
  }

  const edgeColor = focused ? 'var(--ac)' : 'var(--bd2)'

  return (
    <div
      className="pane"
      data-focused={focused}
      onMouseDown={() => {
        if (!focused) setFocus(pane)
      }}
    >
      <PaneTabs pane={pane} />

      <header className="pane__head">
        <span className="pane__sq" style={{ background: edgeColor }} />
        <span className="pane__cwd" style={{ color: focused ? 'var(--fg)' : 'var(--fgd)' }}>
          {prettyPath(session.cwd, host?.home)}
        </span>
        {session.branch && <span className="pane__branch">⑂ {session.branch}</span>}
        {/* A remote pane names its host: which machine you are typing into is the
            single most consequential thing to be wrong about. */}
        {session.host !== 'local' && (
          <span className="pane__remote">⇄ {session.host}</span>
        )}
        {/* Only the focused pane can be maximized, so this only ever appears
            here — it is the one visible sign that a sibling pane is hidden
            rather than closed. */}
        {split && paneMaximized && focused && (
          <span className="pane__branch" title="⌘⇧M to restore the split">▸◂ MAXIMIZED</span>
        )}
        <span className="rule" />
        <span className="pane__status">{focused ? 'FOCUSED' : 'IDLE'}</span>
        {showClose && (
          <button
            className="pane__close is-btn no-drag"
            onClick={closePane}
            type="button"
            aria-label="Close pane"
          >
            ✕
          </button>
        )}
      </header>

      <div className="pane__body" ref={bodyRef}>
        <div className="pane__stream" ref={scrollRef} onScroll={onScroll}>
          {/* The masthead stays at the top of the stream for the life of the
              session rather than being swapped out by the first command, so
              scrolling back always returns to where the session started. Its
              suggestions collapse away once there is history — they are a
              cold-start affordance, not permanent chrome. */}
          <Welcome
            session={session}
            host={host}
            compact={pane === 'b'}
            started={session.blocks.length > 0}
            onRun={(cmd) => void runCommand(cmd, pane)}
          />
          {session.blocks.map((block, i) => (
            <Block
              key={block.id}
              block={block}
              foldThreshold={foldThreshold}
              isLatest={i === session.blocks.length - 1}
              onCancel={() => void cancelCurrent(sessionId)}
              onRerun={(cmd) => void runCommand(cmd, pane)}
              onToggleFold={() => toggleBlockFold(sessionId, block.id)}
            />
          ))}
        </div>

        {showJump && !session.takeover && (
          <button className="pane__jump no-drag" onClick={jumpToLatest} type="button">
            ↓ JUMP TO LATEST
          </button>
        )}

        {/* An interactive program gets a real terminal in an overlay above the
            pane it was launched from, rather than replacing the pane outright —
            the block history stays visible behind it as context.

            It stays up past the program's own exit, too: this used to snap
            back to the block view the instant the process ended, which took
            whatever it had just printed — a Shopify CLI table, say — with it
            before anyone could read it. Now "finished" gets the same overlay,
            frozen on its last frame, until the user dismisses it on purpose. */}
        {session.takeover && pty && (
          <div className="takeover">
            <div className="takeover__panel">
              <span className="bracket bracket--tl" style={{ width: 11, height: 11 }} />
              <span className="bracket bracket--br" style={{ width: 11, height: 11 }} />

              <div className="takeover__head">
                <span
                  className="dot"
                  style={{ color: session.takeover === 'finished' ? 'var(--fgdd)' : 'var(--warn)' }}
                />
                <span className="micro">
                  {session.takeover === 'finished' ? 'SESSION FINISHED' : 'INTERACTIVE SESSION'}
                </span>
                <span className="takeover__cmd">
                  {session.blocks.at(-1)?.cmd ?? ''}
                </span>
                <span className="rule" />
                {session.takeover === 'finished' ? (
                  // The program is already gone; this just puts the pane back
                  // to the block view whenever the user is done reading.
                  <button
                    className="block__cancel is-btn no-drag"
                    onClick={() => dismissTakeover(sessionId)}
                    type="button"
                    title="Close and return to the block view"
                  >
                    EXIT
                  </button>
                ) : (
                  // Same action as ⌃C in the terminal below — this is a second,
                  // more discoverable way to reach it, not a stronger kill. Most
                  // people reaching for this want out of the one command, not the
                  // whole session, so it stops there rather than closing the pane.
                  <button
                    className="block__cancel is-btn is-btn--danger no-drag"
                    onClick={() => void cancelCurrent(sessionId)}
                    type="button"
                    title="Send ⌃C to the running program"
                  >
                    ⌃C EXIT
                  </button>
                )}
              </div>

              <TerminalView
                key={`${sessionId}-takeover`}
                sessionId={sessionId}
                backlog={pty.getTakeoverBacklog()}
                subscribe={(handler) => pty.onRaw(handler)}
                onData={(data) => {
                  if (session.takeover === 'finished') return
                  void pty.write(data)
                }}
                onResize={(cols, rows) => {
                  if (session.takeover === 'finished') return
                  void pty.resize(cols, rows)
                  setSessionSize(sessionId, cols, rows)
                }}
                focused={focused}
              />
            </div>
          </div>
        )}
      </div>

      {/* A shell that never started would otherwise be invisible: the composer
          looks ready and every command hangs on RUNNING. Say so instead, and
          offer the one action that actually helps. */}
      {session.failed && (
        <div className="pane__dead">
          <span className="dot" style={{ color: 'var(--err)' }} />
          <span className="micro">SHELL NOT RUNNING</span>
          <span className="pane__deadwhy">{session.failed}</span>
          <span className="rule" />
          <button
            className="pane__deadact no-drag"
            type="button"
            onClick={() => void newSession(session.profileId, pane, { cwd: session.cwd })}
          >
            NEW SESSION
          </button>
        </div>
      )}

      {/* The shell exited on its own (`exit`, ⌃D, the process crashed). The pane
          used to just go quietly inert here — scrollback intact but nothing
          telling you the shell was gone, so closing it read as no different
          from closing a live one. Saying so plainly, and disabling the
          composer, makes "done" look like "done" instead of "stuck". */}
      {!session.failed && session.exited && (
        <div className="pane__dead">
          <span className="dot" style={{ color: session.exited.code ? 'var(--err)' : 'var(--fgdd)' }} />
          <span className="micro">
            PROCESS EXITED{session.exited.code !== null ? ` (CODE ${session.exited.code})` : ''}
          </span>
          <span className="rule" />
          <button
            className="pane__deadact no-drag"
            type="button"
            onClick={() => void newSession(session.profileId, pane, { cwd: session.cwd })}
          >
            NEW SESSION
          </button>
        </div>
      )}

      {/* Kept mounted during a takeover — anything half-typed survives — but
          inert, since keystrokes belong to the program the terminal is running. */}
      <Composer
        value={session.input}
        ghost={session.ghost}
        focused={focused && !session.takeover && !session.failed && !session.exited}
        disabled={!!session.takeover || !!session.failed || !!session.exited}
        shellLabel={shellLabel(host?.shell)}
        onChange={(v) => setSessionInput(sessionId, v)}
        onSubmit={() => void submitInput(sessionId)}
        onAcceptGhost={() => acceptGhost(sessionId)}
        onHistory={(d) => recallHistory(sessionId, d)}
        onCancel={() => void cancelCurrent(sessionId)}
        onFocus={() => setFocus(pane)}
        onComplete={() => requestCompletion(sessionId)}
      />
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

function shellLabel(shell?: string): string {
  if (!shell) return ''
  const parts = shell.split('/')
  const name = parts.at(-1) ?? shell
  const dir = parts.slice(0, -1).join('/')
  return `${name} · ${dir}`
}
