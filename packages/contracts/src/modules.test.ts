import { describe, expect, it } from 'vitest'
import { CreateSubscriptionPlanRequestSchema, ModuleSelectionSchema, UpdateScopeModulesRequestSchema, UpdateSubscriptionPlanRequestSchema } from './index.js'

const SCOPE_ID = '51000000-1000-4000-8000-000000000001'

describe('module contracts', () => {
  it('distinguishes inherit (null) from "no module" ([])', () => {
    expect(ModuleSelectionSchema.parse(null)).toBeNull()
    expect(ModuleSelectionSchema.parse([])).toEqual([])
  })

  it('rejects unknown and duplicate modules', () => {
    expect(ModuleSelectionSchema.safeParse(['newsletter']).success).toBe(false)
    expect(ModuleSelectionSchema.safeParse(['playerboard', 'playerboard']).success).toBe(false)
  })

  it('requires an explicit selection when updating a scope', () => {
    expect(UpdateScopeModulesRequestSchema.safeParse({ scope: 'department', scopeId: SCOPE_ID }).success).toBe(false)
    expect(UpdateScopeModulesRequestSchema.safeParse({ scope: 'department', scopeId: SCOPE_ID, enabledModules: null }).success).toBe(true)
  })

  it('defaults a new plan to the social media module, like the database column', () => {
    const plan = CreateSubscriptionPlanRequestSchema.parse({
      key: 'verein_basis', displayName: 'Basis', monthlyPriceCents: 0, storageBytes: 1, maxTeams: null, maxDepartments: null,
      contentLimits: [
        { mediaOrigin: 'own_upload', maxPerMonth: null, maxDurationSeconds: null },
        { mediaOrigin: 'ai_image', maxPerMonth: null, maxDurationSeconds: null },
        { mediaOrigin: 'ai_video', maxPerMonth: null, maxDurationSeconds: null },
      ],
    })
    expect(plan.includedModules).toEqual(['social_media'])
    expect(UpdateSubscriptionPlanRequestSchema.safeParse({ includedModules: ['social_media', 'social_media'] }).success).toBe(false)
  })
})
