import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../utils/apiClient'
import type { useApiClient } from './useApiClient'
import { useScheduleOccasion } from './useScheduleOccasion'

const ORGANIZATION_ID = '3f000000-1000-4000-8000-000000000001'
const DEPARTMENT_ID = '3f000000-1100-4000-8000-000000000001'
const FIXTURE_ID = '3f000000-6000-4000-8000-000000000001'
const OCCASION = { kind: 'fixture', id: FIXTURE_ID, label: 'Spiel gegen TSV Sued', facts: { opponent: 'TSV Sued' }, missing: [], capturedAt: '2026-10-20T04:00:00Z', suggestedGoal: 'invite' }

function apiWith(request: (path: string, options: unknown) => Promise<unknown>) {
  return { request: vi.fn(request) } as unknown as ReturnType<typeof useApiClient> & { request: ReturnType<typeof vi.fn> }
}

describe('useScheduleOccasion', () => {
  it('loads the occasion for the active scope', async () => {
    const api = apiWith(async () => OCCASION)
    const { occasion, loadOccasion } = useScheduleOccasion(api)
    expect(await loadOccasion({ organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID }, { fixtureId: FIXTURE_ID })).toBeNull()
    expect(occasion.value).toMatchObject({ id: FIXTURE_ID, label: 'Spiel gegen TSV Sued' })
    expect(api.request).toHaveBeenCalledWith('/v1/text-workshop/occasion', { query: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, fixtureId: FIXTURE_ID } }, expect.anything())
  })

  it('explains an occasion from another department', async () => {
    const { occasion, loadOccasion } = useScheduleOccasion(apiWith(async () => { throw new ApiRequestError('fixture_not_found_in_department', 404) }))
    expect(await loadOccasion({ organizationId: ORGANIZATION_ID, departmentId: null }, { fixtureId: FIXTURE_ID })).toMatch(/anderen Bereich/)
    expect(occasion.value).toBeNull()
  })

  it('drops a late answer after the occasion was removed', async () => {
    let resolve: (value: unknown) => void = () => {}
    const { occasion, loadOccasion, clearOccasion } = useScheduleOccasion(apiWith(() => new Promise((done) => { resolve = done })))
    const loading = loadOccasion({ organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID }, { fixtureId: FIXTURE_ID })
    clearOccasion()
    resolve(OCCASION)
    await loading
    expect(occasion.value).toBeNull()
  })
})
