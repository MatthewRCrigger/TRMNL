/** The governing rule for these renderers is **parse, never fabricate**: when
 * output is ambiguous, unparseable or simply not what the renderer expects, the
 * block must fall back to plain text. A wrong table is much worse than no table,
 * so most of these tests assert on null. */

import { describe, expect, it } from 'vitest'

import { detectStructured, setKnownCommands, setRendererEnabled } from './renderers'

setKnownCommands(['shopify', 'git', 'npm', 'node', 'python3', 'ls', 'cargo'])

const CLEAN_STATUS = `On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean`

const DIRTY_STATUS = `On branch feat/hud
Your branch is ahead of 'origin/feat/hud' by 2 commits.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
\tmodified:   src/components/hud-rail.tsx
\tmodified:   src/lib/telemetry.ts

Untracked files:
  (use "git add <file>..." to include in what will be committed)
\tsrc/components/palette.tsx

no changes added to commit`

const NEXT_BUILD = `> build
> next build

   Next.js 16.0.1
   Compiled successfully in 6.4s
Route (app)                     Size  First Load JS
┌ ○ /                          4.1 kB        128 kB
├ ○ /components                9.8 kB        164 kB
└ ƒ /api/registry/[name]          0 B          0 B
+ First Load JS shared by all   108 kB`

describe('git renderer', () => {
  it('groups modified and untracked files', () => {
    const result = detectStructured('git status', DIRTY_STATUS, 0)
    expect(result?.kind).toBe('git')
    if (result?.kind !== 'git') throw new Error('expected git')

    expect(result.groups.map((g) => g.label)).toEqual(['MODIFIED', 'UNTRACKED'])
    expect(result.groups[0]?.files.map((f) => f.path)).toEqual([
      'src/components/hud-rail.tsx',
      'src/lib/telemetry.ts',
    ])
    // The reference captures show UNTRACKED in the error tone, MODIFIED in warn.
    expect(result.groups[0]?.tone).toBe('warn')
    expect(result.groups[1]?.tone).toBe('err')
    expect(result.branch).toBe('feat/hud')
  })

  it('falls back to text on a clean tree rather than drawing an empty group', () => {
    expect(detectStructured('git status', CLEAN_STATUS, 0)).toBeNull()
  })

  it('does not fire outside a repository', () => {
    expect(detectStructured('git status', 'fatal: not a git repository', 128)).toBeNull()
  })

  it('reads staged entries with their status markers', () => {
    const result = detectStructured(
      'git status',
      `On branch main

Changes to be committed:
\tnew file:   src/new.ts
\tdeleted:    src/old.ts
`,
      0,
    )
    if (result?.kind !== 'git') throw new Error('expected git')
    expect(result.groups[0]?.files.map((f) => f.marker)).toEqual(['A', 'D'])
  })

  it('declines short-format output instead of misreading it', () => {
    expect(detectStructured('git status -s', ' M src/a.ts\n?? src/b.ts\n', 0)).toBeNull()
  })
})

describe('build renderer', () => {
  it('parses the route table and flags over-budget first loads', () => {
    const result = detectStructured('npm run build', NEXT_BUILD, 0)
    if (result?.kind !== 'build') throw new Error('expected build')

    expect(result.routes.map((r) => r.path)).toEqual(['/', '/components', '/api/registry/[name]'])
    expect(result.routes[0]?.marker).toBe('static')
    expect(result.routes[2]?.marker).toBe('dynamic')
    // 128 kB is the budget, 164 kB exceeds it.
    expect(result.routes[0]?.overBudget).toBe(false)
    expect(result.routes[1]?.overBudget).toBe(true)
    expect(result.sharedChunks).toBe('108 kB')
  })

  it('falls back to text when the build printed no table', () => {
    expect(detectStructured('npm run build', 'tsc && vite build\nbuilt in 374ms', 0)).toBeNull()
  })

  it('does not fire on a failed build', () => {
    expect(detectStructured('npm run build', NEXT_BUILD, 1)).toBeNull()
  })

  it('survives garbage without throwing', () => {
    expect(detectStructured('npm run build', ' �<<<>>> ', 0)).toBeNull()
  })
})

describe('serve renderer', () => {
  it('extracts labelled dev-server links', () => {
    const result = detectStructured(
      'shopify app dev',
      `Preview URL: https://grid-ops.myshopify.dev
GraphiQL: http://localhost:3457/graphiql
Dev store: https://grid-ops.myshopify.com
  p  preview
  q  quit`,
      0,
    )
    if (result?.kind !== 'serve') throw new Error('expected serve')

    expect(result.links.map((l) => l.label)).toEqual(['PREVIEW URL', 'GRAPHIQL', 'DEV STORE'])
    expect(result.links[0]?.url).toBe('https://grid-ops.myshopify.dev')
    expect(result.hints.map((h) => h.key)).toContain('q')
  })

  it('falls back to a bare localhost URL', () => {
    const result = detectStructured('npm run dev', 'ready on http://localhost:5173/', 0)
    if (result?.kind !== 'serve') throw new Error('expected serve')
    expect(result.links[0]?.url).toBe('http://localhost:5173/')
  })

  it('returns null when no URL was printed', () => {
    expect(detectStructured('npm run dev', 'starting…', 0)).toBeNull()
  })
})

describe('error renderer', () => {
  it('suggests the nearest command on $PATH by edit distance', () => {
    const result = detectStructured('shopfy app dev', 'zsh: command not found: shopfy', 127)
    if (result?.kind !== 'err') throw new Error('expected err')
    // The whole line is rebuilt so the chip is directly runnable.
    expect(result.suggestion).toBe('shopify app dev')
    expect(result.detail).toContain('shopfy')
  })

  it('omits a suggestion when nothing is close enough', () => {
    const result = detectStructured('zzzzqqqq', 'zsh: command not found: zzzzqqqq', 127)
    if (result?.kind !== 'err') throw new Error('expected err')
    expect(result.suggestion).toBeUndefined()
  })

  it('only fires on exit 127', () => {
    expect(detectStructured('shopfy', 'command not found: shopfy', 1)).toBeNull()
  })
})

describe('renderer toggles', () => {
  it('respects the Behavior opt-out', () => {
    setRendererEnabled({ git: false })
    expect(detectStructured('git status', DIRTY_STATUS, 0)).toBeNull()
    setRendererEnabled({ git: true })
    expect(detectStructured('git status', DIRTY_STATUS, 0)?.kind).toBe('git')
  })
})
