/** One pane: tabs, header, block stream, composer.
 *
 * Depth here is line brightness and surface fill, never a shadow or a border
 * weight: the focused pane sits on --void with an amber label and an --ink-100
 * command, the unfocused one on --surface-1 with everything a step dimmer. That
 * is the whole difference — no glow, no scale, no outline.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { getPty, useStore, type PaneId } from '../state/store'
import { Alert, Badge, Button, Frame, Icon, Panel } from './grid'
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
  const panel = useStore((s) => s.settingsValues.panel)
  const scrollbackCap = useStore((s) => s.settingsValues.scrollbackCap)

  /**
   * Above this many lines a block stops being an addressable unit and becomes
   * a scrollback spill, so it drops its frame entirely.
   *
   * Deliberately a fraction of the scrollback cap rather than the cap itself.
   * `PtySession` trims each block's lines *to* the cap (see the slice in
   * `session.ts`), so `lines.length` can never exceed it and a threshold set
   * there would never fire — the raw-dump case would be unreachable and every
   * dump would still get a frame. A quarter of the buffer is comfortably past
   * "a command that printed a lot" while staying well inside what the session
   * actually retains.
   */
  const rawDumpThreshold = Math.max(200, Math.floor(scrollbackCap / 4))
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
      // Approximate the cell box from the block output metrics. Space Mono is a
      // wider face than the Geist Mono this replaced — 0.6em advance at 13px,
      // so ~7.8px — and leading comes from the density token.
      const style = getComputedStyle(el)
      const lh = Number.parseFloat(style.getPropertyValue('--leading-block')) || 1.65
      const cols = Math.max(20, Math.floor((el.clientWidth - 32) / 7.8))
      const rows = Math.max(6, Math.floor(el.clientHeight / (13 * lh)))
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

  const user = shortUser(host?.home)
  const shortHost = session.host === 'local' ? hostName(host?.hostname) : session.host
  const path = prettyPath(session.cwd, host?.home)

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
        <span className="pane__label">{focused ? 'PANE .FOCUS' : 'PANE .IDLE'}</span>
        <span className="pane__cwd">{path}</span>
        {session.branch && <span className="pane__meta">⑂ {session.branch}</span>}
        {/* A remote pane names its host: which machine you are typing into is
            the single most consequential thing to be wrong about. */}
        {session.host !== 'local' && (
          <span className="pane__meta pane__meta--remote">
            <Icon name="globe" size={12} />
            {session.host}
          </span>
        )}
        {/* Only the focused pane can be maximized, so this only ever appears
            here — it is the one visible sign that a sibling pane is hidden
            rather than closed. */}
        {split && paneMaximized && focused && (
          <span className="pane__meta" title="⌘⇧M to restore the split">
            ▸◂ MAXIMIZED
          </span>
        )}
        <span className="leader" />
        <Badge tone={focused ? 'accent' : 'neutral'}>{focused ? 'FOCUSED' : 'IDLE'}</Badge>
        {showClose && (
          <button className="pane__close no-drag" onClick={closePane} type="button" aria-label="Close pane">
            <Icon name="x" size={12} />
          </button>
        )}
      </header>

      <div className="pane__body" ref={bodyRef}>
        <div className="pane__stream" ref={scrollRef} onScroll={onScroll}>
          <Welcome
            session={session}
            host={host}
            compact={pane === 'b'}
            started={session.blocks.length > 0}
            panel={panel}
            total={session.blocks.length}
            onRun={(cmd) => void runCommand(cmd, pane)}
          />
          {session.blocks.map((block, i) => (
            <Block
              key={block.id}
              block={block}
              foldThreshold={foldThreshold}
              isLatest={i === session.blocks.length - 1}
              panel={panel}
              rawDumpThreshold={rawDumpThreshold}
              cwd={prettyPath(block.cwd, host?.home)}
              user={user}
              host={shortHost}
              onCancel={() => void cancelCurrent(sessionId)}
              onRerun={(cmd) => void runCommand(cmd, pane)}
              onToggleFold={() => toggleBlockFold(sessionId, block.id)}
            />
          ))}
        </div>

        {showJump && !session.takeover && (
          <Button className="pane__jump no-drag" size="sm" variant="secondary" onClick={jumpToLatest}>
            ↓ JUMP TO LATEST
          </Button>
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
            <Panel
              className="takeover__panel"
              heading={session.takeover === 'finished' ? 'SESSION .FINISHED' : 'INTERACTIVE .SESSION'}
              // Cyan is "attached and streaming". A finished takeover has
              // nothing live about it, so it drops to the neutral frame rather
              // than keep claiming a signal it no longer earns.
              panelColor={session.takeover === 'finished' ? null : 'var(--signal-cyan)'}
              contentBorder={false}
              headerMeta={<span className="takeover__cmd">{session.blocks.at(-1)?.cmd ?? ''}</span>}
              headerRight={
                <>
                  <Badge
                    tone={session.takeover === 'finished' ? 'neutral' : 'live'}
                    dot={session.takeover !== 'finished'}
                    filled={session.takeover !== 'finished'}
                  >
                    {session.takeover === 'finished' ? 'SESSION FINISHED' : 'ATTACHED'}
                  </Badge>
                  {session.takeover === 'finished' ? (
                    // The program is already gone; this just puts the pane back
                    // to the block view whenever the user is done reading.
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => dismissTakeover(sessionId)}
                      title="Close and return to the block view"
                    >
                      EXIT
                    </Button>
                  ) : (
                    // Same action as ⌃C in the terminal below — a second, more
                    // discoverable way to reach it, not a stronger kill. Most
                    // people reaching for this want out of the one command, not
                    // the whole session, so it stops there.
                    <Button
                      size="sm"
                      variant="signal"
                      tone="danger"
                      onClick={() => void cancelCurrent(sessionId)}
                      title="Send ⌃C to the running program"
                    >
                      ⌃C EXIT
                    </Button>
                  )}
                </>
              }
            >
              {/* The grid gets its own double frame at --stroke-1: inside the
                  window's 2px double frame, a second 2px one would be the
                  corduroy the single-hairline rule exists to prevent. */}
              <Frame
                weight="hairline"
                color={session.takeover === 'finished' ? 'var(--line-300)' : 'var(--live)'}
                pad="var(--space-3)"
                className="takeover__frame"
              >
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
              </Frame>
            </Panel>
          </div>
        )}
      </div>

      {/* A shell that never started would otherwise be invisible: the composer
          looks ready and every command hangs on RUNNING. Say so instead, and
          offer the one action that actually helps. */}
      {session.failed && (
        <Alert
          className="pane__dead"
          tone="danger"
          title="SHELL NOT RUNNING"
          icon="triangle-alert"
          action={
            <Button
              size="sm"
              variant="primary"
              tone="danger"
              onClick={() => void newSession(session.profileId, pane, { cwd: session.cwd })}
            >
              NEW SESSION
            </Button>
          }
        >
          {session.failed}
        </Alert>
      )}

      {/* The shell exited on its own (`exit`, ⌃D, the process crashed).
          Deliberately NEUTRAL, not an error: a clean exit is a shell doing
          exactly what it was told, and the old build painted a zero exit code in
          the error colour, which called that a failure. A non-zero code may take
          the danger treatment. */}
      {!session.failed && session.exited && (
        <Alert
          className="pane__dead"
          tone={session.exited.code ? 'danger' : 'neutral'}
          title={`PROCESS EXITED${session.exited.code !== null ? ` (CODE ${session.exited.code})` : ''}`}
          icon="power"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void newSession(session.profileId, pane, { cwd: session.cwd })}
            >
              NEW SESSION
            </Button>
          }
        />
      )}

      {/* Kept mounted during a takeover — anything half-typed survives — but
          inert, since keystrokes belong to the program the terminal is running. */}
      <Composer
        value={session.input}
        ghost={session.ghost}
        focused={focused && !session.takeover && !session.failed && !session.exited}
        disabled={!!session.takeover || !!session.failed || !!session.exited}
        shellLabel={shellLabel(host?.shell)}
        user={user}
        host={shortHost}
        path={path}
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

/** The user's short name, taken from the home directory's basename. */
function shortUser(home?: string): string {
  if (!home) return 'user'
  return home.split('/').at(-1) ?? 'user'
}

/** The host's short name — `crggr-08`, not `crggr-08.local`. */
function hostName(hostname?: string): string {
  if (!hostname) return 'local'
  return hostname.split('.')[0] ?? hostname
}

function shellLabel(shell?: string): string {
  if (!shell) return ''
  const parts = shell.split('/')
  const name = parts.at(-1) ?? shell
  const dir = parts.slice(0, -1).join('/')
  return `${name} · ${dir}`
}
