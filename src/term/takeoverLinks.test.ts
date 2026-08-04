/** ContextMenu.tsx has no reference to any TerminalView instance, so it reads
 *  this registry by session id instead — these tests are about the registry's
 *  own bookkeeping, not xterm.js. */

import { describe, expect, it } from 'vitest'

import { getTakeoverLinkState, registerTakeoverLinks } from './takeoverLinks'

describe('takeoverLinks registry', () => {
  it('is undefined for a session that never registered', () => {
    expect(getTakeoverLinkState('never-seen')).toBeUndefined()
  })

  it('returns what was registered', () => {
    const state = { hoveredUrl: 'https://example.com', getSelection: () => 'hi' }
    const unregister = registerTakeoverLinks('s1', state)
    expect(getTakeoverLinkState('s1')).toBe(state)
    unregister()
  })

  it('clears the entry on unregister', () => {
    const state = { hoveredUrl: null, getSelection: () => '' }
    const unregister = registerTakeoverLinks('s2', state)
    unregister()
    expect(getTakeoverLinkState('s2')).toBeUndefined()
  })

  it('a stale unregister does not clobber a newer registration', () => {
    // Mirrors a fast remount: the outgoing instance's cleanup must not delete
    // the incoming instance's entry just because they share a session id.
    const first = { hoveredUrl: null, getSelection: () => 'first' }
    const unregisterFirst = registerTakeoverLinks('s3', first)

    const second = { hoveredUrl: null, getSelection: () => 'second' }
    registerTakeoverLinks('s3', second)

    unregisterFirst()

    expect(getTakeoverLinkState('s3')).toBe(second)
  })
})
