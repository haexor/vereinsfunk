import { describe, expect, it, vi } from 'vitest'
import { scanAndRecoverStaleCandidates, type GenerationRecoveryRepository, type RecoverableSessionRow, type StalledCandidateRow } from './generationRecovery.js'

const stale: StalledCandidateRow = { id: '10000000-3010-4000-8000-000000000001', composition_session_id: '10000000-3000-4000-8000-000000000001', organization_id: '10000000-1000-4000-8000-000000000001', generation_intent: 'revise', revision_instruction: 'kuerzer bitte', generation_lease_token: '10000000-9010-4000-8000-000000000001' }
const session: RecoverableSessionRow = { organization_id: stale.organization_id, department_id: '10000000-1100-4000-8000-000000000001', team_id: null, preset_slug: 'training', communication_goal: 'inform', requested_formats: ['text_post'], source_material: {}, style_profile_id: null, style_profile_snapshot: {}, effective_config_snapshot: {}, target_platforms: ['instagram', 'facebook'], max_characters: 2200, temperature: 0.6, source_revision: 1, input_hash: 'a'.repeat(64), created_by: '10000000-0000-4000-8000-000000000001' }

function repository(overrides: Partial<GenerationRecoveryRepository> = {}): GenerationRecoveryRepository {
  return {
    claimStalledCandidates: vi.fn().mockResolvedValueOnce([stale]).mockResolvedValue([]),
    loadSessionForRecovery: vi.fn().mockResolvedValue(session),
    createRecoveryAttempt: vi.fn().mockResolvedValue('created'),
    finalizeRecovery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('scanAndRecoverStaleCandidates', () => {
  it('recovers a stalled candidate with the same generation intent and instruction', async () => {
    const repo = repository()
    await scanAndRecoverStaleCandidates(repo)
    expect(repo.createRecoveryAttempt).toHaveBeenCalledTimes(1)
    const [passedSession, passedStale] = vi.mocked(repo.createRecoveryAttempt).mock.calls[0]!
    expect(passedSession).toBe(session)
    expect(passedStale.generation_intent).toBe('revise')
    expect(passedStale.revision_instruction).toBe('kuerzer bitte')
    expect(repo.finalizeRecovery).toHaveBeenCalledWith(stale, 'stalled_after_crash')
  })
  it('does not throw when the composition session candidate limit is already reached, and still finalizes the stale candidate', async () => {
    const repo = repository({ createRecoveryAttempt: vi.fn().mockResolvedValue('limit_reached') })
    await expect(scanAndRecoverStaleCandidates(repo)).resolves.toBeUndefined()
    expect(repo.finalizeRecovery).toHaveBeenCalledWith(stale, 'stalled_after_crash')
  })
  it('finalizes a candidate whose session no longer exists, without creating a recovery attempt', async () => {
    const repo = repository({ loadSessionForRecovery: vi.fn().mockResolvedValue(null) })
    await expect(scanAndRecoverStaleCandidates(repo)).resolves.toBeUndefined()
    expect(repo.createRecoveryAttempt).not.toHaveBeenCalled()
    expect(repo.finalizeRecovery).toHaveBeenCalledWith(stale, 'stalled_after_crash')
  })
  it('continues with the next candidate after one throws unexpectedly, leaving it unfinalized for the next scan', async () => {
    const second: StalledCandidateRow = { ...stale, id: '10000000-3010-4000-8000-000000000002' }
    const repo = repository({
      claimStalledCandidates: vi.fn().mockResolvedValueOnce([stale, second]).mockResolvedValue([]),
      loadSessionForRecovery: vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue(session),
    })
    await expect(scanAndRecoverStaleCandidates(repo)).resolves.toBeUndefined()
    expect(repo.createRecoveryAttempt).toHaveBeenCalledTimes(1)
    expect(repo.finalizeRecovery).toHaveBeenCalledTimes(1)
    expect(repo.finalizeRecovery).toHaveBeenCalledWith(second, 'stalled_after_crash')
  })
  it('does not finalize when finalizeRecovery itself throws, so the row stays reclaimable', async () => {
    const repo = repository({ finalizeRecovery: vi.fn().mockRejectedValue(new Error('lease superseded')) })
    await expect(scanAndRecoverStaleCandidates(repo)).resolves.toBeUndefined()
  })
  it('stops paging once a page returns no stalled candidates', async () => {
    const repo = repository({ claimStalledCandidates: vi.fn().mockResolvedValue([]) })
    await scanAndRecoverStaleCandidates(repo)
    expect(repo.claimStalledCandidates).toHaveBeenCalledTimes(1)
  })
})
