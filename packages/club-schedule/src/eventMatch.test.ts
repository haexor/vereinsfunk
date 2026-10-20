import { planSync, resolveIcalDateTime } from '@vereinsfunk/integrations'
import { describe, expect, it } from 'vitest'
import { ExternalClubEventSchema } from './event.js'
import { createClubEventMatchStrategy, type ClubEventLocal } from './eventMatch.js'
import type { ScheduleMatchContext } from './scheduleTime.js'

// Ersatz fuer resolveScheduleDateTime der API (siehe fixtureMatch.test.ts).
const schedule: ScheduleMatchContext = {
  resolveDateTime: (rawValue, tzid) => {
    const ical = resolveIcalDateTime(rawValue, tzid, 'Europe/Berlin')
    if (ical) return ical
    return /(?:Z|[+-]\d{2}:\d{2})$/.test(rawValue) ? { iso: new Date(rawValue).toISOString(), confirmed: true } : undefined
  },
  now: new Date('2026-08-10T00:00:00Z'),
}

function localEvent(overrides: Partial<ClubEventLocal> = {}): ClubEventLocal {
  return {
    id: 'local-1', externalId: 'uid-1', recurrenceKey: null, sourceId: 'source-1', title: 'Sommerfest', description: null,
    category: 'festival', startsAt: new Date('2026-08-20T14:00:00Z'), endsAt: new Date('2026-08-20T20:00:00Z'), allDay: false,
    locationName: null, locationAddress: null, registrationUrl: null, status: 'scheduled',
    sourceUpdatedAt: null, updatedAt: new Date('2026-08-01T00:00:00Z'), ...overrides,
  }
}

describe('createClubEventMatchStrategy.identityOf', () => {
  it('prefers the external id when present', () => {
    const entity = ExternalClubEventSchema.parse({ externalId: 'ext-1', title: 'Sommerfest', startsAt: '2026-08-20T16:00:00Z' })
    expect(createClubEventMatchStrategy(schedule).identityOf(entity)).toEqual({ externalId: 'ext-1' })
  })

  it('falls back to a fuzzy key of title and start time', () => {
    const entity = ExternalClubEventSchema.parse({ title: 'Sommerfest', startsAt: '2026-08-20T16:00:00Z' })
    expect(createClubEventMatchStrategy(schedule).identityOf(entity)).toEqual({ fuzzy: ['sommerfest', String(Date.parse('2026-08-20T16:00:00Z'))] })
  })

  it('gives each instance of a series its own NUL-free identity, so conflict fingerprints and rows stay apart', () => {
    const strategy = createClubEventMatchStrategy(schedule)
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

describe('createClubEventMatchStrategy time comparison', () => {
  it('treats an unchanged iCal event as unchanged although the feed writes its times in compact form', () => {
    const external = ExternalClubEventSchema.parse({ externalId: 'uid-1', title: 'Sommerfest', startsAt: '20260820T140000Z', endsAt: '20260820T200000Z' })
    const plan = planSync({ existing: [localEvent()], incoming: [external], match: createClubEventMatchStrategy(schedule), policy: { lossThresholdPercent: 30 } })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.updated).toHaveLength(0)
    expect(plan.skipped[0]?.reason).toBe('unchanged')
  })
})

describe('createClubEventMatchStrategy retirement', () => {
  it('leaves cancelled and past events out of retirement and the loss threshold', () => {
    const plan = planSync({
      existing: [
        localEvent(),
        localEvent({ id: 'cancelled', externalId: 'uid-cancelled', status: 'cancelled' }),
        localEvent({ id: 'past', externalId: 'uid-past', startsAt: new Date('2026-05-01T14:00:00Z'), endsAt: null }),
      ],
      incoming: [ExternalClubEventSchema.parse({ externalId: 'uid-1', title: 'Sommerfest', startsAt: '20260820T140000Z' })],
      match: createClubEventMatchStrategy(schedule),
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.retired).toHaveLength(0)
  })
})
