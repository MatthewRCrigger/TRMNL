/** Save-as-New-Profile opens an existing match instead of minting a duplicate,
 *  so the matcher is what keeps the profile list from filling with rows that are
 *  indistinguishable at a glance. */

import { describe, expect, it } from 'vitest'

import { matchingProfile } from './ContextMenu'
import type { Profile, Session } from '../state/store'

const HOME = '/Users/me'

const profile = (over: Partial<Profile> = {}): Profile => ({
  id: 'p1',
  name: 'acme',
  cwd: '/Users/me/clients/acme',
  shell: '/bin/zsh',
  connectVia: 'local',
  startupCmd: '',
  env: [],
  ...over,
})

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  name: 'acme',
  host: 'local',
  cwd: '/Users/me/clients/acme',
  branch: '',
  shell: '/bin/zsh',
  cols: 80,
  rows: 24,
  blocks: [],
  input: '',
  ghost: '',
  history: [],
  historyIndex: null,
  takeover: false,
  tools: [],
  ...over,
})

describe('matchingProfile', () => {
  it('finds a profile that already describes the session', () => {
    const p = profile()
    expect(matchingProfile([p], session(), undefined, HOME)?.id).toBe('p1')
  })

  it('treats ~ and the expanded home as the same directory', () => {
    // The two forms reach the store from different places — a profile is often
    // typed with ~, while the shell reports an absolute path.
    const p = profile({ cwd: '~/clients/acme' })
    expect(matchingProfile([p], session(), undefined, HOME)?.id).toBe('p1')
  })

  it('ignores a trailing slash', () => {
    const p = profile({ cwd: '/Users/me/clients/acme/' })
    expect(matchingProfile([p], session(), undefined, HOME)?.id).toBe('p1')
  })

  it('does not match a different directory', () => {
    // The whole point of saving a new profile: this is genuinely somewhere else.
    const p = profile({ cwd: '/Users/me/clients/other' })
    expect(matchingProfile([p], session(), undefined, HOME)).toBeUndefined()
  })

  it('does not match a different shell', () => {
    const p = profile({ shell: '/bin/bash' })
    expect(matchingProfile([p], session(), undefined, HOME)).toBeUndefined()
  })

  it('does not match a remote profile against a local session', () => {
    const p = profile({ connectVia: 'me@box' })
    expect(matchingProfile([p], session(), undefined, HOME)).toBeUndefined()
  })

  it('does not match a profile that runs a startup command', () => {
    // The session cannot report whether it ran, so a profile carrying one is
    // never assumed to describe a session already in flight.
    const p = profile({ startupCmd: 'nvm use' })
    expect(matchingProfile([p], session(), undefined, HOME)).toBeUndefined()
  })

  it('prefers the session’s own profile over another row on the same directory', () => {
    // Both describe this session; resolving to the one that launched it is what
    // keeps Save-as from redirecting you to a stranger's profile.
    const own = profile({ id: 'p-own', name: 'mine' })
    const other = profile({ id: 'p-other', name: 'theirs' })
    expect(matchingProfile([other, own], session(), own, HOME)?.id).toBe('p-own')
  })

  it('ignores name and env when comparing', () => {
    // These are how two profiles over one directory differ on purpose; matching
    // on them would call every renamed profile a new one.
    const p = profile({
      name: 'renamed',
      env: [{ key: 'FOO', value: '1' }],
    })
    expect(matchingProfile([p], session(), undefined, HOME)?.id).toBe('p1')
  })

  it('matches a session that wandered to another profile’s directory', () => {
    // A few `cd`s later the session is somewhere a different profile describes,
    // and that profile is the one to open rather than a copy of it.
    const acme = profile({ id: 'p-acme', cwd: '/Users/me/clients/acme' })
    const bogg = profile({ id: 'p-bogg', cwd: '/Users/me/clients/bogg' })
    const wandered = session({ cwd: '/Users/me/clients/bogg' })
    expect(matchingProfile([acme, bogg], wandered, acme, HOME)?.id).toBe('p-bogg')
  })
})
