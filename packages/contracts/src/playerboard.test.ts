import { describe, expect, it } from 'vitest'
import { UpdatePlayerboardPlayerRequestSchema } from './index.js'

describe('UpdatePlayerboardPlayerRequestSchema', () => {
  it('accepts name and birth year changes and trims the names', () => {
    const parsed = UpdatePlayerboardPlayerRequestSchema.parse({
      firstName: ' Mia ',
      lastName: ' Keller ',
      birthYear: 2014,
    })
    expect(parsed).toEqual({ firstName: 'Mia', lastName: 'Keller', birthYear: 2014 })
  })

  it('accepts clearing the birth year but not blank names or implausible years', () => {
    expect(UpdatePlayerboardPlayerRequestSchema.safeParse({ birthYear: null }).success).toBe(true)
    expect(UpdatePlayerboardPlayerRequestSchema.safeParse({ firstName: '  ' }).success).toBe(false)
    expect(UpdatePlayerboardPlayerRequestSchema.safeParse({ birthYear: 1800 }).success).toBe(false)
  })
})
