import { describe, expect, it } from 'vitest'

import { blockBadge, blockPanel, blockToMarkdown, type Block } from './types'

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    seq: 1,
    cmd: 'echo hi',
    cwd: '~',
    ts: '12:00:00',
    t0: 0,
    running: false,
    live: false,
    lines: [],
    structured: null,
    ...overrides,
  }
}

describe('blockToMarkdown', () => {
  it('fences the command and output with a success status', () => {
    const block = makeBlock({
      cmd: 'echo hi',
      lines: [{ text: 'hi', tone: 'txt' }],
      code: 0,
      ms: 42,
    })
    expect(blockToMarkdown(block)).toBe(['```console', '$ echo hi', 'hi', '```', '✓ · 42ms'].join('\n'))
  })

  it('omits the output section entirely for a command with no output', () => {
    const block = makeBlock({ cmd: 'true', code: 0, ms: 5 })
    expect(blockToMarkdown(block)).toBe(['```console', '$ true', '```', '✓ · 5ms'].join('\n'))
  })

  it('reports the exit code on a non-zero exit', () => {
    const block = makeBlock({
      cmd: 'false',
      lines: [{ text: 'boom', tone: 'err' }],
      code: 1,
      ms: 3,
    })
    expect(blockToMarkdown(block)).toBe(
      ['```console', '$ false', 'boom', '```', '✗ exit 1 · 3ms'].join('\n'),
    )
  })

  it('labels a cancelled block instead of an exit code', () => {
    const block = makeBlock({ cmd: 'sleep 100', code: 130, ms: 900 })
    expect(blockToMarkdown(block)).toBe(['```console', '$ sleep 100', '```', 'cancelled · 900ms'].join('\n'))
  })

  it('drops the duration segment when the block never recorded one', () => {
    const block = makeBlock({ cmd: 'echo hi', code: 0 })
    expect(blockToMarkdown(block)).toBe(['```console', '$ echo hi', '```', '✓'].join('\n'))
  })
})

/* The core mapping of the GRID rebuild: a block's state IS its panel's border
 * and header fill, not a chip bolted onto a header. */

describe('blockPanel', () => {
  const opts = { isLatest: false, rawDumpThreshold: 10_000 }

  it('leaves a settled success unset so it falls back to the theme', () => {
    // Null is "no override", which is what keeps a settled block theme-aware.
    // An explicitly neutral colour would look identical today and stop
    // following the tokens the moment they changed.
    const panel = blockPanel(makeBlock({ code: 0 }), opts)
    expect(panel.panelColor).toBeNull()
    expect(panel.headerFilled).toBe(false)
  })

  it('brightens the latest block and fills its header', () => {
    const panel = blockPanel(makeBlock({ code: 0 }), { ...opts, isLatest: true })
    expect(panel.panelColor).toBe('var(--line-100)')
    expect(panel.headerFilled).toBe(true)
  })

  it('takes red and a filled header on a non-zero exit', () => {
    const panel = blockPanel(makeBlock({ code: 1 }), opts)
    expect(panel.panelColor).toBe('var(--signal-red)')
    expect(panel.headerFilled).toBe(true)
  })

  it('takes cyan while running, without filling the header', () => {
    // Fill is reserved for the block you are *reading*. A running block is
    // announcing itself with its border; filling it too would put a third
    // filled header on screen the moment anything failed.
    const panel = blockPanel(makeBlock({ running: true }), opts)
    expect(panel.panelColor).toBe('var(--signal-cyan)')
    expect(panel.headerFilled).toBe(false)
  })

  it('lets a failure outrank being the latest block', () => {
    // Both want a filled header and only one can name the colour; the failure
    // is the more consequential fact.
    const panel = blockPanel(makeBlock({ code: 1 }), { ...opts, isLatest: true })
    expect(panel.panelColor).toBe('var(--signal-red)')
  })

  it('treats a cancelled block as a failure, not a success', () => {
    // 130 is SIGINT. The command did not finish, whatever the user intended.
    const panel = blockPanel(makeBlock({ code: 130 }), opts)
    expect(panel.panelColor).toBe('var(--signal-red)')
  })

  it('drops the frame entirely for a raw scrollback dump', () => {
    // At ten thousand lines a frame per block stops being an addressable unit
    // and becomes noise.
    const lines = Array.from({ length: 40 }, () => ({ text: 'x', tone: 'txt' as const }))
    expect(blockPanel(makeBlock({ lines }), { ...opts, rawDumpThreshold: 20 }).showPanel).toBe(false)
    expect(blockPanel(makeBlock({ lines }), { ...opts, rawDumpThreshold: 80 }).showPanel).toBe(true)
  })

  it('keeps the frame on structured output however long it is', () => {
    // Parsed output is the opposite of an unframed scrollback spill: it has
    // already been turned into a table.
    const lines = Array.from({ length: 400 }, () => ({ text: 'x', tone: 'txt' as const }))
    const block = makeBlock({ lines, structured: { kind: 'list', entries: [] } })
    expect(blockPanel(block, { ...opts, rawDumpThreshold: 20 }).showPanel).toBe(true)
  })
})

describe('blockBadge', () => {
  it('names the latest settled block rather than repeating its exit code', () => {
    // Two filled headers can share a viewport; the badge is what says which one
    // you are looking at.
    expect(blockBadge(makeBlock({ code: 0 }), true).label).toBe('LATEST')
  })

  it('reports a green exit 0 with a dot on an older block', () => {
    const badge = blockBadge(makeBlock({ code: 0 }), false)
    expect(badge).toEqual({ label: 'EXIT 0', tone: 'success', dot: true })
  })

  it('reports the real code in danger on a failure', () => {
    expect(blockBadge(makeBlock({ code: 127 }), false)).toEqual({
      label: 'EXIT 127',
      tone: 'danger',
      dot: false,
    })
  })

  it('distinguishes a long-running process from a plain one', () => {
    expect(blockBadge(makeBlock({ running: true, live: true }), true).label).toBe('LIVE')
    expect(blockBadge(makeBlock({ running: true }), true).label).toBe('RUNNING')
  })
})
