import { randomUUID } from 'node:crypto'
import { UuidSchema } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

export type QueuedSyncResult = 'acquired' | 'replay' | 'already_running'
const EnqueueIntegrationSyncRowSchema = z.object({
  result: z.enum(['acquired', 'replay', 'already_running']),
  run_id: UuidSchema,
})

export function isSourceDisabledError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : ''
  return message.includes('source_disabled')
}

/**
 * Paket 053: reiht einen Abgleich einer HTTP-Quelle fuer den Worker ein (public.enqueue_integration_sync).
 * Belegt atomar den Lauf-Slot aus Paket 026 und schreibt den ID-only-Auftrag in workflow_outbox.
 */
export async function enqueueIntegrationSync(
  service: SupabaseClient,
  input: { organizationId: string; sourceId: string; idempotencyKey: string; triggeredBy: string | null },
): Promise<{ result: QueuedSyncResult; runId: string }> {
  const queued = await service.rpc('enqueue_integration_sync', {
    target_organization_id: input.organizationId,
    target_source_id: input.sourceId,
    target_request_idempotency_key: input.idempotencyKey,
    target_correlation_id: randomUUID(),
    target_triggered_by: input.triggeredBy,
  })
  if (queued.error) throw queued.error
  const row = EnqueueIntegrationSyncRowSchema.array().parse(queued.data ?? [])[0]
  if (!row) throw new Error('enqueue_integration_sync returned no result')
  return { result: row.result, runId: row.run_id }
}
