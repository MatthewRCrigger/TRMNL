/** The parser must produce identical block boundaries no matter how the PTY
 * splits the stream — chunks routinely land mid-escape-sequence. */

import { describe, expect, it } from 'vitest'

import { Osc133Parser, ansiToLines, stripAnsi, type Osc133Event } from './osc133'

const STREAM =
  '\x1b]7;file://host/Users/m\x07' +
  '\x1b]133;A\x07m@host ~ %\x1b]133;B\x07echo hi\r\n' +
  '\x1b]133;C\x07hi\r\n\x1b]133;D;0\x07' +
  '\x1b]133;A\x07m@host ~ %\x1b]133;B\x07false\r\n' +
  '\x1b]133;C\x07\x1b]133;D;1\x07'

const markers = (events: Osc133Event[]) =>
  events
    .filter((e) => e.type !== 'text')
    .map((e) => (e.type === 'command-end' ? `end:${e.code}` : e.type))

const text = (events: Osc133Event[]) =>
  events
    .filter((e): e is Extract<Osc133Event, { type: 'text' }> => e.type === 'text')
    .map((e) => e.text)
    .join('')

function feedInChunks(stream: string, size: (i: number) => number): Osc133Event[] {
  const parser = new Osc133Parser()
  const events: Osc133Event[] = []
  let i = 0
  while (i < stream.length) {
    const n = Math.max(1, size(i))
    events.push(...parser.feed(stream.slice(i, i + n)))
    i += n
  }
  return events
}

describe('Osc133Parser', () => {
  const whole = new Osc133Parser().feed(STREAM)

  it('extracts the full prompt/command/output/end cycle', () => {
    expect(markers(whole)).toEqual([
      'cwd',
      'prompt-start',
      'command-start',
      'output-start',
      'end:0',
      'prompt-start',
      'command-start',
      'output-start',
      'end:1',
    ])
  })

  it('reports the exit code from the D marker', () => {
    const ends = whole.filter((e) => e.type === 'command-end')
    expect(ends).toEqual([
      { type: 'command-end', code: 0 },
      { type: 'command-end', code: 1 },
    ])
  })

  it('is invariant to chunk boundaries, including one byte at a time', () => {
    const byByte = feedInChunks(STREAM, () => 1)
    expect(markers(byByte)).toEqual(markers(whole))
    expect(text(byByte)).toEqual(text(whole))
  })

  it('is invariant to uneven chunk sizes', () => {
    const uneven = feedInChunks(STREAM, (i) => 1 + ((i * 7) % 13))
    expect(markers(uneven)).toEqual(markers(whole))
    expect(text(uneven)).toEqual(text(whole))
  })

  it('reports cwd from OSC 7', () => {
    const cwd = whole.find((e) => e.type === 'cwd')
    expect(cwd).toEqual({ type: 'cwd', cwd: '/Users/m' })
  })

  it('passes unrecognised OSC sequences through as text', () => {
    // A window-title change is not ours to consume.
    const events = new Osc133Parser().feed('a\x1b]0;title\x07b')
    expect(markers(events)).toEqual([])
    expect(text(events)).toContain('title')
  })

  it('does not buffer an unterminated sequence forever', () => {
    const parser = new Osc133Parser()
    const events = parser.feed(`\x1b]133;${'x'.repeat(5000)}`)
    // Past the cap it is treated as text rather than held indefinitely.
    expect(text(events).length).toBeGreaterThan(4000)
  })

  it('keeps ordinary output intact', () => {
    const events = new Osc133Parser().feed('plain output\r\nsecond line\r\n')
    expect(markers(events)).toEqual([])
    expect(text(events)).toBe('plain output\r\nsecond line\r\n')
  })
})

describe('ansiToLines', () => {
  it('maps red to the error tone', () => {
    expect(ansiToLines('\x1b[31mERR\x1b[0m ok')).toEqual([{ text: 'ERR ok', tone: 'err' }])
  })

  it('maps bright red to the error tone', () => {
    expect(ansiToLines('\x1b[91mfail\x1b[0m')).toEqual([{ text: 'fail', tone: 'err' }])
  })

  it('maps yellow to the warn tone', () => {
    expect(ansiToLines('\x1b[33mwarn\x1b[0m')).toEqual([{ text: 'warn', tone: 'wrn' }])
  })

  it('maps green to the accent tone', () => {
    expect(ansiToLines('\x1b[32mpass\x1b[39m')).toEqual([{ text: 'pass', tone: 'acc' }])
  })

  it('leaves uncoloured text as txt', () => {
    expect(ansiToLines('just text')).toEqual([{ text: 'just text', tone: 'txt' }])
  })

  it('carries colour across a line break, as a real terminal does', () => {
    expect(ansiToLines('\x1b[31ma\nb\x1b[0m')).toEqual([
      { text: 'a', tone: 'err' },
      { text: 'b', tone: 'err' },
    ])
  })

  it('strips cursor-movement sequences from the visible text', () => {
    expect(ansiToLines('progress\x1b[2K\x1b[1G')).toEqual([{ text: 'progress', tone: 'txt' }])
  })

  it('resolves a carriage return as an overwrite, not a deletion', () => {
    // A progress bar redrawing in place should show only its final state.
    expect(ansiToLines('10%\r50%\r100%')).toEqual([{ text: '100%', tone: 'txt' }])
  })

  it('keeps the uncovered tail when the overwrite is shorter', () => {
    expect(ansiToLines('abcdef\rXY')).toEqual([{ text: 'XYcdef', tone: 'txt' }])
  })

  it("erases zsh's partial-line mark", () => {
    // zsh prints a reverse-video '%' padded to the line width, then erases it
    // with CR-space-CR. Without CR handling the '%' survives as visible text.
    const eolMark = '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m' + ' '.repeat(40) + '\r \r'
    expect(ansiToLines(`matthewcrigger\n${eolMark}`)).toEqual([
      { text: 'matthewcrigger', tone: 'txt' },
      { text: '', tone: 'txt' },
    ])
  })
})

describe('stripAnsi', () => {
  it('removes SGR, CSI and OSC sequences', () => {
    expect(stripAnsi('\x1b[1;32mgreen\x1b[0m\x1b[K done')).toBe('green done')
    expect(stripAnsi('\x1b]133;A\x07text')).toBe('text')
  })
})

describe('hook version announcement', () => {
  it('parses the private hooks sequence', () => {
    const p = new Osc133Parser()
    expect(p.feed('\x1b]1337;trmnl-hooks=1\x07')).toEqual([{ type: 'hooks', version: 1 }])
  })

  it('parses a multi-digit version', () => {
    const p = new Osc133Parser()
    expect(p.feed('\x1b]1337;trmnl-hooks=42\x07')).toEqual([{ type: 'hooks', version: 42 }])
  })

  it('passes other OSC 1337 sequences through as text', () => {
    // iTerm2 owns 1337 generally; only our own key is claimed.
    const p = new Osc133Parser()
    const events = p.feed('\x1b]1337;SetBadgeFormat=abc\x07')
    expect(events.every((e) => e.type === 'text')).toBe(true)
  })

  it('survives being split across chunks', () => {
    const p = new Osc133Parser()
    const events = [...p.feed('\x1b]1337;trmnl-'), ...p.feed('hooks=1\x07')]
    expect(events).toEqual([{ type: 'hooks', version: 1 }])
  })
})
