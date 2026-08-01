/** Full terminal renderer, used when a program takes over the screen.
 *
 * The block stream cannot render in-place drawing, so anything interactive gets
 * a real xterm.js instance instead: a genuine cursor, a grid, and keyboard input
 * piped straight to the PTY. This is what makes `vim`, `htop` and interactive
 * CLIs like `shopify app dev` work rather than spraying escape fragments into a
 * block.
 *
 * The instance is created when the program takes over and disposed when it
 * exits, so an idle session pays nothing for it.
 */

import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

interface Props {
  /** Bytes already consumed from the PTY before the takeover was detected. */
  backlog: string
  /** Subscribe to subsequent PTY output; returns an unsubscribe. */
  subscribe: (handler: (data: string) => void) => () => void
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
  /** Whether this pane is focused; only then may the terminal take the caret. */
  focused: boolean
}

export function TerminalView({ backlog, subscribe, onData, onResize, focused }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Held in refs so the effect can stay mount-only; re-creating the terminal on
  // every render would drop the screen contents.
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const focusedRef = useRef(focused)
  const termRef = useRef<Terminal | null>(null)
  onDataRef.current = onData
  onResizeRef.current = onResize
  focusedRef.current = focused

  // Follow pane focus after mount, so clicking between split panes moves the
  // caret into whichever terminal the user selected.
  useEffect(() => {
    if (focused) termRef.current?.focus()
  }, [focused])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const styles = getComputedStyle(document.documentElement)
    const read = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback

    const term = new Terminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: read('--mono', 'ui-monospace, monospace'),
      fontSize: 12,
      lineHeight: 1.35,
      // Match the block stream's palette so the takeover does not read as a
      // different application.
      theme: {
        background: read('--bg', '#07090d'),
        foreground: read('--fg', '#e8eef2'),
        cursor: read('--ac', '#37e0f5'),
        cursorAccent: read('--bg', '#07090d'),
        selectionBackground: 'rgba(120,180,200,0.3)',
      },
      scrollback: 10_000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    // Report the true grid size before writing, so the program's first paint is
    // laid out for the space it actually has.
    // Only tell the PTY when the grid actually changes. Dragging a divider fires
    // the observer on every pixel, and each distinct size is a SIGWINCH the
    // program has to redraw for.
    let lastCols = -1
    let lastRows = -1

    const applyFit = () => {
      try {
        fit.fit()
      } catch {
        // fit() throws if the host is not laid out yet; the observer retries.
        return
      }
      if (term.cols === lastCols && term.rows === lastRows) return
      lastCols = term.cols
      lastRows = term.rows
      onResizeRef.current(term.cols, term.rows)
    }

    // Flex layout settles after paint, so a mount-time fit can measure a stale
    // box — most visibly in a freshly split pane. Measure on the next frame.
    const initialFit = requestAnimationFrame(applyFit)

    if (backlog) term.write(backlog)
    // Only claim the caret if this pane is the focused one — a program starting
    // in the background pane must not steal input from where the user is typing.
    if (focusedRef.current) term.focus()
    termRef.current = term

    const unsubscribe = subscribe((data) => term.write(data))
    const disposeInput = term.onData((data) => onDataRef.current(data))

    // Coalesce resize bursts into one fit per frame.
    let pending = 0
    const observer = new ResizeObserver(() => {
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        applyFit()
      })
    })
    observer.observe(host)

    return () => {
      cancelAnimationFrame(initialFit)
      if (pending) cancelAnimationFrame(pending)
      observer.disconnect()
      disposeInput.dispose()
      unsubscribe()
      termRef.current = null
      term.dispose()
    }
    // Mount-only: backlog and subscribe are captured at takeover time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="termview" ref={hostRef} />
}
