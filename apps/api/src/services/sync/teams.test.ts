import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { chain } from '../../testSupport.js'
import type { SyncDomainContext } from '../integrationSync.js'

// Der Unique-Index teams_active_url_slug_unique (ADR-014) darf einen Teams-Sync nicht abbrechen:
// jede kollidierende Zeile wird ein invalid_record-Konflikt auf dem Namen, die uebrigen werden
// geschrieben.

vi.mock('../integrationSync.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  finishSyncRun: vi.fn(async (input: Record<string, unknown>) => input),
}))

const { handleTeamsSync } = await import('./teams.js')

const ORGANIZATION_ID = '54000000-1000-4000-8000-000000000001'
const DEPARTMENT_ID = '54000000-1100-4000-8000-000000000001'
const SOURCE_ID = '54000000-2000-4000-8000-000000000001'
const NAME_TAKEN = { code: '23505', message: 'duplicate key value violates unique constraint "teams_active_url_slug_unique"' }
const EXTERNAL_DUPLICATE = { code: '23505', message: 'duplicate key value violates unique constraint "teams_external_unique"' }

type DbError = { code: string; message: string } | null
interface Writes { inserts: Record<string, unknown>[][]; updates: { values: Record<string, unknown>; id: string }[] }

function context(options: {
  rows: Record<string, unknown>[]
  existing?: Record<string, unknown>[]
  insertError?: (rows: Record<string, unknown>[]) => DbError
  updateError?: (values: Record<string, unknown>) => DbError
}) {
  const writes: Writes = { inserts: [], updates: [] }
  const service = {
    from: (table: string) => {
      if (table === 'departments') return { select: () => ({ eq: () => chain({ data: [{ id: DEPARTMENT_ID, name: 'Handball' }], error: null }) }) }
      if (table === 'integration_sync_conflicts') return { select: () => chain({ data: [], error: null }) }
      if (table !== 'teams') throw new Error(`unexpected table in test fake: ${table}`)
      return {
        select: () => chain({ data: options.existing ?? [], error: null }),
        insert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          const list = Array.isArray(rows) ? rows : [rows]
          writes.inserts.push(list)
          return { error: options.insertError?.(list) ?? null }
        },
        update: (values: Record<string, unknown>) => ({
          eq: (_column: string, id: string) => {
            const result = Promise.resolve({ error: 'archived_at' in values ? null : options.updateError?.(values) ?? null })
            if (!('archived_at' in values)) writes.updates.push({ values, id })
            return Object.assign(result, { is: () => result })
          },
        }),
      }
    },
  } as unknown as SupabaseClient
  const reply = { code: () => ({ send: (body: unknown) => body }) } as unknown as FastifyReply
  const ctx: SyncDomainContext = {
    request: {} as FastifyRequest, reply, service, organizationId: ORGANIZATION_ID, sourceDepartmentId: null, sourceId: SOURCE_ID,
    sourceFieldMapping: { id: 'externalId', name: 'name', department: 'departmentName' }, sourceLossThresholdPercent: 100,
    mode: 'apply', domain: 'teams', correlationId: 'c', runId: 'r', idempotencyKey: 'k', rawRows: options.rows, organizationTimezone: 'Europe/Berlin',
  }
  return { ctx, writes }
}

const incoming = (id: string, name: string) => ({ id, name, department: 'Handball' })
type Finished = { createdCount: number; updatedCount: number; pendingConflicts: { kind: string; field: string; label: string; incomingValue: string; externalId: string | null }[] }

describe('team sync with the team name index', () => {
  it('uses a single batch insert when nothing collides', async () => {
    const { ctx, writes } = context({ rows: [incoming('e1', 'U13'), incoming('e2', 'U15')] })
    const result = await handleTeamsSync(ctx) as unknown as Finished
    expect(writes.inserts).toHaveLength(1)
    expect(writes.inserts[0]).toHaveLength(2)
    expect(result).toMatchObject({ createdCount: 2, pendingConflicts: [] })
  })

  it('falls back to per-row inserts and reports each colliding row as a conflict on the name', async () => {
    const { ctx, writes } = context({
      rows: [incoming('e1', 'U13'), incoming('e2', 'U-13'), incoming('e3', 'U15')],
      insertError: (rows) => (rows.length > 1 || rows[0]!.name === 'U-13' ? NAME_TAKEN : null),
    })
    const result = await handleTeamsSync(ctx) as unknown as Finished
    expect(writes.inserts.map((rows) => rows.map((row) => row.name))).toEqual([['U13', 'U-13', 'U15'], ['U13'], ['U-13'], ['U15']])
    expect(result.createdCount).toBe(2)
    expect(result.pendingConflicts).toEqual([expect.objectContaining({
      kind: 'invalid_record', field: 'name', label: 'U-13', externalId: 'e2', incomingValue: 'Name kollidiert mit einer bestehenden Mannschaft',
    })])
  })

  it('turns an update that hits the index into a conflict and still finishes the run', async () => {
    const existing = [{
      id: '54000000-1200-4000-8000-000000000001', name: 'Alt', department_id: DEPARTMENT_ID, age_group: null, competition: null, archived_at: null,
      source_id: SOURCE_ID, external_id: 'e1', source_updated_at: null, updated_at: '2026-01-01T00:00:00Z',
    }]
    const { ctx, writes } = context({ rows: [incoming('e1', 'U13')], existing, updateError: () => NAME_TAKEN })
    const result = await handleTeamsSync(ctx) as unknown as Finished
    expect(writes.updates).toHaveLength(1)
    expect(result.updatedCount).toBe(0)
    expect(result.pendingConflicts).toEqual([expect.objectContaining({ kind: 'invalid_record', field: 'name', label: 'U13' })])
  })

  it('still fails the run on any other unique violation', async () => {
    const { ctx } = context({ rows: [incoming('e1', 'U13')], insertError: () => EXTERNAL_DUPLICATE })
    await expect(handleTeamsSync(ctx)).rejects.toMatchObject({ message: expect.stringContaining('teams_external_unique') })
  })
})
