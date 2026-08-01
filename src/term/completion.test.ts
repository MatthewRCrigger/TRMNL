/** Completion responses are raw shell output, so the parser has to tell a
 * direct insertion apart from a candidate listing without guessing. The fixtures
 * here were captured from a real zsh over a PTY. */

import { describe, expect, it } from 'vitest'

import { commonPrefix, lastWord, parseCompletion } from './completion'

describe('parseCompletion', () => {
  it('appends a unique completion', () => {
    // `cd cr` + TAB, captured from zsh: just the delta, with the trailing slash
    // bolded because it is a directory.
    const result = parseCompletion('ggr\x1b[1m/\x1b[0m', 'cd cr')
    expect(result.insert).toBe('ggr/')
    expect(result.candidates).toEqual([])
  })

  it('lists candidates when the completion is ambiguous', () => {
    // `cd ` + TAB against a home directory: BEL, a padded column layout, then
    // cursor-up escapes redrawing the prompt.
    const response =
      '\x07\r\r\n\x1b[JApplications/        Downloads/           Music/\r\n' +
      'Desktop/             Library/             Pictures/\r\n' +
      '\x1b[4A\x1b[0m\x1b[27m\x1b[24m\r\x1b[43Ccd\x1b[K\x1b[1C'

    const result = parseCompletion(response, 'cd ')
    expect(result.insert).toBe('')
    expect(result.candidates).toEqual([
      'Applications/',
      'Downloads/',
      'Music/',
      'Desktop/',
      'Library/',
      'Pictures/',
    ])
  })

  it('does not mistake the prompt redraw for a candidate', () => {
    const response =
      '\x07\r\r\n\x1b[Jsrc/    dist/\r\n\x1b[2A\x1b[0m\r\x1b[10Ccd \x1b[K'
    expect(parseCompletion(response, 'cd ').candidates).toEqual(['src/', 'dist/'])
  })

  it('treats a lone listed candidate as a completion', () => {
    // zsh sometimes displays a single match rather than inserting it; finishing
    // the word is more useful than showing a one-item list.
    const response = '\x07\r\r\n\x1b[Jgreyson-v2/\r\n\x1b[2A\r'
    const result = parseCompletion(response, 'cd gre')
    expect(result.insert).toBe('yson-v2/')
    expect(result.candidates).toEqual([])
  })

  it('keeps filenames that contain a single space', () => {
    // Columns are separated by two or more spaces, so one space is data.
    const response = '\x07\r\r\nMy File.txt          other.txt\r\n\x1b[2A\r'
    expect(parseCompletion(response, 'cat ').candidates).toEqual(['My File.txt', 'other.txt'])
  })

  it('returns nothing for an empty response', () => {
    expect(parseCompletion('', 'cd x')).toEqual({ insert: '', candidates: [] })
  })

  it('ignores a bare bell with no candidates', () => {
    // zsh rings the bell when there is nothing to complete.
    expect(parseCompletion('\x07', 'zzzz').candidates).toEqual([])
  })
})

describe('lastWord', () => {
  it('returns the word being completed', () => {
    expect(lastWord('cd myntr/gre')).toBe('myntr/gre')
    expect(lastWord('git che')).toBe('che')
  })

  it('returns an empty string right after a space', () => {
    expect(lastWord('cd ')).toBe('')
  })

  it('treats a single token as the word', () => {
    expect(lastWord('whoam')).toBe('whoam')
  })
})

describe('commonPrefix', () => {
  it('finds the shared prefix', () => {
    expect(commonPrefix(['greyson-v2', 'greyson-v3'])).toBe('greyson-v')
  })

  it('is empty when nothing is shared', () => {
    expect(commonPrefix(['alpha', 'beta'])).toBe('')
  })

  it('handles a single value and an empty list', () => {
    expect(commonPrefix(['only'])).toBe('only')
    expect(commonPrefix([])).toBe('')
  })
})
