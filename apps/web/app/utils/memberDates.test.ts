import { describe, expect, it } from 'vitest'
import { endOfDayIso, localDateKey } from './memberDates'

describe('member date helpers', () => {
  it('uses the organization timezone for expiry date inputs', () => {
    expect(localDateKey(new Date('2026-01-01T00:30:00.000Z'), 'America/Los_Angeles')).toBe('2025-12-31')
  })

  it('keeps an expiry valid through the selected local calendar day', () => {
    expect(endOfDayIso('2026-08-09', 'Europe/Berlin')).toBe('2026-08-09T21:59:59.999Z')
  })
})
