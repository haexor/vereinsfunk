import { describe, expect, it } from 'vitest'
import { resolveAnalyticsRange } from '../utils/analyticsRange'

describe('analytics date range', () => {
  it.each([
    ['2026-03-01', '2026-01-31'],
    ['2026-01-15', '2025-12-17'],
  ])('maps 30 days from %s to an inclusive range across calendar boundaries', (todayKey, from) => {
    expect(resolveAnalyticsRange('30d', todayKey, { from: '', to: '' })).toEqual({ from, to: todayKey })
  })

  it('keeps incomplete custom ranges unchanged for form validation', () => {
    expect(resolveAnalyticsRange('custom', '2026-01-15', { from: '', to: '' })).toEqual({ from: '', to: '' })
  })
})
