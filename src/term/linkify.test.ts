/** A generic linkifier, not the `serve` renderer's command-specific one — this
 *  is what makes a bare URL clickable in *any* block's output, structured or
 *  not, including reference lists like the Shopify CLI's `[1] http://…`. */

import { describe, expect, it } from 'vitest'

import { hasLink, linkify } from './linkify'

describe('hasLink', () => {
  it('is false for plain text', () => {
    expect(hasLink('just some output, no links here')).toBe(false)
  })

  it('is true when a URL is present', () => {
    expect(hasLink('see http://127.0.0.1:9292 for the preview')).toBe(true)
  })
})

describe('linkify', () => {
  it('returns a single text token when there is nothing to link', () => {
    expect(linkify('hello world')).toEqual([{ kind: 'text', text: 'hello world' }])
  })

  it('splits a bare URL out as its own token', () => {
    expect(linkify('http://127.0.0.1:9292')).toEqual([
      { kind: 'link', text: 'http://127.0.0.1:9292', url: 'http://127.0.0.1:9292' },
    ])
  })

  it('keeps surrounding text as separate tokens', () => {
    expect(linkify('open http://localhost:3000 now')).toEqual([
      { kind: 'text', text: 'open ' },
      { kind: 'link', text: 'http://localhost:3000', url: 'http://localhost:3000' },
      { kind: 'text', text: ' now' },
    ])
  })

  it('strips a trailing closing paren, matching the bracketed-reference style', () => {
    // "[1] https://greyson-shop.myshopify.com/?preview_theme_id=190592418155"
    expect(linkify('(https://example.com/path)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', text: 'https://example.com/path', url: 'https://example.com/path' },
      { kind: 'text', text: ')' },
    ])
  })

  it('strips trailing sentence punctuation but not mid-URL characters', () => {
    expect(linkify('Visit https://example.com/a,b.c/d?x=1.2.')).toEqual([
      { kind: 'text', text: 'Visit ' },
      {
        kind: 'link',
        text: 'https://example.com/a,b.c/d?x=1.2',
        url: 'https://example.com/a,b.c/d?x=1.2',
      },
      { kind: 'text', text: '.' },
    ])
  })

  it('handles multiple URLs on one line', () => {
    const tokens = linkify('[1] http://127.0.0.1:9292 [2] https://example.com/x')
    expect(tokens.filter((t) => t.kind === 'link').map((t) => t.text)).toEqual([
      'http://127.0.0.1:9292',
      'https://example.com/x',
    ])
  })
})
