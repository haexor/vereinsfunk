import { createHash, randomUUID } from 'node:crypto'
import { createLogger } from '@vereinsfunk/observability'

const logger = createLogger({ name: 'worker' })

export type StalledCandidateRow = { id: string; composition_session_id: string; organization_id: string; generation_intent: 'initial' | 'revise'; revision_instruction: string | null; generation_lease_token: string }
export type RecoverableSessionRow = {
  organization_id: string; department_id: string; team_id: string | null; preset_slug: string; communication_goal: string
  requested_formats: unknown; source_material: unknown; style_profile_id: string | null; style_profile_snapshot: unknown
  effective_config_snapshot: unknown; target_platform: 'instagram' | 'facebook' | null; max_output_tokens: number; temperature: number
  source_revision: number; input_hash: string; created_by: string
}
export type RecoveryOutcome = 'created' | 'limit_reached'

export interface GenerationRecoveryRepository {
  claimStalledCandidates(limit: number): Promise<StalledCandidateRow[]>
  loadSessionForRecovery(sessionId: string, organizationId: string): Promise<RecoverableSessionRow | null>
  createRecoveryAttempt(session: RecoverableSessionRow, stale: StalledCandidateRow, candidateInputHash: string, correlationId: string, idempotencyKey: string): Promise<RecoveryOutcome>
  // Only finalizes the stale candidate as terminally failed once its replacement's fate is known --
  // claimStalledCandidates itself leaves it reclaimable, so a crash between the two round trips
  // retries on the next scan (createRecoveryAttempt is idempotent) instead of losing the row.
  finalizeRecovery(stale: StalledCandidateRow, failureCode: string): Promise<void>
}

const PAGE_LIMIT = 20
const MAX_PAGES = 20

/**
 * One cron tick: attempts a fresh retry for every claimed candidate, then ends the stale one
 * honestly. Finalization only runs once the replacement's fate is known -- a crash or thrown
 * error before that point leaves the candidate reclaimable on the next scan instead of lost.
 */
export async function scanAndRecoverStaleCandidates(repository: GenerationRecoveryRepository): Promise<void> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const stalled = await repository.claimStalledCandidates(PAGE_LIMIT)
    if (stalled.length === 0) return
    for (const candidate of stalled) {
      try {
        const session = await repository.loadSessionForRecovery(candidate.composition_session_id, candidate.organization_id)
        if (!session) {
          logger.error({ candidateId: candidate.id }, 'stalled candidate recovery: session not found')
          await repository.finalizeRecovery(candidate, 'stalled_after_crash')
          continue
        }
        // Deterministic and distinct from any content-derived hash create_text_generation_session
        // otherwise uses, so its dedup lookup cannot mistake this for the just-failed candidate.
        const candidateInputHash = createHash('sha256').update(`${candidate.id}:recovery`).digest('hex')
        const outcome = await repository.createRecoveryAttempt(session, candidate, candidateInputHash, randomUUID(), `generate-text:recovery:${randomUUID()}`)
        if (outcome === 'limit_reached') logger.warn({ candidateId: candidate.id, sessionId: candidate.composition_session_id }, 'automatic recovery skipped: composition session candidate limit reached')
        await repository.finalizeRecovery(candidate, 'stalled_after_crash')
      } catch (error) {
        logger.error({ err: error, candidateId: candidate.id }, 'automatic recovery attempt failed')
      }
    }
  }
}
