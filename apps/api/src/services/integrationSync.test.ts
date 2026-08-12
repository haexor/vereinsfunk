import { describe, expect, it } from 'vitest'
import { resolveScheduleDateTime } from './integrationSync.js'

describe('resolveScheduleDateTime', () => {
  it('resolves an explicit Z-suffixed value as confirmed', () => {
    expect(resolveScheduleDateTime('2026-08-12T19:30:00Z', undefined, 'Europe/Berlin')).toEqual({
      iso: '2026-08-12T19:30:00.000Z', confirmed: true,
    })
  })

  it('resolves an explicit numeric offset as confirmed', () => {
    expect(resolveScheduleDateTime('2026-08-12T19:30:00+02:00', undefined, 'Europe/Berlin')).toEqual({
      iso: '2026-08-12T17:30:00.000Z', confirmed: true,
    })
  })

  it('resolves an offset-less value via the fallback timezone instead of the process timezone, unconfirmed', () => {
    expect(resolveScheduleDateTime('2026-08-12T19:30:00', undefined, 'Europe/Berlin')).toEqual({
      iso: '2026-08-12T17:30:00.000Z', confirmed: false,
    })
  })

  it('resolves a bare date via the fallback timezone as midnight there, not UTC midnight', () => {
    // CEST (UTC+2) im August -- 2026-08-12 00:00 Europe/Berlin ist 2026-08-11T22:00:00Z.
    expect(resolveScheduleDateTime('2026-08-12', undefined, 'Europe/Berlin')).toEqual({
      iso: '2026-08-11T22:00:00.000Z', confirmed: false,
    })
  })

  it('preserves milliseconds for an offset-less value instead of truncating them', () => {
    const resolved = resolveScheduleDateTime('2026-08-12T19:30:00.500', undefined, 'Europe/Berlin')
    expect(resolved).toEqual({ iso: '2026-08-12T17:30:00.500Z', confirmed: false })
  })

  it('preserves milliseconds for an explicit-offset value', () => {
    const resolved = resolveScheduleDateTime('2026-08-12T19:30:00.500Z', undefined, 'Europe/Berlin')
    expect(resolved).toEqual({ iso: '2026-08-12T19:30:00.500Z', confirmed: true })
  })

  it.each([
    ['2026-02-30T19:30:00', 'day 30 does not exist in February'],
    ['2026-02-30T19:30:00Z', 'day 30 does not exist in February, even with an explicit offset'],
    ['2026-01-01T25:00:00', 'hour 25 is out of range'],
    ['2026-01-01T19:61:00', 'minute 61 is out of range'],
    ['2026-13-01T19:30:00', 'month 13 does not exist'],
  ])('rejects %s as invalid instead of silently rolling it over (%s)', (value) => {
    expect(resolveScheduleDateTime(value, undefined, 'Europe/Berlin')).toBeUndefined()
  })

  it.each([
    ['2026/08/12 19:30', 'not an ISO date'],
    ['August 12, 2026', 'a locale-formatted date'],
    ['2026-08-12T19:30:00 GMT', 'a named timezone abbreviation instead of an offset'],
    ['kaputtes-datum', 'not a date at all'],
  ])('rejects %s instead of falling back to a process-timezone-dependent parse (%s)', (value) => {
    expect(resolveScheduleDateTime(value, undefined, 'Europe/Berlin')).toBeUndefined()
  })
})
