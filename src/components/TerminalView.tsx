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
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { openUrl } from '@tauri-apps/plugin-opener'
import '@xterm/xterm/css/xterm.css'

import { registerTakeoverLinks } from '../term/takeoverLinks'

interface Props {
  /** Which session this terminal belongs to — lets the global context menu
   *  (which has no reference to this instance) look up its hovered link or
   *  selection. See term/takeoverLinks.ts. */
  sessionId: string
  /** Bytes already consumed from the PTY before the takeover was detected. */
  backlog: string
  /** Subscribe to subsequent PTY output; returns an unsubscribe. */
  subscribe: (handler: (data: string) => void) => () => void
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
  /** Whether this pane is focused; only then may the terminal take the caret. */
  focused: boolean
}

export function TerminalView({ sessionId, backlog, subscribe, onData, onResize, focused }: Props) {
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

    /**
     * A colour token, resolved to something xterm can parse.
     *
     * Custom properties come back from `getPropertyValue` as their unresolved
     * text, so a token defined with relative colour syntax — `--ac` is
     * `oklch(from …)` — arrives as that literal function string, which xterm
     * cannot read. Assigning it to a real element and reading back `color`
     * makes the engine do the substitution and hand back an actual colour.
     */
    const readColor = (name: string, fallback: string) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${name})`
      probe.style.display = 'none'
      document.body.appendChild(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      return resolved || fallback
    }

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
        background: readColor('--bg', '#07090d'),
        foreground: readColor('--fg', '#e8eef2'),
        cursor: readColor('--ac', '#37e0f5'),
        cursorAccent: readColor('--bg', '#07090d'),
        selectionBackground: 'rgba(120,180,200,0.3)',
      },
      scrollback: 10_000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    // Matches the block stream's own convention (see LineContent in Block.tsx):
    // plain click stays a normal terminal click (placing the caret, extending a
    // selection), ⌘-click is what opens the link. A takeover program owns real
    // mouse input here, so a bare click opening a browser out from under it
    // would be a much bigger surprise than in the block stream, where a click
    // only ever meant "select text".
    //
    // hover/leave track which URL (if any) is currently under the pointer, so
    // ContextMenu.tsx — which has no reference to this instance — can offer
    // "Copy Link" on a right-click without xterm.js exposing a synchronous
    // "what's at this point" query of its own.
    let hoveredUrl: string | null = null
    term.loadAddon(
      new WebLinksAddon(
        (event, uri) => {
          if (!event.metaKey) return
          void openUrl(uri).catch(() => {})
        },
        {
          hover: (_event, uri) => {
            hoveredUrl = uri
          },
          leave: () => {
            hoveredUrl = null
          },
        },
      ),
    )
    term.open(host)

    const unregister = registerTakeoverLinks(sessionId, {
      get hoveredUrl() {
        return hoveredUrl
      },
      getSelection: () => term.getSelection(),
    })

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
      unregister()
      termRef.current = null
      term.dispose()
    }
    // Mount-only: backlog, subscribe and sessionId are captured at takeover time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="termview" ref={hostRef} data-session-id={sessionId} />
}
