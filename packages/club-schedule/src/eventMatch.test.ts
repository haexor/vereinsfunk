import { describe, expect, it } from 'vitest'
import { ExternalClubEventSchema } from './event.js'
import { createClubEventMatchStrategy } from './eventMatch.js'

describe('createClubEventMatchStrategy.identityOf', () => {
  it('prefers the external id when present', () => {
    const entity = ExternalClubEventSchema.parse({ externalId: 'ext-1', title: 'Sommerfest', startsAt: '2026-08-20T16:00:00Z' })
    expect(createClubEventMatchStrategy().identityOf(entity)).toEqual({ externalId: 'ext-1' })
  })

  it('falls back to a fuzzy key of title and start time', () => {
    const entity = ExternalClubEventSchema.parse({ title: 'Sommerfest', startsAt: '2026-08-20T16:00:00Z' })
    expect(createClubEventMatchStrategy().identityOf(entity)).toEqual({ fuzzy: ['sommerfest', '2026-08-20T16:00:00Z'] })
  })

  it('gives each instance of a series its own NUL-free identity, so conflict fingerprints and rows stay apart', () => {
    const strategy = createClubEventMatchStrategy()
    const first = strategy.identityOf(ExternalClubEventSchema.parse({ externalId: 'series-1', recurrenceKey: '20260820T160000Z', title: 'Training', startsAt: '20260820T160000Z' }))
    const second = strategy.identityOf(ExternalClubEventSchema.parse({ externalId: 'series-1', recurrenceKey: '20260827T160000Z', title: 'Training', startsAt: '20260827T160000Z' }))
    const ids = [first, second].map((identity) => ('externalId' in identity ? identity.externalId : undefined))
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) {
      expect(id).toBeDefined()
      expect(id?.includes('\u0000')).toBe(false)
    }
  })
})
