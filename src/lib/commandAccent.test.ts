import { describe, expect, it } from 'vitest'

import {
  DEFAULT_COMMAND_ACCENTS,
  accentFor,
  commandWord,
  isValidColor,
  type CommandAccent,
} from './commandAccent'

const RULES: CommandAccent[] = [
  { id: '1', match: 'shopify', color: 'oklch(0.75 0.18 152)', label: 'Shopify', enabled: true },
  { id: '2', match: 'claude', color: 'oklch(0.72 0.17 55)', label: 'Claude', enabled: true },
  { id: '3', match: 'off', color: 'oklch(0.5 0.1 200)', label: 'Disabled', enabled: false },
]

describe('commandWord', () => {
  it('takes the first word', () => {
    expect(commandWord('shopify app dev')).toBe('shopify')
  })

  it('strips a directory prefix', () => {
    expect(commandWord('/opt/homebrew/bin/shopify app dev')).toBe('shopify')
  })

  it('strips leading environment assignments', () => {
    expect(commandWord('NODE_ENV=production shopify app dev')).toBe('shopify')
    expect(commandWord('A=1 B=2 claude')).toBe('claude')
  })

  it('handles quoted assignment values', () => {
    expect(commandWord('MSG="hello world" claude')).toBe('claude')
  })

  it('steps past wrappers to the real program', () => {
    expect(commandWord('sudo docker ps')).toBe('docker')
    expect(commandWord('time claude')).toBe('claude')
    expect(commandWord('env docker compose up')).toBe('docker')
  })

  it('resolves npx to the wrapped binary', () => {
    expect(commandWord('npx shopify app dev')).toBe('shopify')
  })

  it('lowercases for case-insensitive matching', () => {
    expect(commandWord('SHOPIFY app dev')).toBe('shopify')
  })

  it('returns null for nothing matchable', () => {
    expect(commandWord('')).toBeNull()
    expect(commandWord('   ')).toBeNull()
  })
})

describe('accentFor', () => {
  it('matches a command word', () => {
    expect(accentFor('shopify app dev', RULES)).toBe('oklch(0.75 0.18 152)')
  })

  it('does not match a longer command that merely starts the same', () => {
    // The bug that motivates word matching over substring matching.
    expect(accentFor('claude-helper --version', RULES)).toBeNull()
    expect(accentFor('shopifyctl status', RULES)).toBeNull()
  })

  it('does not match when the word appears as an argument', () => {
    expect(accentFor('echo shopify', RULES)).toBeNull()
    expect(accentFor('which claude', RULES)).toBeNull()
  })

  it('ignores disabled rules', () => {
    expect(accentFor('off', RULES)).toBeNull()
  })

  it('returns null with no rules', () => {
    expect(accentFor('shopify app dev', [])).toBeNull()
  })

  it('lets the first matching rule win', () => {
    const dupes: CommandAccent[] = [
      { id: 'a', match: 'git', color: 'red', label: 'A', enabled: true },
      { id: 'b', match: 'git', color: 'blue', label: 'B', enabled: true },
    ]
    expect(accentFor('git status', dupes)).toBe('red')
  })

  it('matches the shipped defaults for their intended tools', () => {
    expect(accentFor('shopify app dev', DEFAULT_COMMAND_ACCENTS)).toBeTruthy()
    expect(accentFor('claude', DEFAULT_COMMAND_ACCENTS)).toBeTruthy()
    expect(accentFor('docker compose up', DEFAULT_COMMAND_ACCENTS)).toBeTruthy()
    expect(accentFor('ls -la', DEFAULT_COMMAND_ACCENTS)).toBeNull()
  })
})

describe('block accent persistence', () => {
  // The store stamps `accent` onto a block when its command matches, and never
  // recomputes it — so the header keeps the tool's colour after the global accent
  // reverts, and editing the rules later cannot retroactively repaint history.
  it('resolves the same colour the global override would use', () => {
    expect(accentFor('shopify app dev', RULES)).toBe(accentFor('shopify theme push', RULES))
  })

  it('leaves unmatched commands without an accent to stamp', () => {
    expect(accentFor('ls -la', RULES)).toBeNull()
  })
})

describe('accentFor: chained commands', () => {
  const SHOPIFY = 'oklch(0.75 0.18 152)'
  const CLAUDE = 'oklch(0.72 0.17 55)'

  // Captured from a real `bun run start` in a Shopify theme project: the typed
  // command names no tool, and `shopify` sits four levels down the process tree
  // beside a concurrent webpack build. This is the case the feature exists for.
  const LIVE_TREE = [
    'start',
    'shopify:dev',
    'webpack:watch',
    'shopify',
    'theme',
    'dev',
    'development',
    '.browserslistrc',
    'webpack',
    'webpack.dev.js',
  ]

  it('finds a tool the typed command never mentions', () => {
    // Without the tree there is nothing in `bun run start` to match on.
    expect(accentFor('bun run start', RULES)).toBeNull()
    expect(accentFor('bun run start', RULES, LIVE_TREE)).toBe(SHOPIFY)
  })

  it('resolves by rule order, not by position in the tree', () => {
    // `shopify:dev` and `webpack:watch` both precede `shopify` in the tree, and a
    // run-p starts its children concurrently — so tree order is a startup race.
    // Rule order is configured, which is what makes the result deterministic.
    const WEBPACK = 'oklch(0.7 0.15 250)'
    const webpackFirst: CommandAccent[] = [
      { id: 'w', match: 'webpack', color: WEBPACK, label: 'Webpack', enabled: true },
      ...RULES,
    ]
    expect(accentFor('bun run start', webpackFirst, LIVE_TREE)).toBe(WEBPACK)
    expect(accentFor('bun run start', RULES, LIVE_TREE)).toBe(SHOPIFY)
  })

  it('prefers the typed command over anything in its subtree', () => {
    // An explicit `claude …` must not be repainted by a tool it happens to spawn.
    expect(accentFor('claude --help', RULES, ['shopify'])).toBe(CLAUDE)
  })

  it('ignores disabled rules in the tree', () => {
    expect(accentFor('bun run start', RULES, ['off'])).toBeNull()
  })

  it('matches whole words only', () => {
    // A tree containing `shopify-helper` is not a Shopify run.
    expect(accentFor('bun run start', RULES, ['shopify-helper'])).toBeNull()
  })

  it('is unaffected by case and padding from the scan', () => {
    expect(accentFor('bun run start', RULES, ['  Shopify  '])).toBe(SHOPIFY)
  })

  it('returns null when the tree holds nothing recognisable', () => {
    expect(accentFor('bun run start', RULES, ['start', 'webpack', 'esbuild'])).toBeNull()
  })

  it('behaves as before when no tree is supplied', () => {
    // The typed-command path must be untouched for callers that pass no tree.
    expect(accentFor('shopify theme dev', RULES)).toBe(SHOPIFY)
    expect(accentFor('ls -la', RULES, [])).toBeNull()
  })
})

describe('isValidColor', () => {
  it('accepts oklch', () => {
    expect(isValidColor('oklch(0.75 0.18 152)')).toBe(true)
  })

  it('rejects empty and malformed values', () => {
    // A bad value would silently break every color-mix-derived token.
    expect(isValidColor('')).toBe(false)
    expect(isValidColor('   ')).toBe(false)
    expect(isValidColor('not-a-color-at-all')).toBe(false)
  })
})
