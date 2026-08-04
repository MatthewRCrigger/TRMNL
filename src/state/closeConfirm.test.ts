/** Closing a session or pane is only interrupted when a shell inside it is
 *  still running a command — an idle or already-exited shell closes at once.
 *  See the CLAUDE.md discussion this implements and `closeConfirm` in store.ts. */

import { beforeEach, describe, expect, it } from 'vitest'

import { useStore, type Session } from './store'

// This suite runs in plain Node (no jsdom in this project's vitest setup), but
// a real close reaches `persist()`, which debounces through `window.setTimeout`.
// Standing in for just that one call is less invasive than switching the test
// environment for the whole file.
;(globalThis as { window?: { setTimeout: typeof setTimeout } }).window ??= { setTimeout }

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 's1',
    name: 'shell',
    host: 'local',
    cwd: '~',
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
    ...overrides,
  }
}

beforeEach(() => {
  useStore.setState({
    closeConfirm: null,
    split: false,
    focus: 'a',
    sessions: {},
    panes: { a: { sessions: [], active: 0 }, b: { sessions: [], active: 0 } },
  })
})

describe('closeSession', () => {
  // A second session sits in the pane throughout so closing s1 never empties
  // it — closing the *last* session in pane A falls through to spawning a
  // replacement or closing the window, real Tauri calls this suite is not
  // set up to make. That branch is exercised by store.ts's own callers, not
  // the confirmation gate this file is about.
  it('closes immediately when the shell is idle', async () => {
    useStore.setState({
      sessions: { s1: makeSession(), s2: makeSession({ id: 's2' }) },
      panes: { a: { sessions: ['s1', 's2'], active: 0 }, b: { sessions: [], active: 0 } },
    })

    await useStore.getState().closeSession('s1')

    expect(useStore.getState().sessions.s1).toBeUndefined()
    expect(useStore.getState().closeConfirm).toBeNull()
  })

  it('closes immediately when the shell has already exited', async () => {
    useStore.setState({
      sessions: {
        s1: makeSession({
          exited: { code: 0 },
          blocks: [
            {
              id: 'b1',
              seq: 1,
              cmd: 'sleep 100',
              cwd: '~',
              ts: '00:00:00',
              t0: 0,
              running: false,
              live: false,
              code: 130,
              lines: [],
              structured: null,
            },
          ],
        }),
        s2: makeSession({ id: 's2' }),
      },
      panes: { a: { sessions: ['s1', 's2'], active: 0 }, b: { sessions: [], active: 0 } },
    })

    await useStore.getState().closeSession('s1')

    expect(useStore.getState().sessions.s1).toBeUndefined()
  })

  it('asks for confirmation instead of closing when a command is still running', async () => {
    useStore.setState({
      sessions: {
        s1: makeSession({
          blocks: [
            {
              id: 'b1',
              seq: 1,
              cmd: 'npm run dev',
              cwd: '~',
              ts: '00:00:00',
              t0: 0,
              running: true,
              live: true,
              lines: [],
              structured: null,
            },
          ],
        }),
      },
      panes: { a: { sessions: ['s1'], active: 0 }, b: { sessions: [], active: 0 } },
    })

    await useStore.getState().closeSession('s1')

    // Nothing closed yet — the session and its pane entry are untouched.
    expect(useStore.getState().sessions.s1).toBeDefined()
    expect(useStore.getState().panes.a.sessions).toEqual(['s1'])
    expect(useStore.getState().closeConfirm).toEqual({ kind: 'session', id: 's1' })
  })

  it('cancelClose backs out without touching the session', async () => {
    useStore.setState({
      sessions: {
        s1: makeSession({
          blocks: [
            {
              id: 'b1',
              seq: 1,
              cmd: 'npm run dev',
              cwd: '~',
              ts: '00:00:00',
              t0: 0,
              running: true,
              live: true,
              lines: [],
              structured: null,
            },
          ],
        }),
      },
      panes: { a: { sessions: ['s1'], active: 0 }, b: { sessions: [], active: 0 } },
    })

    await useStore.getState().closeSession('s1')
    useStore.getState().cancelClose()

    expect(useStore.getState().closeConfirm).toBeNull()
    expect(useStore.getState().sessions.s1).toBeDefined()
  })

  it('confirmClose performs the close the user just confirmed', async () => {
    useStore.setState({
      sessions: {
        s1: makeSession({
          blocks: [
            {
              id: 'b1',
              seq: 1,
              cmd: 'npm run dev',
              cwd: '~',
              ts: '00:00:00',
              t0: 0,
              running: true,
              live: true,
              lines: [],
              structured: null,
            },
          ],
        }),
        s2: makeSession({ id: 's2' }),
      },
      panes: { a: { sessions: ['s1', 's2'], active: 0 }, b: { sessions: [], active: 0 } },
    })

    await useStore.getState().closeSession('s1')
    await useStore.getState().confirmClose()

    expect(useStore.getState().sessions.s1).toBeUndefined()
    expect(useStore.getState().closeConfirm).toBeNull()
  })
})

describe('closePane', () => {
  it('closes pane B immediately when nothing in it is running', () => {
    useStore.setState({
      split: true,
      sessions: { b1: makeSession({ id: 'b1' }) },
      panes: { a: { sessions: [], active: 0 }, b: { sessions: ['b1'], active: 0 } },
    })

    useStore.getState().closePane()

    expect(useStore.getState().split).toBe(false)
    expect(useStore.getState().sessions.b1).toBeUndefined()
    expect(useStore.getState().closeConfirm).toBeNull()
  })

  it('asks for confirmation when pane B has a running command', () => {
    useStore.setState({
      split: true,
      sessions: {
        b1: makeSession({
          id: 'b1',
          blocks: [
            {
              id: 'blk1',
              seq: 1,
              cmd: 'npm run dev',
              cwd: '~',
              ts: '00:00:00',
              t0: 0,
              running: true,
              live: true,
              lines: [],
              structured: null,
            },
          ],
        }),
      },
      panes: { a: { sessions: [], active: 0 }, b: { sessions: ['b1'], active: 0 } },
    })

    useStore.getState().closePane()

    // Still split, pane B untouched — nothing closed until confirmed.
    expect(useStore.getState().split).toBe(true)
    expect(useStore.getState().sessions.b1).toBeDefined()
    expect(useStore.getState().closeConfirm).toEqual({ kind: 'pane' })
  })
})
