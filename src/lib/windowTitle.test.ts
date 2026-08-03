import { describe, expect, it } from 'vitest'

import { FALLBACK_TITLE, formatWindowTitle } from './windowTitle'

const HOME = '/Users/matthewcrigger'

describe('formatWindowTitle', () => {
  it('matches the shape Terminal.app uses', () => {
    expect(
      formatWindowTitle({ cwd: HOME, shell: '/bin/zsh', home: HOME, cols: 80, rows: 24 }),
    ).toBe('~ — -zsh — 80×24')
  })

  it('shows the directory basename, not the whole path', () => {
    // The Dock's window list is narrow; a full path truncates into uselessness.
    expect(
      formatWindowTitle({
        cwd: `${HOME}/crggr/TRMNL`,
        shell: '/bin/zsh',
        home: HOME,
        cols: 120,
        rows: 32,
      }),
    ).toBe('TRMNL — -zsh — 120×32')
  })

  it('lets a running command displace the shell name', () => {
    expect(
      formatWindowTitle({
        cwd: `${HOME}/crggr/TRMNL`,
        command: 'npm run build',
        shell: '/bin/zsh',
        home: HOME,
        cols: 80,
        rows: 24,
      }),
    ).toBe('TRMNL — npm — 80×24')
  })

  it('drops a command’s arguments', () => {
    // `shopify app dev --reset --store=x` would push the dimensions off the end.
    expect(
      formatWindowTitle({ command: 'shopify app dev --reset', cols: 80, rows: 24 }),
    ).toBe('shopify — 80×24')
  })
})

describe('formatWindowTitle: home abbreviation', () => {
  it('writes home itself as ~ rather than the account name', () => {
    expect(formatWindowTitle({ cwd: HOME, home: HOME })).toBe('~')
  })

  it('is not confused by a trailing slash on either side', () => {
    expect(formatWindowTitle({ cwd: `${HOME}/`, home: HOME })).toBe('~')
    expect(formatWindowTitle({ cwd: HOME, home: `${HOME}/` })).toBe('~')
  })

  it('leaves a directory under home as its own basename', () => {
    // `~/crggr/TRMNL` is just a longer way of writing `TRMNL`.
    expect(formatWindowTitle({ cwd: `${HOME}/crggr/TRMNL`, home: HOME })).toBe('TRMNL')
  })

  it('does not abbreviate a sibling that merely shares the prefix', () => {
    expect(formatWindowTitle({ cwd: `${HOME}-backup`, home: HOME })).toBe(
      'matthewcrigger-backup',
    )
  })

  it('falls back to the basename when home is unknown', () => {
    expect(formatWindowTitle({ cwd: `${HOME}/crggr` })).toBe('crggr')
    expect(formatWindowTitle({ cwd: HOME })).toBe('matthewcrigger')
  })

  it('names the filesystem root, which has no basename', () => {
    expect(formatWindowTitle({ cwd: '/', home: HOME })).toBe('/')
  })
})

describe('formatWindowTitle: fallbacks', () => {
  it('uses the app name when there is no session at all', () => {
    expect(formatWindowTitle({})).toBe(FALLBACK_TITLE)
  })

  it('drops a missing part instead of printing an empty segment', () => {
    // A session exists before its first cwd report, and a pane has no measured
    // grid until it has been laid out once — an early title is short, not wrong.
    expect(formatWindowTitle({ shell: '/bin/zsh', cols: 80, rows: 24 })).toBe(
      '-zsh — 80×24',
    )
    expect(formatWindowTitle({ cwd: '/etc', shell: '/bin/zsh' })).toBe('etc — -zsh')
    expect(formatWindowTitle({ cwd: '/etc', cols: 80, rows: 24 })).toBe('etc — 80×24')
  })

  it('omits dimensions that have not been measured or are nonsensical', () => {
    expect(formatWindowTitle({ cwd: '/etc', cols: 80 })).toBe('etc')
    expect(formatWindowTitle({ cwd: '/etc', cols: 0, rows: 24 })).toBe('etc')
    expect(formatWindowTitle({ cwd: '/etc', cols: Number.NaN, rows: 24 })).toBe('etc')
  })

  it('ignores a blank command and falls through to the shell', () => {
    expect(formatWindowTitle({ cwd: '/etc', command: '   ', shell: '/bin/zsh' })).toBe(
      'etc — -zsh',
    )
  })

  it('does not double the login-shell hyphen', () => {
    // The shell path can itself be an argv[0] that already carries it.
    expect(formatWindowTitle({ shell: '-zsh' })).toBe('-zsh')
    expect(formatWindowTitle({ shell: '/bin/bash' })).toBe('-bash')
  })
})
