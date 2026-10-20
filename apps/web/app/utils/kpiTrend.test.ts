import { describe, expect, it } from 'vitest'
import { kpiTrend } from './kpiTrend'

describe('kpiTrend', () => {
  it('shows no trend without a previous period', () => {
    expect(kpiTrend(null)).toBeNull()
    expect(kpiTrend(undefined)).toBeNull()
  })

  it('treats a rise as good for counts and a fall as bad', () => {
    expect(kpiTrend(0.125)).toEqual({ label: '+13 %', good: true, rising: true })
    expect(kpiTrend(-0.2)).toEqual({ label: '-20 %', good: false, rising: false })
  })

  it('treats a fall as good when lower is better, as for lead times', () => {
    expect(kpiTrend(-0.2, true)).toEqual({ label: '-20 %', good: true, rising: false })
    expect(kpiTrend(0.2, true)).toEqual({ label: '+20 %', good: false, rising: true })
  })

  it('points an unchanged value in the good direction', () => {
    expect(kpiTrend(0)).toEqual({ label: '0 %', good: true, rising: true })
    expect(kpiTrend(0, true)).toEqual({ label: '0 %', good: true, rising: false })
  })
})
