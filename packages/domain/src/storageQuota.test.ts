import { describe, expect, it } from 'vitest'
import { evaluateStorageReservation } from './index.js'

describe('evaluateStorageReservation', () => {
  it('allows a reservation that stays under every applicable limit', () => {
    const result = evaluateStorageReservation({
      limits: { organizationBytes: 1000 },
      usage: { organizationBytes: 400 },
      announcedBytes: 200,
    })
    expect(result).toEqual({ allowed: true })
  })

  it('blocks at the organization level when no department limit is set', () => {
    const result = evaluateStorageReservation({
      limits: { organizationBytes: 1000 },
      usage: { organizationBytes: 900 },
      announcedBytes: 200,
    })
    expect(result).toEqual({ allowed: false, blockingScope: 'organization', limitBytes: 1000, usedBytes: 900 })
  })

  it('blocks at the department level even though the organization still has room', () => {
    const result = evaluateStorageReservation({
      limits: { organizationBytes: 10_000, departmentBytes: 500 },
      usage: { organizationBytes: 400, departmentBytes: 400 },
      announcedBytes: 200,
    })
    expect(result).toEqual({ allowed: false, blockingScope: 'department', limitBytes: 500, usedBytes: 400 })
  })

  it('blocks at the team level before checking department or organization', () => {
    const result = evaluateStorageReservation({
      limits: { organizationBytes: 10_000, departmentBytes: 5_000, teamBytes: 100 },
      usage: { organizationBytes: 400, departmentBytes: 400, teamBytes: 90 },
      announcedBytes: 50,
    })
    expect(result).toEqual({ allowed: false, blockingScope: 'team', limitBytes: 100, usedBytes: 90 })
  })

  it('allows a reservation exactly at the limit', () => {
    const result = evaluateStorageReservation({
      limits: { organizationBytes: 1000 },
      usage: { organizationBytes: 800 },
      announcedBytes: 200,
    })
    expect(result).toEqual({ allowed: true })
  })
})
