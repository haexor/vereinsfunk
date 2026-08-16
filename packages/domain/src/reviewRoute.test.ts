import { describe, expect, it } from 'vitest'
import { evaluateSubmitPermission, resolveReviewRoute, resolveReviewers, type StageDefinition, type TrustRecord } from './index.js'

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

  function route(
    stages: readonly StageDefinition[],
    trust: readonly TrustRecord[],
    overrides: Partial<{
      selfApprovalAllowed: boolean
      allowReviewExemptions: boolean
      containsMinors: boolean
      minorReviewerUserIds: readonly string[]
      authorIsMinor: boolean
      authorMinorReviewerUserIds: readonly string[]
    }> = {},
  ) {
    return resolveReviewRoute({
      stages,
      trust,
      author,
      media: { containsMinors: overrides.containsMinors ?? noMinors.containsMinors, reviewerUserIds: overrides.minorReviewerUserIds ?? ['kinderschutz'] },
      authorMinor: { isMinor: overrides.authorIsMinor ?? false, reviewerUserIds: overrides.authorMinorReviewerUserIds ?? ['erwachsene'] },
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

  // Feste Plattformregel (Nutzerentscheidung 2026-08-16, kein Vereinsschalter): unabhaengig von
  // media.containsMinors -- die verfassende Person selbst ist minderjaehrig, nicht eine abgebildete.
  it('inserts an unwaivable author-minor stage even when no scope requires review and the organization-wide waiver is set', () => {
    const result = route([teamStage, departmentStage, organizationStage], [{ scope: 'organization', submitAllowed: true, reviewRequirement: 'waived' }], { authorIsMinor: true })
    const minorStage = result.stages.find((stage) => stage.isMinorStage)
    expect(minorStage).toBeDefined()
    expect(minorStage?.label).toBe('Minderjährige:r Verfasser:in')
  })

  it('produces two distinct minor stages when the author is a minor and the media also depicts one', () => {
    const result = route([], [], { containsMinors: true, authorIsMinor: true })
    const minorLabels = result.stages.filter((stage) => stage.isMinorStage).map((stage) => stage.label)
    expect(minorLabels).toEqual(['Minderjährigenschutz', 'Minderjährige:r Verfasser:in'])
  })

  it('does not include the author in the author-minor reviewer snapshot when self approval is disallowed', () => {
    const result = route([], [], { selfApprovalAllowed: false, authorIsMinor: true, authorMinorReviewerUserIds: ['author', 'erwachsene'] })
    expect(result.blockers).toEqual([])
    expect(result.stages.find((stage) => stage.isMinorStage)?.reviewerUserIds).toEqual(['erwachsene'])
  })

  it('removes the author from consideration when selfApprovalAllowed is false, without blocking a stage that has other reviewers', () => {
    const stageWithAuthor: StageDefinition = { ...teamStage, reviewerUserIds: ['author', 'trainer'] }
    const result = route([stageWithAuthor], [], { selfApprovalAllowed: false })
    expect(result.stages).toHaveLength(1)
    expect(result.blockers).toEqual([])
    expect(result.stages[0]?.reviewerUserIds).toEqual(['trainer'])
  })

  it('does not include the author in a minor-protection reviewer snapshot when self approval is disallowed', () => {
    const result = route([], [], { selfApprovalAllowed: false, containsMinors: true, minorReviewerUserIds: ['author', 'kinderschutz'] })
    expect(result.blockers).toEqual([])
    expect(result.stages).toHaveLength(1)
    expect(result.stages[0]?.reviewerUserIds).toEqual(['kinderschutz'])
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

