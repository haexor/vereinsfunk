import { expect, it, vi } from 'vitest'
import type { WorkerEnvironment } from '@vereinsfunk/config'

const { sessionRow, rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
  sessionRow: {
    id: '10000000-0000-4000-8000-000000000001', organization_id: '10000000-1000-4000-8000-000000000001', department_id: null, team_id: null,
    communication_goal: 'inform',
    // Wie tatsaechlich in composition_sessions.source_material gespeichert (StoredSourceMaterialSchema):
    // forbiddenTopics ist nur dort deklariert, nicht in SourceMaterialSchema (dem Nutzereingabe-Schema).
    source_material: { facts: {}, observations: ['Testspiel gewonnen'], quotes: [], forbiddenTopics: [] },
    style_profile_snapshot: { name: 'Klar', description: 'klar', styleRules: { toneTags: [], catchphrases: [], examples: [], additionalInstructions: '' }, avoidRules: [], doRules: [] },
    max_characters: 2200, temperature: 0.6,
  },
}))

vi.mock('@supabase/supabase-js', () => {
  const builder = { select: vi.fn(() => builder), eq: vi.fn(() => builder), maybeSingle: vi.fn(async () => ({ data: sessionRow, error: null })) }
  return { createClient: vi.fn(() => ({ from: vi.fn(() => builder), rpc })) }
})

const config = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service', DATABASE_URL: 'postgresql://postgres:secret@db.example:5432/postgres', HATCHET_CLIENT_TOKEN: 'token', SECRET_BOX_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') }), SECRET_BOX_CURRENT_KEY_VERSION: 'v1' } as WorkerEnvironment

// Regression: SessionRowSchema darf source_material nur lose typisieren (z.unknown()), sonst
// entfernt sein .parse() unbekannte Schluessel wie forbiddenTopics, bevor textGeneration.ts's
// execute() sie mit StoredSourceMaterialSchema strikt prueft -- siehe deren Kommentar oben.
it('loadSession preserves forbiddenTopics on source_material instead of silently stripping it', async () => {
  const { createTextGenerationRepository } = await import('./context.js')
  const repository = createTextGenerationRepository(config)
  const session = await repository.loadSession(sessionRow.id, sessionRow.organization_id)
  expect(session?.source_material).toEqual(sessionRow.source_material)
})

// Regression: eine einzige ungueltige Outbox-Zeile liess claimPending fuer den ganzen Stapel werfen,
// alle geclaimten Zeilen blieben in 'dispatching' haengen und der Versand stand fuer alle Vereine.
it('claimPending releases an invalid outbox row individually and keeps the valid ones', async () => {
  const valid = { id: '10000000-2000-4000-8000-000000000001', claim_token: '10000000-2000-4000-8000-000000000002', workflow_name: 'generate-text-post', priority: 2, payload: { entityId: sessionRow.id, organizationId: sessionRow.organization_id, departmentConcurrencyKey: 'org', correlationId: '10000000-2000-4000-8000-000000000003', sourceRevision: 1, purpose: 'initial', idempotencyKey: 'generate-text:test' } }
  const invalid = { ...valid, id: '10000000-2000-4000-8000-000000000004', claim_token: '10000000-2000-4000-8000-000000000005', workflow_name: 'no-such-workflow' }
  rpc.mockImplementation(async (name: string) => (name === 'claim_workflow_outbox' ? { data: [invalid, valid], error: null } : { data: true, error: null }))
  const { createWorkflowOutboxRepository } = await import('./context.js')
  const claimed = await createWorkflowOutboxRepository(config).claimPending(20)
  expect(claimed.map((entry) => entry.id)).toEqual([valid.id])
  expect(rpc).toHaveBeenCalledWith('release_workflow_outbox', { p_outbox_id: invalid.id, p_claim_token: invalid.claim_token, p_error_class: 'invalid_outbox_row' })
})
