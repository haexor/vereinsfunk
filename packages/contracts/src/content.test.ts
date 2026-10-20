import { describe, expect, it } from 'vitest'
import { CreateSubmissionSchema, WorkflowPayloadSchema } from './index.js'
import { department, org, team } from './testFixtures.js'

describe('contracts', () => {
  it('accepts only small ID-based workflow payloads', () => {
    const payload = { entityId: org, organizationId: org, departmentId: department, departmentConcurrencyKey: department, correlationId: team, sourceRevision: 1, purpose: 'render', idempotencyKey: 'render:1' }
    expect(WorkflowPayloadSchema.safeParse(payload).success).toBe(true)
    expect(WorkflowPayloadSchema.safeParse({ ...payload, caption: 'This must never reach Hatchet' }).success).toBe(false)
  })
  it('accepts an organization-level workflow payload (no departmentId, departmentConcurrencyKey="org")', () => {
    const payload = { entityId: org, organizationId: org, departmentConcurrencyKey: 'org', correlationId: team, sourceRevision: 1, purpose: 'render', idempotencyKey: 'render:1' }
    expect(WorkflowPayloadSchema.safeParse(payload).success).toBe(true)
    expect(WorkflowPayloadSchema.safeParse({ ...payload, departmentConcurrencyKey: undefined }).success).toBe(false)
    // Nur 'org' oder eine UUID, wie workflow_outbox_id_only_payload_check in der Datenbank: ein
    // beliebiger String wuerde in concurrencyFor() eine eigene, unbeabsichtigte Lane aufmachen.
    expect(WorkflowPayloadSchema.safeParse({ ...payload, departmentConcurrencyKey: 'organization' }).success).toBe(false)
    expect(WorkflowPayloadSchema.safeParse({ ...payload, departmentConcurrencyKey: '' }).success).toBe(false)
    // start_brand_website_analysis schreibt fuer einen vereinsweiten Lauf die technische
    // Traegerabteilung nach departmentId und trotzdem 'org' als Schluessel -- diese Kombination
    // muss gueltig bleiben, sonst scheitert jeder analyze-website-branding-Lauf auf Vereinsebene.
    expect(WorkflowPayloadSchema.safeParse({ ...payload, departmentId: department }).success).toBe(true)
  })

  it('rejects an invalid tenant boundary', () => {
    expect(() =>
      CreateSubmissionSchema.parse({
        organizationId: 'not-an-id',
        departmentId: department,
        presetSlug: 'event',
        communicationGoal: 'inform',
        requestedFormats: ['feed_image'],
        sourceMaterial: { facts: {}, observations: ['Sommerfest'], quotes: [] },
      }),
    ).toThrow()
  })

  it('applies safe submission defaults', () => {
    const result = CreateSubmissionSchema.parse({
      organizationId: org,
      departmentId: department,
      presetSlug: 'event',
      communicationGoal: 'invite',
      requestedFormats: ['feed_image'],
      sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [] },
    })
    expect(result.priority).toBe(40)
    expect(result.sourceRevision).toBe(1)
  })
})
