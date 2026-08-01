/** OSC 133 semantic-prompt parser and ANSI-to-tone converter.
 *
 * The block model needs to know exactly where commands start and end. The shell
 * hooks we install emit OSC 133 markers; this module extracts them from the raw
 * PTY byte stream and hands the caller clean text plus boundary events.
 *
 * Sequences we care about:
 *   OSC 133 ; A ST      prompt start
 *   OSC 133 ; B ST      command start (end of prompt)
 *   OSC 133 ; C ST      output start (command submitted)
 *   OSC 133 ; D ; <n> ST command end, exit code n
 *   OSC 7  ; file://host/path ST   cwd report
 *
 * ST is either BEL (\x07) or ESC \ (\x1b\x5c).
 *
 * Anything that is not one of those is passed through untouched — this parser
 * must never mangle ordinary output.
 */

import type { Tone } from './types'

export type Osc133Event =
  | { type: 'prompt-start' }
  | { type: 'command-start' }
  | { type: 'output-start' }
  | { type: 'command-end'; code: number }
  | { type: 'cwd'; cwd: string }
  | { type: 'text'; text: string }

const BEL = '\x07'
const ESC = '\x1b'

/** Longest OSC body we will buffer while waiting for a terminator. */
const MAX_OSC_LENGTH = 4096

/**
 * Incremental parser. PTY chunks split anywhere, including mid-escape-sequence,
 * so unterminated tails are held back until the next chunk completes them.
 */
export class Osc133Parser {
  private pending = ''

  /** Feed a chunk; returns the events it produced, in order. */
  feed(chunk: string): Osc133Event[] {
    const events: Osc133Event[] = []
    let buf = this.pending + chunk
    this.pending = ''
    let text = ''

    let i = 0
    while (i < buf.length) {
      const esc = buf.indexOf(ESC, i)
      if (esc === -1) {
        text += buf.slice(i)
        break
      }

      // A trailing ESC (or ESC with nothing after it yet) may be the start of an
      // OSC that the next chunk completes. Hold it rather than emitting it as
      // text — otherwise byte-at-a-time streaming never sees a marker.
      if (esc === buf.length - 1) {
        text += buf.slice(i, esc)
        this.pending = ESC
        break
      }

      // ESC not followed by ']' is some other escape; pass it through.
      if (buf[esc + 1] !== ']') {
        text += buf.slice(i, esc + 2)
        i = esc + 2
        continue
      }

      // Text before the sequence flushes first so ordering is preserved.
      text += buf.slice(i, esc)

      const term = findTerminator(buf, esc + 2)
      if (term === -1) {
        const tail = buf.slice(esc)
        // A sequence that never terminates would otherwise grow `pending`
        // without bound. Past a sane OSC length, treat it as ordinary text.
        if (tail.length > MAX_OSC_LENGTH) {
          text += tail
          break
        }
        // Incomplete OSC. Hold it for the next chunk rather than emitting a
        // partial sequence as visible text.
        this.pending = tail
        break
      }

      const body = buf.slice(esc + 2, term.start)
      const event = parseOsc(body)
      if (event) {
        if (text) {
          events.push({ type: 'text', text })
          text = ''
        }
        events.push(event)
      } else {
        // Not a sequence we handle (title changes, colour queries, …). Pass it
        // through so xterm can deal with it.
        text += buf.slice(esc, term.end)
      }

      i = term.end
    }

    if (text) events.push({ type: 'text', text })
    return events
  }

  reset(): void {
    this.pending = ''
  }
}

function findTerminator(buf: string, from: number): { start: number; end: number } | -1 {
  for (let i = from; i < buf.length; i++) {
    if (buf[i] === BEL) return { start: i, end: i + 1 }
    if (buf[i] === ESC) {
      // ESC \ is ST. A trailing ESC is undecidable yet — treat the sequence as
      // incomplete so the caller holds it for the next chunk.
      if (buf[i + 1] === undefined) return -1
      if (buf[i + 1] === '\\') return { start: i, end: i + 2 }
      // Any other ESC means this OSC was never terminated properly; end it here
      // so a malformed sequence cannot swallow the rest of the stream.
      return { start: i, end: i }
    }
  }
  return -1
}

function parseOsc(body: string): Osc133Event | null {
  if (body.startsWith('133;')) {
    const parts = body.slice(4).split(';')
    switch (parts[0]) {
      case 'A':
        return { type: 'prompt-start' }
      case 'B':
        return { type: 'command-start' }
      case 'C':
        return { type: 'output-start' }
      case 'D': {
        const code = Number.parseInt(parts[1] ?? '0', 10)
        return { type: 'command-end', code: Number.isFinite(code) ? code : 0 }
      }
      default:
        return null
    }
  }

  if (body.startsWith('7;')) {
    const url = body.slice(2)
    const match = /^file:\/\/[^/]*(\/.*)$/.exec(url)
    if (match?.[1]) {
      return { type: 'cwd', cwd: decodeURIComponent(match[1]) }
    }
    return null
  }

  return null
}

/* ------------------------------------------------------------------------- */

/** ANSI SGR sequences, plus the control sequences we discard. */
const SGR = /\x1b\[([0-9;]*)m/g
const CSI_OTHER = /\x1b\[[0-9;?]*[A-Za-z]/g
const OTHER_ESC = /\x1b[()][0-9A-Za-z]|\x1b[=>]/g

/**
 * Apply carriage-return semantics to a single line.
 *
 * A bare `\r` returns the cursor to column zero, so whatever follows overwrites
 * what came before rather than appending to it. Programs rely on this to redraw
 * in place — progress bars, spinners, `curl`, and zsh's own EOL-mark erase
 * (`CR space CR`). Deleting `\r` outright would leave all of that as visible
 * garbage, so it is emulated here instead.
 */
function applyCarriageReturns(line: string): string {
  if (!line.includes('\r')) return line

  let out = ''
  for (const segment of line.split('\r')) {
    // Each segment overwrites from column zero, keeping any tail of the
    // previous content that it does not cover.
    out = segment + (segment.length < out.length ? out.slice(segment.length) : '')
  }
  return out
}

/**
 * Convert a run of ANSI-coloured text into tone-tagged lines.
 *
 * The design renders output in six tones rather than full 256-colour fidelity,
 * so this maps SGR colours onto that palette. It is intentionally lossy: the
 * block stream is a styled reading surface, not a framebuffer. A pane running a
 * full-screen TUI (vim, htop) needs the real xterm renderer instead.
 */
export function ansiToLines(text: string): { text: string; tone: Tone }[] {
  const out: { text: string; tone: Tone }[] = []
  // Tone carries across line breaks, as it does in a real terminal.
  let tone: Tone = 'txt'

  for (const rawLine of text.split('\n')) {
    // A line can hold several colours, so it is split into runs. The dominant
    // run — the longest non-blank one — decides the row's tone, because the
    // block stream renders one colour per row rather than per span.
    const runs: { text: string; tone: Tone }[] = []
    let last = 0
    SGR.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = SGR.exec(rawLine)) !== null) {
      const segment = rawLine.slice(last, match.index)
      if (segment) runs.push({ text: segment, tone })
      last = match.index + match[0].length
      tone = applySgr(match[1] ?? '', tone)
    }
    const tail = rawLine.slice(last)
    if (tail) runs.push({ text: tail, tone })

    const clean = (s: string) => s.replace(CSI_OTHER, '').replace(OTHER_ESC, '')
    // Carriage returns resolve after escapes are stripped, so an erase sequence
    // is measured against the visible text rather than the raw bytes.
    const lineText = applyCarriageReturns(clean(runs.map((r) => r.text).join(''))).trimEnd()

    // Prefer the longest coloured (non-txt) run so a red error keeps its colour
    // even when the line ends with a reset.
    let chosen: Tone = 'txt'
    let bestLength = 0
    for (const run of runs) {
      const length = clean(run.text).trim().length
      if (length === 0) continue
      if (run.tone !== 'txt' && length > bestLength) {
        chosen = run.tone
        bestLength = length
      }
    }

    out.push({ text: lineText, tone: chosen })
  }

  return out
}

function applySgr(params: string, current: Tone): Tone {
  const codes = params === '' ? [0] : params.split(';').map((p) => Number.parseInt(p, 10) || 0)
  let tone = current

  for (const code of codes) {
    switch (code) {
      case 0:
        tone = 'txt'
        break
      case 1:
        // Bold alone reads as emphasis; keep whatever colour is active.
        if (tone === 'txt') tone = 'txt'
        break
      case 2:
        tone = 'dim'
        break
      case 31:
      case 91:
        tone = 'err'
        break
      case 32:
      case 92:
        tone = 'acc'
        break
      case 33:
      case 93:
        tone = 'wrn'
        break
      case 34:
      case 94:
      case 36:
      case 96:
        tone = 'acc'
        break
      case 35:
      case 95:
        tone = 'acc'
        break
      case 30:
      case 90:
        tone = 'dd'
        break
      case 37:
      case 97:
      case 39:
        tone = 'txt'
        break
      default:
        break
    }
  }

  return tone
}

/** Strip every escape sequence, for parsers that want plain text. */
export function stripAnsi(text: string): string {
  const cleaned = text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(SGR, '')
    .replace(CSI_OTHER, '')
    .replace(OTHER_ESC, '')
  // Resolve carriage returns per line so the structured renderers parse the
  // text a user would actually see.
  return cleaned
    .split('\n')
    .map((line) => applyCarriageReturns(line).trimEnd())
    .join('\n')
}
