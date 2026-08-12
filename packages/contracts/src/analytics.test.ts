import { describe, expect, it } from 'vitest'
import { AnalyticsBreakdownQuerySchema, AnalyticsFunnelQuerySchema, AnalyticsScopeQuerySchema, AnalyticsTimeseriesQuerySchema } from './index.js'
import { org, team } from './testFixtures.js'

describe('analytics contracts (Paket 016)', () => {
  it('accepts a plain organization-scoped range', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, from: '2026-07-01', to: '2026-07-31' }).success).toBe(true)
  })

  it('rejects a teamId without a departmentId', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, teamId: team, from: '2026-07-01', to: '2026-07-31' }).success).toBe(false)
  })

  it('rejects a range where from is after to', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, from: '2026-07-31', to: '2026-07-01' }).success).toBe(false)
  })

  it('rejects a range spanning more than 24 months', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, from: '2020-01-01', to: '2026-07-01' }).success).toBe(false)
  })

  it('accepts a range of exactly 24 months', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, from: '2024-07-01', to: '2026-07-01' }).success).toBe(true)
  })

  it('applies the same scope validation to the timeseries, breakdown, and funnel query schemas', () => {
    expect(AnalyticsTimeseriesQuerySchema.safeParse({ organizationId: org, teamId: team, from: '2026-07-01', to: '2026-07-31', metric: 'postsCreated' }).success).toBe(false)
    expect(AnalyticsBreakdownQuerySchema.safeParse({ organizationId: org, from: '2026-07-31', to: '2026-07-01', dimension: 'department' }).success).toBe(false)
    expect(AnalyticsFunnelQuerySchema.safeParse({ organizationId: org, from: '2020-01-01', to: '2026-07-01' }).success).toBe(false)
  })

  it('defaults timeseries granularity to day', () => {
    const result = AnalyticsTimeseriesQuerySchema.safeParse({ organizationId: org, from: '2026-07-01', to: '2026-07-31', metric: 'postsCreated' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.granularity).toBe('day')
  })
})
