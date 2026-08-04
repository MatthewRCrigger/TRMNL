/** Every window saves to one shared config file, so the merge is where one
 *  window can silently destroy another's state. */

import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, mergeConfig, type PersistedWorkspace, type Profile } from './store'

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

/** Profiles are application-global: one window's save must not lose another's. */
describe('mergeConfig: profiles are global', () => {
  const prof = (id: string, over: Partial<Profile> = {}): Profile => ({
    id,
    name: id,
    cwd: '~',
    shell: '/bin/zsh',
    connectVia: 'local',
    startupCmd: '',
    env: [],
    ...over,
  })

  const profilesIn = (json: string) => (parse(json).profiles as Profile[]).map((p) => p.id)

  it('keeps a profile another window added while this one was open', () => {
    // The bug this exists for: window B holds a list from before A's change and
    // used to assign it wholesale, deleting `acme` on any later save of its own.
    const onDisk = JSON.stringify({ settings: DEFAULT_SETTINGS, profiles: [prof('p-acme')] })

    const out = mergeConfig(onDisk, {
      settings: DEFAULT_SETTINGS,
      profiles: [], // B never heard about acme
      workspace: undefined,
      key: 'workspace:win-2',
    })

    expect(profilesIn(out)).toEqual(['p-acme'])
  })

  it('still lets this window win for a profile it edited', () => {
    const onDisk = JSON.stringify({
      settings: DEFAULT_SETTINGS,
      profiles: [prof('p1', { name: 'old' })],
    })

    const out = mergeConfig(onDisk, {
      settings: DEFAULT_SETTINGS,
      profiles: [prof('p1', { name: 'renamed' })],
      workspace: undefined,
      key: 'workspace',
    })

    expect((parse(out).profiles as Profile[])[0]!.name).toBe('renamed')
  })

  it('honours a deliberate delete rather than unioning it back', () => {
    // Absence alone cannot express deletion once the lists are unioned — an id
    // this window removed looks identical to one it never learned about.
    const onDisk = JSON.stringify({
      settings: DEFAULT_SETTINGS,
      profiles: [prof('p-keep'), prof('p-gone')],
    })

    const out = mergeConfig(onDisk, {
      settings: DEFAULT_SETTINGS,
      profiles: [prof('p-keep')],
      deletedProfiles: ['p-gone'],
      workspace: undefined,
      key: 'workspace',
    })

    expect(profilesIn(out)).toEqual(['p-keep'])
  })

  it('leaves exactly one default when two windows disagree', () => {
    // Both windows believe theirs is the default; the saving one just acted, so
    // it wins. Two defaults on disk would make launch pick whichever came first.
    const onDisk = JSON.stringify({
      settings: DEFAULT_SETTINGS,
      profiles: [prof('p-a', { isDefault: true })],
    })

    const out = mergeConfig(onDisk, {
      settings: DEFAULT_SETTINGS,
      profiles: [prof('p-b', { isDefault: true })],
      workspace: undefined,
      key: 'workspace',
    })

    const saved = parse(out).profiles as Profile[]
    expect(saved.filter((p) => p.isDefault).map((p) => p.id)).toEqual(['p-b'])
  })

  it('survives a profiles key that is not an array', () => {
    // Hand-edited config; the union must not throw on it.
    const onDisk = JSON.stringify({ settings: DEFAULT_SETTINGS, profiles: 'nonsense' })

    const out = mergeConfig(onDisk, {
      settings: DEFAULT_SETTINGS,
      profiles: [prof('p1')],
      workspace: undefined,
      key: 'workspace',
    })

    expect(profilesIn(out)).toEqual(['p1'])
  })
})
