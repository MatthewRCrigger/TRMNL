/** Takeover detection decides whether a pane keeps its block stream or swaps to
 * a full terminal. A false positive is disruptive — it replaces a perfectly
 * readable block with a terminal — so the heuristic is tested against real
 * output that must NOT trigger it. */

import { describe, expect, it } from 'vitest'

import {
  RepaintDetector,
  entersAltScreen,
  leavesAltScreen,
  looksInteractive,
} from './altscreen'

describe('alternate screen', () => {
  it('detects the modern and legacy enter sequences', () => {
    expect(entersAltScreen('\x1b[?1049h')).toBe(true)
    expect(entersAltScreen('\x1b[?1047h')).toBe(true)
    expect(entersAltScreen('\x1b[?47h')).toBe(true)
  })

  it('detects the matching leave sequences', () => {
    expect(leavesAltScreen('\x1b[?1049l')).toBe(true)
    expect(leavesAltScreen('\x1b[?47l')).toBe(true)
  })

  it('does not confuse enter with leave', () => {
    expect(leavesAltScreen('\x1b[?1049h')).toBe(false)
    expect(entersAltScreen('\x1b[?1049l')).toBe(false)
  })

  it('ignores unrelated private modes', () => {
    // Bracketed paste and cursor visibility are not screen switches.
    expect(entersAltScreen('\x1b[?2004h')).toBe(false)
    expect(entersAltScreen('\x1b[?25l')).toBe(false)
  })
})

describe('looksInteractive', () => {
  it('is false for plain text', () => {
    expect(looksInteractive('hello world\n')).toBe(false)
  })

  it('is false for ordinary coloured output', () => {
    // A git status or test run is colourful but never repaints.
    const coloured =
      '\x1b[32m✓\x1b[0m passed\n\x1b[31m✗\x1b[0m failed\n\x1b[33mwarn\x1b[0m\n'
    expect(looksInteractive(coloured)).toBe(false)
  })

  it('is false for a single progress redraw', () => {
    // One carriage return is common in ordinary output; it is not a takeover.
    expect(looksInteractive('Downloading... 50%\r')).toBe(false)
  })

  it('is false for a short line-erase', () => {
    expect(looksInteractive('building\x1b[K\n')).toBe(false)
  })

  it('is true for heavy cursor addressing', () => {
    // A TUI painting a frame: absolute positioning repeated across the screen.
    const frame = Array.from({ length: 14 }, (_, i) => `\x1b[${i + 1};1H row ${i}`).join('')
    expect(looksInteractive(frame)).toBe(true)
  })

  it('is true for a spinner redrawing many times in one chunk', () => {
    const spinner = Array.from({ length: 10 }, (_, i) => `\rframe ${i}`).join('')
    expect(looksInteractive(spinner)).toBe(true)
  })

  it('treats a newline-terminated CR as ordinary output', () => {
    // CRLF line endings must not read as in-place redraws.
    const crlf = 'line one\r\nline two\r\nline three\r\n'.repeat(6)
    expect(looksInteractive(crlf)).toBe(false)
  })
})

describe('RepaintDetector', () => {
  it('catches a repaint spread thinly across many chunks', () => {
    // The real shape of an Ink CLI such as `shopify app dev`: measured at 416
    // line-erases over ~14 kB, but only a couple in any single chunk — which is
    // exactly why per-chunk detection missed it.
    const detector = new RepaintDetector()
    let triggered = false
    for (let i = 0; i < 30; i++) {
      if (detector.push('\x1b[2K\rbuilding…', 1000 + i * 20)) {
        triggered = true
        break
      }
    }
    expect(triggered).toBe(true)
  })

  it('treats a full-screen clear as decisive on its own', () => {
    // Ordinary command output never clears the viewport.
    expect(new RepaintDetector().push('\x1b[2J\x1b[H', 1000)).toBe(true)
  })

  it('treats a synchronised-output marker as decisive', () => {
    // Ink brackets its frames with these; nothing else emits them.
    expect(new RepaintDetector().push('\x1b[?2026h', 1000)).toBe(true)
  })

  it('ignores signals that trickle in below the rate', () => {
    // A command printing an occasional progress line over minutes is not a UI.
    const detector = new RepaintDetector()
    let triggered = false
    for (let i = 0; i < 40; i++) {
      if (detector.push('\rprogress', 1000 + i * 5000)) triggered = true
    }
    expect(triggered).toBe(false)
  })

  it('ignores ordinary output entirely', () => {
    const detector = new RepaintDetector()
    let triggered = false
    for (let i = 0; i < 50; i++) {
      if (detector.push(`compiling module ${i}\n`, 1000 + i * 10)) triggered = true
    }
    expect(triggered).toBe(false)
  })

  it('forgets history on reset', () => {
    const detector = new RepaintDetector()
    for (let i = 0; i < 15; i++) detector.push('\x1b[2K', 1000 + i * 10)
    detector.reset()
    expect(detector.push('\x1b[2K', 1200)).toBe(false)
  })
})
