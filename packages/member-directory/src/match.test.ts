import { planSync } from '@vereinsfunk/integrations'
import { describe, expect, it } from 'vitest'
import { createPeopleMatchStrategy, type DirectoryPersonLocal } from './match.js'
import { PersonExternalSchema } from './person.js'

const DEPARTMENT_FUSSBALL = '11111111-1111-4111-8111-111111111111'
const TEAM_A = '22222222-2222-4222-8222-222222222222'

function resolver() {
  return {
    resolveDepartmentId: (name: string) => (name === 'Fußball' ? DEPARTMENT_FUSSBALL : undefined),
    resolveTeamId: (departmentId: string, name: string) => (departmentId === DEPARTMENT_FUSSBALL && name === 'Team A' ? TEAM_A : undefined),
  }
}

function localPerson(overrides: Partial<DirectoryPersonLocal> = {}): DirectoryPersonLocal {
  return {
    id: 'local-1',
    externalId: 'ext-1',
    sourceId: 'source-1',
    firstName: 'Anna',
    lastName: 'Beck',
    birthYear: 2010,
    departmentId: DEPARTMENT_FUSSBALL,
    teamId: null,
    status: 'active',
    sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('createPeopleMatchStrategy with planSync', () => {
  it('resolves a known department name and detects a changed field', () => {
    const external = PersonExternalSchema.parse({
      externalId: 'ext-1', firstName: 'Anna', lastName: 'Meyer', departmentName: 'Fußball',
      sourceUpdatedAt: '2026-02-01T00:00:00Z',
    })
    const plan = planSync({
      existing: [localPerson()],
      incoming: [external],
      match: createPeopleMatchStrategy(resolver()),
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.updated).toHaveLength(1)
    expect(plan.updated[0]?.changedFields).toContain('lastName')
  })

  it('resolves a known team once the department is also known', () => {
    const external = PersonExternalSchema.parse({
      externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', departmentName: 'Fußball', teamName: 'Team A',
      sourceUpdatedAt: '2026-02-01T00:00:00Z',
    })
    const plan = planSync({
      existing: [localPerson()],
      incoming: [external],
      match: createPeopleMatchStrategy(resolver()),
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.updated).toHaveLength(1)
    expect(plan.updated[0]?.changedFields).toContain('teamId')
  })

  it('turns an unresolvable department name into an unknown_structure conflict, never a new department', () => {
    const external = PersonExternalSchema.parse({ externalId: 'ext-2', firstName: 'Tom', lastName: 'Neu', departmentName: 'Tischtennis' })
    const plan = planSync({
      existing: [],
      incoming: [external],
      match: createPeopleMatchStrategy(resolver()),
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.kind).toBe('unknown_structure')
    expect(plan.created).toHaveLength(0)
  })

  it('retires a local person missing from the incoming feed without deleting it', () => {
    const plan = planSync({
      existing: [localPerson()],
      incoming: [],
      match: createPeopleMatchStrategy(resolver()),
      policy: { lossThresholdPercent: 100 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.retired).toHaveLength(1)
    expect(plan.retired[0]?.id).toBe('local-1')
  })

  it('never retires a manually managed person (sourceId null), even when absent from the feed', () => {
    // Regression: eine von Hand angelegte Person stand nie "in" irgendeiner Quelle -- ein davon
    // unabhaengiger Import, der sie nicht erwaehnt, darf sie nicht als "left" markieren. Sie bleibt
    // trotzdem in existing, weil sie als unscharfer Abgleichskandidat gegen Duplikate wichtig ist.
    const manuallyManaged = localPerson({ id: 'local-manual', externalId: null, sourceId: null })
    const plan = planSync({
      existing: [manuallyManaged],
      incoming: [],
      match: createPeopleMatchStrategy(resolver()),
      policy: { lossThresholdPercent: 100 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.retired).toHaveLength(0)
  })

  it('a local correction newer than the source wins -- the incoming change is skipped', () => {
    const external = PersonExternalSchema.parse({
      externalId: 'ext-1', firstName: 'Anna', lastName: 'Falschgeschrieben', sourceUpdatedAt: '2020-01-01T00:00:00Z',
    })
    const plan = planSync({
      existing: [localPerson({ updatedAt: new Date('2026-06-01T00:00:00Z'), sourceUpdatedAt: null })],
      incoming: [external],
      match: createPeopleMatchStrategy(resolver()),
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.updated).toHaveLength(0)
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]?.reason).toBe('local_newer')
  })
})
