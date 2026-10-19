import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { finishSyncRun, handleAbortedSync, resolveScheduleDateTime } from './integrationSync.js'

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

describe('sync run completion', () => {
  const RUN_ID = '26000000-4000-4000-8000-000000000001'
  const SOURCE_ID = '26000000-2000-4000-8000-000000000001'
  const ORGANIZATION_ID = '26000000-1000-4000-8000-000000000001'

  // Nur die Tabellen, die der Abschluss eines Laufs anfasst; das Quellen-Update scheitert.
  function failingSourceStatusService(): SupabaseClient {
    const runRow = (row: Record<string, unknown>) => ({
      id: RUN_ID, organization_id: ORGANIZATION_ID, source_id: SOURCE_ID, domain: 'people', mode: 'apply',
      created_count: 0, updated_count: 0, retired_count: 0, skipped_count: 0, conflict_count: 0, error_class: null,
      started_at: '2026-10-01T10:00:00Z', finished_at: '2026-10-01T10:00:01Z', ...row,
    })
    return {
      from: (table: string) => {
        if (table === 'integration_sync_runs') {
          return { update: (row: Record<string, unknown>) => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: runRow(row), error: null }) }) }) }) }) }
        }
        if (table === 'integration_sources') return { update: () => ({ eq: async () => ({ data: null, error: { message: 'connection reset' } }) }) }
        if (table === 'audit_events') return { insert: async () => ({ error: null }) }
        throw new Error(`unexpected table in test fake: ${table}`)
      },
    } as unknown as SupabaseClient
  }

  function loggingRequest() {
    const error = vi.fn()
    const request = { id: '26000000-9000-4000-8000-000000000001', auth: { userId: '26000000-8000-4000-8000-000000000001' }, log: { error } } as unknown as FastifyRequest
    return { request, error }
  }

  it('logs a failed source status update after a succeeded run instead of dropping it', async () => {
    const { request, error } = loggingRequest()
    const response = await finishSyncRun({
      service: failingSourceStatusService(), request, runId: RUN_ID, organizationId: ORGANIZATION_ID, sourceId: SOURCE_ID,
      domain: 'people', mode: 'apply', idempotencyKey: 'key-1', createdCount: 0, updatedCount: 0, retiredCount: 0, skippedCount: 0, pendingConflicts: [],
    })
    expect(response.run.status).toBe('succeeded')
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: { message: 'connection reset' } }), 'integration_sources status update failed')
  })

  it('logs a failed source status update after a run aborted by the loss threshold', async () => {
    const { request, error } = loggingRequest()
    const response = await handleAbortedSync({ service: failingSourceStatusService(), request, runId: RUN_ID, sourceId: SOURCE_ID, idempotencyKey: 'key-1' })
    expect(response.run.status).toBe('aborted_loss_threshold')
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: { message: 'connection reset' } }), 'integration_sources status update failed')
  })
})
