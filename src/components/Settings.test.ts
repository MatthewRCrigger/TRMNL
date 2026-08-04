/** Browsing for a working directory renames an untouched profile after the
 *  folder, so the name it produces has to be one the user would have typed. */

import { describe, expect, it } from 'vitest'

import { DEFAULT_PROFILE_NAME, folderName } from './Settings'

describe('folderName', () => {
  it('takes the trailing folder', () => {
    expect(folderName('/Users/me/crggr/TRMNL')).toBe('TRMNL')
  })

  it('ignores a trailing slash', () => {
    // The folder panel can return either form depending on how it was reached.
    expect(folderName('/Users/me/crggr/TRMNL/')).toBe('TRMNL')
    expect(folderName('/Users/me/crggr/TRMNL///')).toBe('TRMNL')
  })

  it('keeps a name with spaces or dots intact', () => {
    expect(folderName('/Users/me/Boy Smells')).toBe('Boy Smells')
    expect(folderName('/Users/me/.config')).toBe('.config')
  })

  it('returns empty at the filesystem root', () => {
    // Renaming a profile to nothing is worse than leaving it untouched, so the
    // caller checks for this and keeps the default name.
    expect(folderName('/')).toBe('')
    expect(folderName('///')).toBe('')
  })
})

describe('DEFAULT_PROFILE_NAME', () => {
  it('is what a new profile is called', () => {
    // The rename only fires on an exact match, so this string is a contract
    // between profile creation and the browse handler, not a label.
    expect(DEFAULT_PROFILE_NAME).toBe('new profile')
  })
})
