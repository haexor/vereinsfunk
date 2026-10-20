import { describe, expect, it } from 'vitest'
import { initialsOf } from './initials'

describe('initialsOf', () => {
  it('takes the first letters of the first two words in upper case', () => {
    expect(initialsOf('sv  Musterstadt 1910')).toBe('SM')
  })

  it('returns an empty string for a blank name', () => {
    expect(initialsOf('  ')).toBe('')
  })
})
