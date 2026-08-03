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
