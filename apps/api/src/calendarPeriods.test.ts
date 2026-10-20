import { describe, expect, it } from 'vitest'
import { currentPeriodStarts } from './calendarPeriods.js'

describe('currentPeriodStarts', () => {
  it('starts day, week, month and year at midnight in the club timezone', () => {
    // Mittwoch, 12.08.2026, 00:30 in Berlin (CEST) -- in UTC noch der Vortag.
    expect(currentPeriodStarts('Europe/Berlin', new Date('2026-08-11T22:30:00Z'))).toEqual({
      day: '2026-08-11T22:00:00.000Z',
      week: '2026-08-09T22:00:00.000Z',
      month: '2026-07-31T22:00:00.000Z',
      year: '2025-12-31T23:00:00.000Z',
    })
  })

  it('takes Monday as the start of the week on a Sunday', () => {
    expect(currentPeriodStarts('Europe/Berlin', new Date('2026-08-16T12:00:00Z')).week).toBe('2026-08-09T22:00:00.000Z')
  })
})
