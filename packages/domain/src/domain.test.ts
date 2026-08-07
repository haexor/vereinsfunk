import { describe, expect, it } from 'vitest'
import {
  canTransition,
  createIdempotencyKey,
  curatedFontPairings,
  evaluateSubmitPermission,
  mergeEffectiveConfig,
  resolveAvailableChannels,
  resolveReviewers,
  resolveReviewRoute,
  selectProviderConfiguration,
  type ChannelCandidate,
  type LlmProviderConfiguration,
  type StageDefinition,
  type TrustRecord,
} from './index.js'

const baseFields = {
  requiredHashtags: [],
  selfApprovalAllowed: true,
  allowSameReviewerAcrossStages: true,
  mediaRequiresConsentCheck: false,
  allowedPresets: null,
  allowedFormats: null,
  allowedChannelIds: null,
} as const

describe('post state machine', () => {
  it('allows the approval happy path', () => {
    expect(canTransition('awaiting_approval', 'approved')).toBe(true)
  })

  it('prevents publishing an unapproved draft', () => {
    expect(canTransition('draft_ready', 'publishing')).toBe(false)
  })
})

describe('effective config', () => {
  it('allows policies to become stricter but not weaker', () => {
    const base = {
      tone: 'nahbar',
      policies: {
        approvalRequired: true,
        minorApprovalRequired: true,
        minimumApprovals: 1,
        forbiddenTopics: ['Politik'],
        ...baseFields,
      },
    }
    const result = mergeEffectiveConfig(base, {
      tone: 'dynamisch',
      policies: {
        approvalRequired: false,
        minorApprovalRequired: false,
        minimumApprovals: 2,
        forbiddenTopics: ['Alkohol'],
      },
    })
    expect(result.tone).toBe('dynamisch')
    expect(result.policies.approvalRequired).toBe(true)
    expect(result.policies.minimumApprovals).toBe(2)
    expect(result.policies.forbiddenTopics).toEqual(['Politik', 'Alkohol'])
  })

  it('unions requiredHashtags additively across levels', () => {
    const base = { policies: { approvalRequired: false, minorApprovalRequired: false, minimumApprovals: 1, forbiddenTopics: [], ...baseFields, requiredHashtags: ['#svnordstadt'] } }
    const result = mergeEffectiveConfig(base, { policies: { requiredHashtags: ['#fussball'] } })
    expect(result.policies.requiredHashtags).toEqual(['#svnordstadt', '#fussball'])
  })

  it('locks selfApprovalAllowed to false once any level sets it, never back', () => {
    const base = { policies: { approvalRequired: false, minorApprovalRequired: false, minimumApprovals: 1, forbiddenTopics: [], ...baseFields } }
    const tightened = mergeEffectiveConfig(base, { policies: { selfApprovalAllowed: false } })
    expect(tightened.policies.selfApprovalAllowed).toBe(false)
    const attemptToLoosen = mergeEffectiveConfig(tightened, { policies: { selfApprovalAllowed: true } })
    expect(attemptToLoosen.policies.selfApprovalAllowed).toBe(false)
  })

  it('treats null and an unset field as "no restriction on this level" for allowedPresets', () => {
    const base = { policies: { approvalRequired: false, minorApprovalRequired: false, minimumApprovals: 1, forbiddenTopics: [], ...baseFields } }
    const narrowed = mergeEffectiveConfig(base, { policies: { allowedPresets: ['match_result', 'training'] } })
    expect(narrowed.policies.allowedPresets).toEqual(['match_result', 'training'])
    const stillNarrowed = mergeEffectiveConfig(narrowed, { policies: { allowedPresets: null } })
    expect(stillNarrowed.policies.allowedPresets).toEqual(['match_result', 'training'])
  })

  it('intersects allowedPresets, never widens it', () => {
    const base = { policies: { approvalRequired: false, minorApprovalRequired: false, minimumApprovals: 1, forbiddenTopics: [], ...baseFields, allowedPresets: ['match_result', 'training', 'event'] } }
    const result = mergeEffectiveConfig(base, { policies: { allowedPresets: ['training', 'event', 'ballschule'] } })
    expect(result.policies.allowedPresets).toEqual(['training', 'event'])
  })

  it('an empty allowedPresets list means nothing is allowed, distinct from null', () => {
    const base = { policies: { approvalRequired: false, minorApprovalRequired: false, minimumApprovals: 1, forbiddenTopics: [], ...baseFields, allowedPresets: [] as string[] } }
    const result = mergeEffectiveConfig(base, { policies: { allowedPresets: ['training'] } })
    expect(result.policies.allowedPresets).toEqual([])
  })
})

describe('resolveReviewers', () => {
  it('resolves a department_role reference to every member holding that role', () => {
    const result = resolveReviewers(
      [{ kind: 'department_role', departmentId: 'dep-marketing', role: 'approver' }],
      [
        { userId: 'user-1', scope: 'department', departmentId: 'dep-marketing', role: 'approver' },
        { userId: 'user-2', scope: 'department', departmentId: 'dep-marketing', role: 'approver' },
        { userId: 'user-3', scope: 'department', departmentId: 'dep-fussball', role: 'approver' },
      ],
    )
    expect(result.userIds.sort()).toEqual(['user-1', 'user-2'])
    expect(result.unresolved).toEqual([])
  })

  it('reports a reference that resolves to nobody as unresolved', () => {
    const result = resolveReviewers([{ kind: 'organization_role', role: 'social_manager' }], [])
    expect(result.userIds).toEqual([])
    expect(result.unresolved).toHaveLength(1)
  })
})

describe('evaluateSubmitPermission', () => {
  const allow = { hasCreatePermission: true, submitAllowed: true, presetSlug: 'training', requestedFormats: ['feed_image'], allowedPresets: null, allowedFormats: null }

  it('allows when nothing restricts it', () => {
    expect(evaluateSubmitPermission(allow)).toEqual({ allowed: true })
  })

  it('rejects without the base create permission', () => {
    expect(evaluateSubmitPermission({ ...allow, hasCreatePermission: false })).toEqual({ allowed: false, reason: 'missing_permission' })
  })

  it('rejects when the member is not allowed to submit', () => {
    expect(evaluateSubmitPermission({ ...allow, submitAllowed: false })).toEqual({ allowed: false, reason: 'submit_not_allowed' })
  })

  it('rejects a preset outside the allowed list', () => {
    expect(evaluateSubmitPermission({ ...allow, allowedPresets: ['match_result'] })).toEqual({ allowed: false, reason: 'preset_not_allowed' })
  })

  it('rejects a requested format outside the allowed list', () => {
    expect(evaluateSubmitPermission({ ...allow, allowedFormats: ['story'] })).toEqual({ allowed: false, reason: 'format_not_allowed' })
  })
})

// Die drei evaluateQuota-Tests sind mit der Funktion entfernt worden (siehe Kommentar an ihrer
// Stelle in index.ts). Die Kontingentgrenze wird in public.schedule_publication durchgesetzt und
// dort von supabase/tests/policy_review_routes.test.sql geprueft.

describe('resolveReviewRoute', () => {
  const teamStage: StageDefinition = { scope: 'team', scopeTeamId: 'team-ejugend', scopeDepartmentId: 'dep-fussball', label: 'Trainer', mode: 'named', minimumApprovals: 1, reviewerUserIds: ['trainer'] }
  const departmentStage: StageDefinition = { scope: 'department', scopeDepartmentId: 'dep-fussball', label: 'Medienverantwortliche', mode: 'named', minimumApprovals: 1, reviewerUserIds: ['medien'] }
  const organizationStage: StageDefinition = { scope: 'organization', label: 'Marketing', mode: 'named', minimumApprovals: 1, reviewerUserIds: ['marketing'] }
  const author = { userId: 'author' }
  const noMinors = { containsMinors: false }

  function route(stages: readonly StageDefinition[], trust: readonly TrustRecord[], overrides: Partial<{ selfApprovalAllowed: boolean; allowReviewExemptions: boolean; containsMinors: boolean }> = {}) {
    return resolveReviewRoute({
      stages,
      trust,
      author,
      media: { containsMinors: overrides.containsMinors ?? noMinors.containsMinors, reviewerUserIds: ['kinderschutz'] },
      selfApprovalAllowed: overrides.selfApprovalAllowed ?? true,
      allowReviewExemptions: overrides.allowReviewExemptions ?? true,
    })
  }

  it('orders three stages team, department, organization innermost first', () => {
    const result = route([teamStage, departmentStage, organizationStage], [])
    expect(result.stages.map((stage) => stage.scope)).toEqual(['team', 'department', 'organization'])
    expect(result.stages.map((stage) => stage.position)).toEqual([1, 2, 3])
  })

  it('a waiver at team level removes only the team stage', () => {
    const result = route([teamStage, departmentStage, organizationStage], [{ scope: 'team', submitAllowed: true, reviewRequirement: 'waived' }])
    expect(result.stages.map((stage) => stage.scope)).toEqual(['department', 'organization'])
  })

  it('a waiver at organization level removes every stage', () => {
    const result = route([teamStage, departmentStage, organizationStage], [{ scope: 'organization', submitAllowed: true, reviewRequirement: 'waived' }])
    expect(result.stages).toEqual([])
  })

  it('"always" at team level survives an organization-level waiver that would otherwise remove it', () => {
    const result = route(
      [teamStage, departmentStage, organizationStage],
      [
        { scope: 'team', submitAllowed: true, reviewRequirement: 'always' },
        { scope: 'organization', submitAllowed: true, reviewRequirement: 'waived' },
      ],
    )
    // Die Vereinsstufe waived sich selbst UND alles darunter -- nur die "always"-Teamstufe ueberlebt.
    expect(result.stages.map((stage) => stage.scope)).toEqual(['team'])
  })

  it('allowReviewExemptions = false makes every waiver ineffective', () => {
    const result = route(
      [teamStage, departmentStage, organizationStage],
      [{ scope: 'organization', submitAllowed: true, reviewRequirement: 'waived' }],
      { allowReviewExemptions: false },
    )
    expect(result.stages.map((stage) => stage.scope)).toEqual(['team', 'department', 'organization'])
  })

  it('the minor stage survives an organization-wide waiver', () => {
    const result = route([teamStage, departmentStage, organizationStage], [{ scope: 'organization', submitAllowed: true, reviewRequirement: 'waived' }], { containsMinors: true })
    expect(result.stages.some((stage) => stage.isMinorStage)).toBe(true)
  })

  it('inserts the minor stage after department/team stages and before the organization stage', () => {
    const result = route([teamStage, departmentStage, organizationStage], [], { containsMinors: true })
    const minorIndex = result.stages.findIndex((stage) => stage.isMinorStage)
    const orgIndex = result.stages.findIndex((stage) => stage.scope === 'organization' && !stage.isMinorStage)
    expect(minorIndex).toBeGreaterThan(-1)
    expect(minorIndex).toBeLessThan(orgIndex)
  })

  it('removes the author from consideration when selfApprovalAllowed is false, without blocking a stage that has other reviewers', () => {
    const stageWithAuthor: StageDefinition = { ...teamStage, reviewerUserIds: ['author', 'trainer'] }
    const result = route([stageWithAuthor], [], { selfApprovalAllowed: false })
    expect(result.stages).toHaveLength(1)
    expect(result.blockers).toEqual([])
  })

  it('produces a blocker instead of a route when a stage has an empty reviewer pool', () => {
    const emptyStage: StageDefinition = { ...teamStage, reviewerUserIds: [] }
    const result = route([emptyStage], [])
    expect(result.stages).toEqual([])
    expect(result.blockers).toEqual([{ kind: 'empty_reviewer_pool', stageLabel: 'Trainer' }])
  })

  it('produces a blocker when the only reviewer of a stage is the author and self-approval is disallowed', () => {
    const authorOnlyStage: StageDefinition = { ...teamStage, reviewerUserIds: ['author'] }
    const result = route([authorOnlyStage], [], { selfApprovalAllowed: false })
    expect(result.stages).toEqual([])
    expect(result.blockers).toEqual([{ kind: 'only_author_as_reviewer', stageLabel: 'Trainer' }])
  })
})

describe('idempotency keys', () => {
  it('creates deterministic scoped keys', () => {
    expect(createIdempotencyKey('submission', 'abc', 2)).toBe('submission:abc:2')
  })
})

describe('curated font pairings', () => {
  it('matches the organization_brand_profiles column defaults', () => {
    expect(curatedFontPairings.length).toBeGreaterThan(0)
    expect(curatedFontPairings[0]).toMatchObject({ displayFontKey: 'manrope', bodyFontKey: 'dm_sans' })
  })
})

describe('selectProviderConfiguration', () => {
  const config = (overrides: Partial<LlmProviderConfiguration>): LlmProviderConfiguration => ({
    id: 'id',
    protocol: 'anthropic',
    purpose: 'default',
    priority: 100,
    isActive: true,
    ...overrides,
  })

  it('prefers an exact purpose match over the default purpose', () => {
    const configs = [config({ id: 'default', purpose: 'default', priority: 1 }), config({ id: 'caption', purpose: 'caption', priority: 50 })]
    expect(selectProviderConfiguration('caption', configs)?.id).toBe('caption')
  })

  it('falls back to the default purpose when no exact match is active', () => {
    const configs = [
      config({ id: 'inactive-caption', purpose: 'caption', isActive: false }),
      config({ id: 'default', purpose: 'default' }),
    ]
    expect(selectProviderConfiguration('caption', configs)?.id).toBe('default')
  })

  it('orders same-purpose candidates by priority ascending', () => {
    const configs = [config({ id: 'low-priority', priority: 200 }), config({ id: 'high-priority', priority: 10 })]
    expect(selectProviderConfiguration('default', configs)?.id).toBe('high-priority')
  })

  it('ignores inactive configurations', () => {
    const configs = [config({ id: 'inactive', isActive: false, priority: 1 }), config({ id: 'active', priority: 50 })]
    expect(selectProviderConfiguration('default', configs)?.id).toBe('active')
  })

  it('returns null when nothing matches', () => {
    expect(selectProviderConfiguration('caption', [])).toBeNull()
  })
})

describe('resolveAvailableChannels', () => {
  function channel(overrides: Partial<ChannelCandidate> = {}): ChannelCandidate {
    return {
      socialConnectionId: 'connection-1',
      status: 'active',
      archivedAt: null,
      responsibleProfileId: null,
      scopeGrants: [{ scope: 'organization', canSchedule: true }],
      ...overrides,
    }
  }

  it('allows a channel granted at organization scope for a department-scoped post', () => {
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [channel()], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual(['connection-1'])
  })

  it('does not let a department-scope grant cover a different department', () => {
    const candidate = channel({ scopeGrants: [{ scope: 'department', departmentId: 'dep-1', canSchedule: true }] })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-2', channels: [candidate], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual([])
  })

  it('lets a department-scope grant cover one of its own teams', () => {
    const candidate = channel({ scopeGrants: [{ scope: 'department', departmentId: 'dep-1', canSchedule: true }] })
    const result = resolveAvailableChannels({
      scope: 'team', departmentId: 'dep-1', teamId: 'team-1', channels: [candidate], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual(['connection-1'])
  })

  it('does not let a team-scope grant cover the parent department', () => {
    const candidate = channel({ scopeGrants: [{ scope: 'team', departmentId: 'dep-1', teamId: 'team-1', canSchedule: true }] })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [candidate], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual([])
  })

  it('excludes a channel whose grant has can_schedule=false', () => {
    const candidate = channel({ scopeGrants: [{ scope: 'organization', canSchedule: false }] })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [candidate], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual([])
  })

  it('excludes an inactive or archived channel', () => {
    const inactive = channel({ socialConnectionId: 'c-inactive', status: 'action_required' })
    const archived = channel({ socialConnectionId: 'c-archived', archivedAt: '2026-01-01T00:00:00Z' })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [inactive, archived], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual([])
  })

  it('intersects with allowedChannelIds from the effective config', () => {
    const allowed = channel({ socialConnectionId: 'allowed' })
    const notAllowed = channel({ socialConnectionId: 'not-allowed' })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [allowed, notAllowed], allowedChannelIds: ['allowed'], requireChannelResponsible: false,
    })
    expect(result).toEqual(['allowed'])
  })

  it('excludes a channel without a responsible person when the policy requires one', () => {
    const withResponsible = channel({ socialConnectionId: 'has-responsible', responsibleProfileId: 'profile-1' })
    const withoutResponsible = channel({ socialConnectionId: 'no-responsible' })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [withResponsible, withoutResponsible], allowedChannelIds: null, requireChannelResponsible: true,
    })
    expect(result).toEqual(['has-responsible'])
  })
})
