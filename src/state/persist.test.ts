/** Every window saves to one shared config file, so the merge is where one
 *  window can silently destroy another's state. */

import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, mergeConfig, type PersistedWorkspace } from './store'

const workspace = (cwd: string): PersistedWorkspace => ({
  split: false,
  splitDir: 'row',
  paneSize: 50,
  railOpen: true,
  panes: {
    a: { active: 0, sessions: [{ cwd, history: [] }] },
    b: { active: 0, sessions: [] },
  },
})

const parse = (json: string) => JSON.parse(json) as Record<string, unknown>

describe('mergeConfig', () => {
  it('writes this window’s workspace under its own key', () => {
    const out = parse(
      mergeConfig(null, {
        settings: DEFAULT_SETTINGS,
        profiles: [],
        workspace: workspace('/tmp/a'),
        key: 'workspace:win-2',
      }),
    )

    expect(out['workspace:win-2']).toBeDefined()
    expect(out.workspace).toBeUndefined()
  })

  it('leaves another window’s workspace untouched', () => {
    // The whole point. Window 2 saving must not erase window 1's layout — a
    // blind serialisation of window 2's own state would do exactly that.
    const existing = JSON.stringify({
      settings: DEFAULT_SETTINGS,
      profiles: [],
      workspace: workspace('/main'),
    })

    const out = parse(
      mergeConfig(existing, {
        settings: DEFAULT_SETTINGS,
        profiles: [],
        workspace: workspace('/second'),
        key: 'workspace:win-2',
      }),
    )

    expect(out.workspace).toEqual(workspace('/main'))
    expect(out['workspace:win-2']).toEqual(workspace('/second'))
  })

  it('preserves keys it does not recognise', () => {
    const existing = JSON.stringify({ somethingNewer: { keep: true } })

    const out = parse(
      mergeConfig(existing, {
        settings: DEFAULT_SETTINGS,
        profiles: [],
        workspace: undefined,
        key: 'workspace',
      }),
    )

    expect(out.somethingNewer).toEqual({ keep: true })
  })

  it('drops its own stale workspace when restore is off', () => {
    // Otherwise turning restore off would leave the layout on disk, to be
    // silently restored the next time it is turned back on.
    const existing = JSON.stringify({ workspace: workspace('/old') })

    const out = parse(
      mergeConfig(existing, {
        settings: DEFAULT_SETTINGS,
        profiles: [],
        workspace: undefined,
        key: 'workspace',
      }),
    )

    expect('workspace' in out).toBe(false)
  })

  it('does not drop another window’s workspace when restore is off here', () => {
    const existing = JSON.stringify({
      workspace: workspace('/main'),
      'workspace:win-2': workspace('/second'),
    })

    const out = parse(
      mergeConfig(existing, {
        settings: DEFAULT_SETTINGS,
        profiles: [],
        workspace: undefined,
        key: 'workspace:win-2',
      }),
    )

    expect(out.workspace).toEqual(workspace('/main'))
    expect('workspace:win-2' in out).toBe(false)
  })

  it('replaces a corrupt file rather than refusing to save', () => {
    const out = parse(
      mergeConfig('{ this is not json', {
        settings: DEFAULT_SETTINGS,
        profiles: [],
        workspace: workspace('/tmp'),
        key: 'workspace',
      }),
    )

    expect(out.settings).toBeDefined()
    expect(out.workspace).toBeDefined()
  })

  it('survives a file holding a JSON scalar or array', () => {
    // Parses cleanly but cannot carry keys, so it must not be used as the base.
    for (const raw of ['42', '"text"', '[1, 2, 3]', 'null']) {
      const out = parse(
        mergeConfig(raw, {
          settings: DEFAULT_SETTINGS,
          profiles: [],
          workspace: undefined,
          key: 'workspace',
        }),
      )
      expect(out.settings).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('rewrites shared settings and profiles', () => {
    const existing = JSON.stringify({ settings: { density: 'compact' }, profiles: [] })
    const profiles = [
      {
        id: 'p1',
        name: 'local',
        cwd: '~',
        shell: '/bin/zsh',
        connectVia: 'local',
        startupCmd: '',
        env: [],
      },
    ]

    const out = parse(
      mergeConfig(existing, {
        settings: DEFAULT_SETTINGS,
        profiles,
        workspace: undefined,
        key: 'workspace',
      }),
    )

    expect(out.settings).toEqual(DEFAULT_SETTINGS)
    expect(out.profiles).toEqual(profiles)
  })
})
