import { describe, expect, it } from 'vitest'
import { monthRange, placementBadgeClass, rankingRange } from './playerboardRanking'

const base = { seasonFrom: '2026-08-01', month: '2026-02', customFrom: '', customTo: '' }

describe('monthRange', () => {
  it('ends on the last day of the month, leap years included', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })
})

describe('rankingRange', () => {
  it('starts the season at the effective season start', () => {
    expect(rankingRange('season', base)).toEqual({ from: '2026-08-01' })
  })

  it('falls back to the whole time without a season start', () => {
    expect(rankingRange('season', { ...base, seasonFrom: null })).toEqual({})
    expect(rankingRange('all', base)).toEqual({})
  })

  it('passes only the bounds a custom range sets', () => {
    expect(rankingRange('custom', { ...base, customFrom: '2026-09-01' })).toEqual({ from: '2026-09-01' })
    expect(rankingRange('custom', { ...base, customFrom: '2026-09-01', customTo: '2026-09-30' })).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('covers a whole month', () => {
    expect(rankingRange('month', base)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
})

describe('placementBadgeClass', () => {
  it('highlights shared places one to three', () => {
    expect(placementBadgeClass(1)).not.toBe(placementBadgeClass(4))
    expect(placementBadgeClass(3)).not.toBe(placementBadgeClass(4))
    expect(placementBadgeClass(7)).toBe(placementBadgeClass(4))
  })
})
