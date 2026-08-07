import { describe, expect, it } from 'vitest'
import { planSync } from './sync.js'
import type { MatchStrategy, SyncPlanResult } from './types.js'

// Bereichsunabhängige Test-Domänenobjekte -- keine directory_people, das ist eine andere Schicht.
interface LocalPerson {
  id: string
  externalId?: string
  firstName: string
  lastName: string
  birthYear: number | null
  localUpdatedAt?: Date
}

interface ExternalPerson {
  externalId?: string
  firstName: string
  lastName: string
  // undefined = die Quelle liefert dieses Feld nicht (kein Unterschied), null = sie liefert es leer.
  birthYear: number | null | undefined
  sourceUpdatedAt?: Date
  department?: string
}

const knownDepartments = new Set(['Fussball', 'Handball'])

const match: MatchStrategy<LocalPerson, ExternalPerson> = {
  identityOf: (entity) => (entity.externalId ? { externalId: entity.externalId } : { fuzzy: [entity.firstName.toLowerCase(), entity.lastName.toLowerCase()] }),
  externalIdOf: (local) => local.externalId,
  fuzzyKeyOf: (local) => [local.firstName.toLowerCase(), local.lastName.toLowerCase()],
  fieldsOf: (entity) => ({ firstName: entity.firstName, lastName: entity.lastName, birthYear: entity.birthYear }),
  labelOf: (entity) => `${entity.firstName} ${entity.lastName}`,
  sourceUpdatedAtOf: (entity) => entity.sourceUpdatedAt,
  localUpdatedAtOf: (local) => local.localUpdatedAt,
  unknownStructureRefs: (entity) => (entity.department && !knownDepartments.has(entity.department) ? [entity.department] : []),
}

function ok<TLocal, TExternal>(plan: ReturnType<typeof planSync<TLocal, TExternal>>): SyncPlanResult<TLocal, TExternal> {
  expect(plan.aborted).toBe(false)
  if (plan.aborted) throw new Error('unreachable')
  return plan
}

describe('planSync', () => {
  it('creates a record that only exists in incoming', () => {
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing: [],
        incoming: [{ externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: 2010 }],
        match,
        policy: { lossThresholdPercent: 30 },
      }),
    )
    expect(plan.created).toHaveLength(1)
    expect(plan.counts).toMatchObject({ created: 1, updated: 0, retired: 0, skipped: 0, conflicts: 0 })
  })

  it('updates a matched record with a changed field', () => {
    const existing: LocalPerson[] = [{ id: 'local-1', externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: 2010 }]
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing,
        incoming: [{ externalId: 'ext-1', firstName: 'Anna', lastName: 'Becker', birthYear: 2010 }],
        match,
        policy: { lossThresholdPercent: 30 },
      }),
    )
    expect(plan.updated).toHaveLength(1)
    expect(plan.updated[0]?.changedFields).toEqual(['lastName'])
    expect(plan.retired).toHaveLength(0)
  })

  it('retires a record missing from incoming without deleting it', () => {
    const existing: LocalPerson[] = [{ id: 'local-1', externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: 2010 }]
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing,
        incoming: [],
        match,
        policy: { lossThresholdPercent: 100 },
      }),
    )
    expect(plan.retired).toHaveLength(1)
    expect(plan.retired[0]).toBe(existing[0])
    expect(plan.counts.retired).toBe(1)
  })

  it('flags an ambiguous fuzzy match as a conflict instead of guessing', () => {
    const existing: LocalPerson[] = [
      { id: 'local-1', firstName: 'Tom', lastName: 'Meyer', birthYear: 2005 },
      { id: 'local-2', firstName: 'Tom', lastName: 'Meyer', birthYear: 2008 },
    ]
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing,
        incoming: [{ firstName: 'Tom', lastName: 'Meyer', birthYear: 2005 }],
        match,
        policy: { lossThresholdPercent: 100 },
      }),
    )
    expect(plan.created).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.kind).toBe('ambiguous_match')
    expect(plan.conflicts[0]?.candidates).toHaveLength(2)
    // Beide Kandidaten stehen weiterhin in incoming (unter einer von beiden), keiner davon darf
    // als "verschwunden" gelten, nur weil die Zuordnung unklar ist -- sonst waere eine Person
    // gleichzeitig ein offener Konflikt und als ausgetreten markiert.
    expect(plan.retired).toHaveLength(0)
  })

  it('flags even a single fuzzy candidate as a conflict, never an automatic assignment', () => {
    const existing: LocalPerson[] = [{ id: 'local-1', firstName: 'Tom', lastName: 'Meyer', birthYear: 2005 }]
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing,
        incoming: [{ firstName: 'Tom', lastName: 'Meyer', birthYear: 2005 }],
        match,
        policy: { lossThresholdPercent: 100 },
      }),
    )
    expect(plan.created).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.kind).toBe('ambiguous_match')
    expect(plan.conflicts[0]?.candidates).toHaveLength(1)
    expect(plan.retired).toHaveLength(0)
  })

  it('aborts when more than the loss threshold of known records is missing', () => {
    const existing: LocalPerson[] = [
      { id: 'local-1', externalId: 'ext-1', firstName: 'A', lastName: 'A', birthYear: null },
      { id: 'local-2', externalId: 'ext-2', firstName: 'B', lastName: 'B', birthYear: null },
      { id: 'local-3', externalId: 'ext-3', firstName: 'C', lastName: 'C', birthYear: null },
      { id: 'local-4', externalId: 'ext-4', firstName: 'D', lastName: 'D', birthYear: null },
    ]
    // 2 von 4 fehlen (50 %) -- über der Schwelle von 30 %.
    const plan = planSync<LocalPerson, ExternalPerson>({
      existing,
      incoming: [
        { externalId: 'ext-1', firstName: 'A', lastName: 'A', birthYear: null },
        { externalId: 'ext-2', firstName: 'B', lastName: 'B', birthYear: null },
      ],
      match,
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(true)
    if (!plan.aborted) throw new Error('unreachable')
    expect(plan.reason).toBe('loss_threshold_exceeded')
    expect(plan.existingCount).toBe(4)
    expect(plan.missingCount).toBe(2)
  })

  it('never retires a non-retirable record and excludes it from the loss-threshold denominator', () => {
    // Ein Datensatz ohne jede Quellenbindung (z. B. von Hand angelegt) stand nie "in dieser
    // Quelle" -- ein völlig unabhängiger Import, der ihn nicht erwähnt, darf ihn weder als
    // "left" markieren noch als Verlust zählen. Ohne isRetirable wäre das hier ein Totalverlust
    // (1 von 1 fehlt) und der Lauf bräche ab, obwohl der einzige RETIRABLE Datensatz (ext-1)
    // exakt erhalten bleibt.
    const manuallyManaged: LocalPerson = { id: 'local-manual', firstName: 'Mia', lastName: 'Muster', birthYear: null }
    const matchWithRetirability: MatchStrategy<LocalPerson, ExternalPerson> = {
      ...match,
      isRetirable: (local) => local.id !== 'local-manual',
    }
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing: [manuallyManaged, { id: 'local-1', externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: null }],
        incoming: [{ externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: null }],
        match: matchWithRetirability,
        policy: { lossThresholdPercent: 30 },
      }),
    )
    expect(plan.retired).toHaveLength(0)
    expect(plan.skipped).toHaveLength(1)
  })

  it('lets a newer local correction win against an older source update', () => {
    const localUpdatedAt = new Date('2026-08-01T00:00:00Z')
    const sourceUpdatedAt = new Date('2026-07-01T00:00:00Z')
    const existing: LocalPerson[] = [{ id: 'local-1', externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: 2010, localUpdatedAt }]
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing,
        incoming: [{ externalId: 'ext-1', firstName: 'Anna', lastName: 'Becker', birthYear: 2010, sourceUpdatedAt }],
        match,
        policy: { lossThresholdPercent: 30 },
      }),
    )
    expect(plan.updated).toHaveLength(0)
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]?.reason).toBe('local_newer')
    // Der lokale Datensatz selbst bleibt unverändert im Plan -- planSync mutiert nichts.
    expect(plan.skipped[0]?.local.lastName).toBe('Beck')
  })

  it('applies the source update when the local record has no newer local edit', () => {
    const sourceUpdatedAt = new Date('2026-07-01T00:00:00Z')
    const existing: LocalPerson[] = [{ id: 'local-1', externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: 2010 }]
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing,
        incoming: [{ externalId: 'ext-1', firstName: 'Anna', lastName: 'Becker', birthYear: 2010, sourceUpdatedAt }],
        match,
        policy: { lossThresholdPercent: 30 },
      }),
    )
    expect(plan.updated).toHaveLength(1)
    expect(plan.skipped).toHaveLength(0)
  })

  it('creates an unknown_structure conflict for a reference the caller cannot resolve', () => {
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing: [],
        incoming: [{ externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: 2010, department: 'Schach' }],
        match,
        policy: { lossThresholdPercent: 30 },
      }),
    )
    expect(plan.created).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.kind).toBe('unknown_structure')
    expect(plan.conflicts[0]?.reason).toBe('Schach')
  })

  it('reports a repeated externalId as a conflict instead of proposing it twice', () => {
    // Zwei Anlagen mit derselben externen ID liefen in den Unique-Index auf
    // (organization_id, source_id, external_id) und liessen den halb geschriebenen Lauf abbrechen.
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing: [],
        incoming: [
          { externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: 2010 },
          { externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck-Meyer', birthYear: 2010 },
        ],
        match,
        policy: { lossThresholdPercent: 30 },
      }),
    )
    expect(plan.created).toHaveLength(1)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]).toMatchObject({ kind: 'invalid_record', reason: 'duplicate_external_id', externalId: 'ext-1' })
  })

  it('treats a field the source does not carry as "no statement", not as a change', () => {
    const plan = ok(
      planSync<LocalPerson, ExternalPerson>({
        existing: [{ id: 'local-1', externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: 2010 }],
        incoming: [{ externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: undefined }],
        match,
        policy: { lossThresholdPercent: 30 },
      }),
    )
    expect(plan.updated).toHaveLength(0)
    expect(plan.skipped[0]?.reason).toBe('unchanged')
  })

  it('does not mutate the existing or incoming arrays', () => {
    const existing: LocalPerson[] = [{ id: 'local-1', externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck', birthYear: 2010 }]
    const incoming: ExternalPerson[] = [{ externalId: 'ext-1', firstName: 'Anna', lastName: 'Becker', birthYear: 2010 }]
    const existingSnapshot = JSON.parse(JSON.stringify(existing))
    const incomingSnapshot = JSON.parse(JSON.stringify(incoming))
    planSync<LocalPerson, ExternalPerson>({ existing, incoming, match, policy: { lossThresholdPercent: 30 } })
    expect(existing).toEqual(existingSnapshot)
    expect(incoming).toEqual(incomingSnapshot)
  })
})
