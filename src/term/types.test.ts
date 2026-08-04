import { describe, expect, it } from 'vitest'

import { blockToMarkdown, type Block } from './types'

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
