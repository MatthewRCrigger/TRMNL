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

describe('list renderer', () => {
  // Captured from a real macOS `ls -la`, including the trailing @ and + mode
  // flags that BSD ls emits for xattrs and ACLs.
  const LS = `total 1752
drwxr-x---+   73 matthewcrigger  staff    2336 Aug  1 04:18 .
drwxr-xr-x     5 root            admin     160 Jul  7 04:35 ..
-rw-r--r--@    1 matthewcrigger  staff   26628 Aug  1 02:55 .DS_Store
drwxr-xr-x@    9 matthewcrigger  staff     288 Aug  1 03:40 .cargo
-rwxr-xr-x     1 matthewcrigger  staff    1024 Jul 31 01:54 build.sh
lrwxr-xr-x     1 matthewcrigger  staff       7 Nov 12  2024 latest -> v24.9.0`

  it('parses a long listing into rows', () => {
    const result = detectStructured('ls -la', LS, 0)
    if (result?.kind !== 'list') throw new Error('expected list')

    // `.` and `..` are dropped: the pane header already says where we are.
    expect(result.entries.map((e) => e.name)).toEqual([
      '.DS_Store',
      '.cargo',
      'build.sh',
      'latest',
    ])
    expect(result.total).toBe('1752')
  })

  it('classifies entries by mode', () => {
    const result = detectStructured('ls -la', LS, 0)
    if (result?.kind !== 'list') throw new Error('expected list')
    const kinds = Object.fromEntries(result.entries.map((e) => [e.name, e.kind]))
    expect(kinds).toEqual({
      '.DS_Store': 'file',
      '.cargo': 'dir',
      'build.sh': 'exec',
      latest: 'link',
    })
  })

  it('resolves symlink targets', () => {
    const result = detectStructured('ls -la', LS, 0)
    if (result?.kind !== 'list') throw new Error('expected list')
    expect(result.entries.find((e) => e.name === 'latest')?.target).toBe('v24.9.0')
  })

  it('keeps filenames containing spaces intact', () => {
    // Splitting on whitespace would truncate this to "AdGuard".
    const withSpaces = `total 8
drwxr-xr-x@  3 root  wheel   96 Jun 13 01:50 AdGuard for Safari.app
drwxr-xr-x@  3 root  wheel   96 Jun 13 01:50 AdBlock.app`
    const result = detectStructured('ls -la /Applications', withSpaces, 0)
    if (result?.kind !== 'list') throw new Error('expected list')
    expect(result.entries[0]?.name).toBe('AdGuard for Safari.app')
  })

  it('marks dotfiles as hidden', () => {
    const result = detectStructured('ls -la', LS, 0)
    if (result?.kind !== 'list') throw new Error('expected list')
    expect(result.entries.find((e) => e.name === '.cargo')?.hidden).toBe(true)
    expect(result.entries.find((e) => e.name === 'build.sh')?.hidden).toBe(false)
  })

  it('formats sizes and leaves directories unsized', () => {
    const result = detectStructured('ls -la', LS, 0)
    if (result?.kind !== 'list') throw new Error('expected list')
    expect(result.entries.find((e) => e.name === '.DS_Store')?.size).toBe('26 kB')
    expect(result.entries.find((e) => e.name === '.cargo')?.size).toBe('—')
  })

  it('declines short format, which has no columns to parse', () => {
    expect(detectStructured('ls', 'file-a\nfile-b\nfile-c\n', 0)).toBeNull()
  })

  it('declines when the command is piped', () => {
    // The output is whatever the pipe produced, not a listing.
    expect(detectStructured('ls -la | grep cargo', LS, 0)).toBeNull()
  })

  it('does not fire on a failed listing', () => {
    expect(detectStructured('ls -la /nope', 'ls: /nope: No such file or directory', 1)).toBeNull()
  })

  it('declines a listing with too few rows to be a table', () => {
    const single = 'total 0\n-rw-r--r--  1 u  g  0 Jan  1 00:00 only.txt'
    expect(detectStructured('ls -la', single, 0)).toBeNull()
  })

  it('handles the older date format on archival files', () => {
    const old = `total 16
-rw-r--r--  1 u  g   7 Nov 12  2024 archive.txt
-rw-r--r--  1 u  g  42 Aug  1 04:18 recent.txt`
    const result = detectStructured('ls -la', old, 0)
    if (result?.kind !== 'list') throw new Error('expected list')
    expect(result.entries.map((e) => e.modified)).toEqual(['Nov 12 2024', 'Aug 1 04:18'])
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

const VITEST_PASS = `
 RUN  v3.2.7 /repo

 ✓ src/lib/color.test.ts (20 tests) 3ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  03:59:34
   Duration  284ms (transform 27ms, setup 0ms, collect 21ms, tests 3ms, environment 0ms, prepare 36ms)`

const VITEST_FAIL = `
 RUN  v3.2.7 /repo

 ❯ src/scratch.test.ts (2 tests | 1 failed) 4ms
   ✓ scratch > passes 1ms
   × scratch > fails on purpose 3ms
     → expected 1 to be 2 // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/scratch.test.ts > scratch > fails on purpose
AssertionError: expected 1 to be 2 // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Start at  03:59:55
   Duration  268ms (transform 19ms, setup 0ms, collect 13ms, tests 4ms, environment 0ms, prepare 34ms)`

const JEST_FAIL = `FAIL  src/example.test.js
  Suite name
    ✓ passes (2 ms)
    ✕ fails on purpose (3 ms)

  ● Suite name › fails on purpose

    expect(received).toBe(expected)

Tests:       1 failed, 1 passed, 2 total
Snapshots:   0 total
Time:        0.412 s`

const CARGO_TEST_PASS = `running 13 tests
test proctree::tests::keeps_a_real_tool_name ... ok
test detect::tests::reads_makefile_target ... ok

test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s`

const CARGO_TEST_FAIL = `running 3 tests
test detect::tests::reads_makefile_target ... ok
test proctree::tests::keeps_a_real_tool_name ... FAILED
test proctree::tests::skips_runner_vocabulary_and_flags ... ok

failures:

---- proctree::tests::keeps_a_real_tool_name stdout ----
assertion failed

test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s`

describe('test renderer', () => {
  it('parses a passing vitest run', () => {
    const result = detectStructured('npm test', VITEST_PASS, 0)
    if (result?.kind !== 'test') throw new Error('expected test')
    expect(result.passed).toBe(20)
    expect(result.failed).toBe(0)
    expect(result.duration).toBe('284ms')
    expect(result.failures).toEqual([])
  })

  it('parses a failing vitest run with the failed test name', () => {
    const result = detectStructured('vitest run', VITEST_FAIL, 1)
    if (result?.kind !== 'test') throw new Error('expected test')
    expect(result.passed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([{ name: 'fails on purpose', suite: 'scratch' }])
  })

  it('parses a failing jest run with the failed test name', () => {
    const result = detectStructured('npx jest', JEST_FAIL, 1)
    if (result?.kind !== 'test') throw new Error('expected test')
    expect(result.passed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.duration).toBe('0.412')
    expect(result.failures).toEqual([{ name: 'fails on purpose', suite: 'Suite name' }])
  })

  it('parses a passing cargo test run', () => {
    const result = detectStructured('cargo test --lib', CARGO_TEST_PASS, 0)
    if (result?.kind !== 'test') throw new Error('expected test')
    expect(result.passed).toBe(13)
    expect(result.failed).toBe(0)
    expect(result.duration).toBe('0.04s')
  })

  it('parses a failing cargo test run with the failed test path', () => {
    const result = detectStructured('cargo test', CARGO_TEST_FAIL, 101)
    if (result?.kind !== 'test') throw new Error('expected test')
    expect(result.passed).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([
      { name: 'keeps_a_real_tool_name', suite: 'proctree::tests' },
    ])
  })

  it('falls back to text for unrelated commands', () => {
    expect(detectStructured('npm run test:e2e -- --help', 'usage: ...', 0)).toBeNull()
  })

  it('does not fire on output with no recognizable summary line', () => {
    expect(detectStructured('npm test', 'some unrelated log output\nmore lines\n', 0)).toBeNull()
  })

  it('respects the Behavior opt-out', () => {
    setRendererEnabled({ test: false })
    expect(detectStructured('npm test', VITEST_PASS, 0)).toBeNull()
    setRendererEnabled({ test: true })
    expect(detectStructured('npm test', VITEST_PASS, 0)?.kind).toBe('test')
  })
})
