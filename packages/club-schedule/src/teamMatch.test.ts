import { planSync } from '@vereinsfunk/integrations'
import { describe, expect, it } from 'vitest'
import { ExternalTeamSchema } from './team.js'
import { createTeamMatchStrategy, type TeamLocal } from './teamMatch.js'

const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111'

function localTeam(overrides: Partial<TeamLocal> = {}): TeamLocal {
  return {
    id: 'local-1', externalId: 'ext-1', sourceId: 'source-1', name: 'Erste Mannschaft', departmentId: DEPARTMENT_ID,
    ageGroup: null, competition: null, archivedAt: null, sourceUpdatedAt: null, updatedAt: new Date('2026-08-01T00:00:00Z'), ...overrides,
  }
}

describe('createTeamMatchStrategy retirement', () => {
  it('does not count an already archived team as lost again', () => {
    const plan = planSync({
      existing: [localTeam(), localTeam({ id: 'local-2', externalId: 'ext-2', name: 'Alte Herren', archivedAt: new Date('2026-07-01T00:00:00Z') })],
      incoming: [ExternalTeamSchema.parse({ externalId: 'ext-1', name: 'Erste Mannschaft' })],
      match: createTeamMatchStrategy({ resolveDepartmentId: () => undefined }),
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.retired).toHaveLength(0)
  })
})
