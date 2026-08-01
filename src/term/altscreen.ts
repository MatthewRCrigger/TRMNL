/** Alternate-screen detection.
 *
 * The block stream is a line-append surface: it has no cursor, so it cannot
 * render anything that draws in place. That is fine for ordinary commands, and
 * wrong for full-screen programs — vim, htop, and interactive CLIs like
 * `shopify app dev`, which paint boxed panels, redraw spinners over themselves
 * and ask questions with arrow-key menus.
 *
 * Such programs announce themselves by switching to the alternate screen buffer
 * (`CSI ? 1049 h`, or the older 1047/47 variants). That switch is the signal to
 * hand the PTY to a real terminal emulator, and the switch back is the signal to
 * return to the block stream.
 *
 * Some programs never switch buffers but still redraw in place — webpack's
 * progress line is the example from this project. Those are caught separately by
 * watching for heavy cursor addressing; see `looksInteractive`.
 */

/** Enter: CSI ? 1049 h / 1047 h / 47 h. Leave: the same codes with `l`. */
const ALT_ENTER = /\x1b\[\?(?:1049|1047|47)h/
const ALT_LEAVE = /\x1b\[\?(?:1049|1047|47)l/

export function entersAltScreen(chunk: string): boolean {
  return ALT_ENTER.test(chunk)
}

export function leavesAltScreen(chunk: string): boolean {
  return ALT_LEAVE.test(chunk)
}

/**
 * Cursor-addressing sequences that only make sense against a real grid:
 * absolute positioning, cursor up/down, line erase, screen clear.
 */
const CURSOR_CONTROL = /\x1b\[(?:\d*;\d*[Hf]|\d*[ABF]|[12]?K|[12]J)/g

/**
 * Heuristic for a program that is repainting rather than appending.
 *
 * Counting cursor-control sequences per chunk distinguishes a progress line
 * redrawing itself from ordinary output that merely contains colour. The
 * threshold is deliberately high: misfiring here would swap a perfectly good
 * block into a terminal view, which is far more disruptive than leaving a busy
 * progress line rendering as text.
 */
export function looksInteractive(chunk: string): boolean {
  const addressing = (chunk.match(CURSOR_CONTROL) ?? []).length
  if (addressing >= 12) return true

  // A carriage return with no newline is an in-place redraw too — a spinner may
  // use only these and never address the cursor at all — so it is counted
  // independently rather than as a fallback.
  const redraws = (chunk.match(/\r(?!\n)/g) ?? []).length
  return redraws >= 8
}

/** A full-screen clear: the program is painting the whole viewport. */
const SCREEN_CLEAR = /\x1b\[[12]?J|\x1b\[H/

/** Synchronised-output markers, used by Ink and other modern TUI renderers. */
const SYNC_UPDATE = /\x1b\[\?2026[hl]/

/**
 * Rolling detector for programs that repaint without switching screen buffers.
 *
 * Modern Node TUIs — Ink, which the Shopify CLI is built on — never enter the
 * alternate screen. They erase and rewrite lines in place instead, so the signal
 * is spread thinly across many small chunks rather than concentrated in one.
 * Measured against the real `shopify app dev`: 416 line-erases and 417 carriage
 * returns across ~14 kB, but rarely more than a handful in any single chunk.
 *
 * Counting over a time window catches that pattern while still ignoring a
 * command that merely prints a progress line now and then.
 */
export class RepaintDetector {
  private events: number[] = []
  private readonly windowMs: number
  private readonly threshold: number

  constructor(windowMs = 1500, threshold = 20) {
    this.windowMs = windowMs
    this.threshold = threshold
  }

  /** Feed a chunk; returns true once the window looks like a repainting UI. */
  push(chunk: string, now: number): boolean {
    // A screen clear or a sync-update marker is decisive on its own: ordinary
    // command output never clears the viewport.
    if (SCREEN_CLEAR.test(chunk) || SYNC_UPDATE.test(chunk)) return true

    const signals =
      (chunk.match(/\x1b\[[12]?K/g) ?? []).length + (chunk.match(/\r(?!\n)/g) ?? []).length
    for (let i = 0; i < signals; i++) this.events.push(now)

    const cutoff = now - this.windowMs
    while (this.events.length > 0 && this.events[0]! < cutoff) this.events.shift()

    return this.events.length >= this.threshold
  }

  reset(): void {
    this.events = []
  }
}
