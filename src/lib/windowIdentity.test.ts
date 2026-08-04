import { describe, expect, it } from 'vitest'

import {
  MAIN_WINDOW,
  createSessionIds,
  isMainWindow,
  ownerOf,
  workspaceKey,
} from './windowIdentity'

describe('isMainWindow', () => {
  it('recognises the launch window', () => {
    expect(isMainWindow(MAIN_WINDOW)).toBe(true)
  })

  it('rejects a spawned window', () => {
    expect(isMainWindow('win-2')).toBe(false)
  })
})

describe('workspaceKey', () => {
  // An existing config was written before windows had labels, so the main
  // window has to keep reading the bare key or every upgrade opens empty.
  it('keeps the legacy key for the main window', () => {
    expect(workspaceKey(MAIN_WINDOW)).toBe('workspace')
  })

  it('suffixes additional windows so they cannot race', () => {
    expect(workspaceKey('win-2')).toBe('workspace:win-2')
    expect(workspaceKey('win-3')).toBe('workspace:win-3')
  })
})

describe('createSessionIds', () => {
  it('counts up within a window', () => {
    const next = createSessionIds('main')
    expect(next()).toBe('main:s0001')
    expect(next()).toBe('main:s0002')
  })

  it('never collides across windows', () => {
    // The whole point: the PtyManager is one process-wide map, and pty_spawn
    // rejects a duplicate id. Two windows counting independently must not meet.
    const a = createSessionIds('main')
    const b = createSessionIds('win-2')
    const ids = new Set([a(), a(), b(), b()])
    expect(ids.size).toBe(4)
  })

  it('sorts lexically in creation order', () => {
    // pty_adopt sorts ids as strings to restore creation order, so `s10` has to
    // sort after `s9` — which unpadded ids would get wrong.
    const next = createSessionIds('main')
    const ids = Array.from({ length: 12 }, next)
    expect([...ids].sort()).toEqual(ids)
  })
})

describe('ownerOf', () => {
  it('extracts the owning window', () => {
    expect(ownerOf('main:s0001')).toBe('main')
    expect(ownerOf('win-2:s0042')).toBe('win-2')
  })

  it('survives a label containing the separator', () => {
    expect(ownerOf('win:s:s0001')).toBe('win:s')
  })

  it('returns null for an id from before this scheme', () => {
    expect(ownerOf('s1-a1b2c3')).toBeNull()
  })
})
