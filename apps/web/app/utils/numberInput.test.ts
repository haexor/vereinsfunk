import { describe, expect, it } from 'vitest'
import { optionalNumber } from './numberInput'

describe('optionalNumber', () => {
  it('passes through the number a type="number" v-model writes', () => {
    expect(optionalNumber(800)).toBe(800)
    expect(optionalNumber(0)).toBe(0)
  })

  it('reads an untouched or cleared field as no value', () => {
    expect(optionalNumber('')).toBeNull()
    expect(optionalNumber('  ')).toBeNull()
  })

  it('parses a prefilled string value', () => {
    expect(optionalNumber('1998')).toBe(1998)
  })
})
