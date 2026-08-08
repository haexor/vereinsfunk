import { describe, expect, it } from 'vitest'
import {
  addDays,
  approvalDurationSecondsSamples,
  BRAND_LOCKABLE_FIELDS,
  canTransition,
  computeCountMetrics,
  computeFunnel,
  computeTrend,
  contrastRatio,
  createIdempotencyKey,
  curatedFonts,
  curatedFontPairings,
  dayWindow,
  evaluateConsent,
  evaluateMediaGate,
  evaluateSubmitPermission,
  findCuratedFont,
  isBrandAssetSelectable,
  isConsentRecordInvalid,
  isConsentScopeMismatch,
  leadTimeSecondsSamples,
  median,
  meetsMinimumContrast,
  mergeEffectiveConfig,
  rangeWindow,
  resolveAvailableChannels,
  resolveBrand,
  resolveReviewers,
  resolveReviewRoute,
  scanTextForSensitiveData,
  selectProviderConfiguration,
  type ChannelCandidate,
  type ConsentRecordForEvaluation,
  type ConsentScope,
  type LinkedPersonForTextScan,
  type LlmProviderConfiguration,
  type RequiredConsent,
  type StageDefinition,
  type TrustRecord,
} from './index.js'

const baseFields = {
  requiredHashtags: [],
  selfApprovalAllowed: true,
  allowSameReviewerAcrossStages: true,
  mediaRequiresConsentCheck: false,
  consentExpiresOnLeave: false,
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

  it('locks consentExpiresOnLeave to true once any level requires it, never back (Paket 015)', () => {
    const base = { policies: { approvalRequired: false, minorApprovalRequired: false, minimumApprovals: 1, forbiddenTopics: [], ...baseFields } }
    const tightened = mergeEffectiveConfig(base, { policies: { consentExpiresOnLeave: true } })
    expect(tightened.policies.consentExpiresOnLeave).toBe(true)
    const attemptToLoosen = mergeEffectiveConfig(tightened, { policies: { consentExpiresOnLeave: false } })
    expect(attemptToLoosen.policies.consentExpiresOnLeave).toBe(true)
  })
})

describe('evaluateConsent (Paket 015)', () => {
  const scope: ConsentScope = {
    purposes: ['social_media'],
    platforms: ['instagram', 'facebook'],
    mediaKinds: ['photo'],
    contexts: ['match'],
    namingAllowed: true,
    departmentIds: null,
  }
  const record: ConsentRecordForEvaluation = {
    guardianConfirmed: true,
    signerRole: 'guardian',
    subjectIsMinor: false,
    supersededBy: null,
    revokedAt: null,
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2026-12-31T23:59:59Z',
    scopeStructured: scope,
    personLeft: false,
  }
  const required: RequiredConsent = {
    purpose: 'social_media',
    platform: 'instagram',
    mediaKind: 'photo',
    context: 'match',
    departmentId: null,
  }
  const noExpiry = { consentExpiresOnLeave: false }

  it('is valid when every check passes', () => {
    const result = evaluateConsent(record, new Date('2026-06-01'), required, noExpiry)
    expect(result).toEqual({ valid: true, reasons: [] })
  })

  it('is never valid once superseded, regardless of every other check passing', () => {
    const superseded = { ...record, supersededBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
    const result = evaluateConsent(superseded, new Date('2026-06-01'), required, noExpiry)
    expect(result.valid).toBe(false)
    expect(result.reasons).toContain('superseded')
  })

  it('flags revoked', () => {
    const revoked = { ...record, revokedAt: '2026-03-01T00:00:00Z' }
    expect(evaluateConsent(revoked, new Date('2026-06-01'), required, noExpiry).reasons).toEqual(['revoked'])
  })

  it('flags not_yet_valid before validFrom', () => {
    expect(evaluateConsent(record, new Date('2025-12-01'), required, noExpiry).reasons).toEqual(['not_yet_valid'])
  })

  it('flags expired after validUntil', () => {
    expect(evaluateConsent(record, new Date('2027-01-15'), required, noExpiry).reasons).toEqual(['expired'])
  })

  it('flags guardian_missing when signed by a guardian without confirmation', () => {
    const unconfirmed = { ...record, guardianConfirmed: false }
    expect(evaluateConsent(unconfirmed, new Date('2026-06-01'), required, noExpiry).reasons).toEqual(['guardian_missing'])
  })

  it('does not flag guardian_missing for a self-signed record', () => {
    const selfSigned = { ...record, signerRole: 'self' as const, guardianConfirmed: false }
    expect(evaluateConsent(selfSigned, new Date('2026-06-01'), required, noExpiry).reasons).toEqual([])
  })

  // Regression: der API-Guard gegen signerRole='self' fuer eine minderjaehrige Person ist keine
  // Garantie fuer jeden kuenftigen Schreibpfad -- die Domain-Schicht selbst muss das durchsetzen.
  it('flags guardian_missing for a self-signed record when the subject is a minor', () => {
    const selfSignedMinor = { ...record, signerRole: 'self' as const, guardianConfirmed: false, subjectIsMinor: true }
    expect(evaluateConsent(selfSignedMinor, new Date('2026-06-01'), required, noExpiry).reasons).toEqual(['guardian_missing'])
  })

  it('flags person_left only when the policy requires it', () => {
    const left = { ...record, personLeft: true }
    expect(evaluateConsent(left, new Date('2026-06-01'), required, noExpiry).reasons).toEqual([])
    expect(evaluateConsent(left, new Date('2026-06-01'), required, { consentExpiresOnLeave: true }).reasons).toEqual(['person_left'])
  })

  it('flags purpose_not_covered', () => {
    const printOnly = { ...required, purpose: 'print' as const }
    expect(evaluateConsent(record, new Date('2026-06-01'), printOnly, noExpiry).reasons).toEqual(['purpose_not_covered'])
  })

  it('flags platform_not_covered when the scope excludes the requested platform', () => {
    const instagramOnly = { ...scope, platforms: ['instagram'] as const }
    const facebookRequired = { ...required, platform: 'facebook' as const }
    expect(evaluateConsent({ ...record, scopeStructured: instagramOnly }, new Date('2026-06-01'), facebookRequired, noExpiry).reasons).toEqual(['platform_not_covered'])
  })

  it('treats platforms: null as every platform allowed', () => {
    const allPlatforms = { ...scope, platforms: null }
    expect(evaluateConsent({ ...record, scopeStructured: allPlatforms }, new Date('2026-06-01'), required, noExpiry).reasons).toEqual([])
  })

  it('flags media_kind_not_covered', () => {
    const videoRequired = { ...required, mediaKind: 'video' as const }
    expect(evaluateConsent(record, new Date('2026-06-01'), videoRequired, noExpiry).reasons).toEqual(['media_kind_not_covered'])
  })

  it('flags context_not_covered', () => {
    const trainingRequired = { ...required, context: 'training' as const }
    expect(evaluateConsent(record, new Date('2026-06-01'), trainingRequired, noExpiry).reasons).toEqual(['context_not_covered'])
  })

  it('flags department_not_covered when the scope is limited to other departments', () => {
    const limited = { ...scope, departmentIds: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'] }
    const otherDepartment = { ...required, departmentId: '22222222-2222-4222-8222-222222222222' }
    expect(evaluateConsent({ ...record, scopeStructured: limited }, new Date('2026-06-01'), otherDepartment, noExpiry).reasons).toEqual(['department_not_covered'])
  })

  it('a superseding record with a narrower scope blocks even though it would otherwise be valid', () => {
    // Die Nachfolgerzeile selbst hat keinen supersededBy -- ihr eigener, engerer Umfang blockiert.
    const narrower = { ...scope, platforms: ['facebook'] as const }
    const successor = { ...record, scopeStructured: narrower }
    const instagramRequired = { ...required, platform: 'instagram' as const }
    expect(evaluateConsent(successor, new Date('2026-06-01'), instagramRequired, noExpiry).valid).toBe(false)
  })
})

describe('isConsentRecordInvalid / isConsentScopeMismatch (Paket 015)', () => {
  it('classifies record-validity reasons as record-invalid, not scope-mismatch', () => {
    expect(isConsentRecordInvalid(['revoked'])).toBe(true)
    expect(isConsentScopeMismatch(['revoked'])).toBe(false)
  })

  it('classifies coverage reasons as scope-mismatch, not record-invalid', () => {
    expect(isConsentRecordInvalid(['platform_not_covered'])).toBe(false)
    expect(isConsentScopeMismatch(['platform_not_covered'])).toBe(true)
  })

  it('an empty reason list is neither', () => {
    expect(isConsentRecordInvalid([])).toBe(false)
    expect(isConsentScopeMismatch([])).toBe(false)
  })
})

describe('scanTextForSensitiveData (Paket 015)', () => {
  const lisa: LinkedPersonForTextScan = { firstName: 'Lisa', lastName: 'Meier', namingAllowed: false }

  it('finds no naming and no sensitive data in a clean text', () => {
    const result = scanTextForSensitiveData('Tolles Spiel am Samstag, Endstand 3:1.', [lisa])
    expect(result).toEqual({ namingNotAllowed: false, sensitiveTextData: false, findings: [] })
  })

  it('flags a linked person\'s first name when naming is not allowed, without any photo involved', () => {
    const result = scanTextForSensitiveData('Lisa (11) erzielte das Siegtor.', [lisa])
    expect(result.namingNotAllowed).toBe(true)
    expect(result.sensitiveTextData).toBe(false)
    expect(result.findings).toEqual([{ kind: 'name', excerpt: 'Lisa Meier' }])
  })

  it('does not flag a name when namingAllowed is true', () => {
    const result = scanTextForSensitiveData('Lisa erzielte das Siegtor.', [{ ...lisa, namingAllowed: true }])
    expect(result.namingNotAllowed).toBe(false)
  })

  it('flags a name with umlauts at the word boundary', () => {
    const person: LinkedPersonForTextScan = { firstName: 'Ayla', lastName: 'Öztürk', namingAllowed: false }
    const result = scanTextForSensitiveData('Das Tor erzielte Öztürk kurz vor Schluss.', [person])
    expect(result.namingNotAllowed).toBe(true)
  })

  it('detects a phone number', () => {
    const result = scanTextForSensitiveData('Rueckfragen bitte an 0151 23456789.', [])
    expect(result.sensitiveTextData).toBe(true)
    expect(result.findings.some((finding) => finding.kind === 'phone')).toBe(true)
  })

  it('detects an email address', () => {
    const result = scanTextForSensitiveData('Kontakt: vorstand@sv-nordstadt.de', [])
    expect(result.findings.some((finding) => finding.kind === 'email')).toBe(true)
  })

  it('detects an IBAN', () => {
    const result = scanTextForSensitiveData('Spenden an DE89 3704 0044 0532 0130 00.', [])
    expect(result.findings.some((finding) => finding.kind === 'iban')).toBe(true)
  })

  it('detects a street address with house number', () => {
    const result = scanTextForSensitiveData('Treffpunkt ist die Hauptstraße 12.', [])
    expect(result.findings.some((finding) => finding.kind === 'street_address')).toBe(true)
  })

  it('detects a birthdate', () => {
    const result = scanTextForSensitiveData('Geboren am 03.04.2015.', [])
    expect(result.findings.some((finding) => finding.kind === 'birthdate')).toBe(true)
  })
})

describe('evaluateMediaGate (Paket 015 extension)', () => {
  const basePublishable = {
    scanStatus: 'clean' as const,
    facesConfirmedComplete: true,
    hasOriginalSelected: false,
    derivativeCurrent: true,
    faces: [],
    minorReviewConfirmed: false,
  }

  it('is publishable with no faces and no text blockers', () => {
    expect(evaluateMediaGate(basePublishable)).toEqual({ publishable: true, blockers: [] })
  })

  it('blocks on naming_not_allowed even without any face', () => {
    const result = evaluateMediaGate({ ...basePublishable, namingNotAllowed: true })
    expect(result.publishable).toBe(false)
    expect(result.blockers).toEqual(['naming_not_allowed'])
  })

  it('blocks on sensitive_text_data even without any face', () => {
    const result = evaluateMediaGate({ ...basePublishable, sensitiveTextData: true })
    expect(result.blockers).toEqual(['sensitive_text_data'])
  })

  it('blocks on consent_scope_mismatch for a consented face whose consent does not cover the request', () => {
    const result = evaluateMediaGate({
      ...basePublishable,
      faces: [{ subjectKind: 'adult', decision: 'consented', consentValid: true, consentScopeMismatch: true }],
    })
    expect(result.blockers).toEqual(['consent_scope_mismatch'])
  })

  it('still blocks on consent_invalid exactly as before this package (backward compatible)', () => {
    const result = evaluateMediaGate({
      ...basePublishable,
      faces: [{ subjectKind: 'adult', decision: 'consented', consentValid: false }],
    })
    expect(result.blockers).toEqual(['consent_invalid'])
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

  it('every pairing references two curated fonts that actually exist in the registry', () => {
    for (const pairing of curatedFontPairings) {
      expect(findCuratedFont(pairing.displayFontKey)).toBeDefined()
      expect(findCuratedFont(pairing.bodyFontKey)).toBeDefined()
    }
  })

  it('returns undefined for an unknown font key', () => {
    expect(findCuratedFont('does-not-exist')).toBeUndefined()
  })

  it('every curated font ships at least one weight', () => {
    for (const font of curatedFonts) expect(font.weights.length).toBeGreaterThan(0)
  })
})

describe('contrast', () => {
  it('rates black on white at the maximum ratio of 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('is symmetric regardless of argument order', () => {
    expect(contrastRatio('#163a2c', '#f6f4ec')).toBeCloseTo(contrastRatio('#f6f4ec', '#163a2c'), 5)
  })

  it('flags a known low-contrast pairing as failing AA', () => {
    expect(meetsMinimumContrast('#caff4a', '#f6f4ec').meetsAA).toBe(false)
  })

  it('accepts a known high-contrast pairing', () => {
    expect(meetsMinimumContrast('#122820', '#f6f4ec').meetsAA).toBe(true)
  })
})

describe('resolveBrand', () => {
  const organization = {
    primaryColor: '#163a2c',
    accentColor: '#caff4a',
    allowDepartmentOverrides: true,
    lockedFields: [],
  }

  it('falls back to the organization defaults when no department or team overrides exist', () => {
    const resolved = resolveBrand(organization)
    expect(resolved.primaryColor).toBe('#163a2c')
    expect(resolved.displayFontKey).toBe('manrope')
  })

  it('lets a department override a field the organization has not locked', () => {
    const department = { primaryColor: '#112233', allowTeamOverrides: true, lockedFields: [] }
    expect(resolveBrand(organization, department).primaryColor).toBe('#112233')
  })

  it('a field the organization locks cannot be overridden by the department', () => {
    const locked = { ...organization, lockedFields: ['primaryColor'] }
    const department = { primaryColor: '#112233', allowTeamOverrides: true, lockedFields: [] }
    expect(resolveBrand(locked, department).primaryColor).toBe('#163a2c')
  })

  it('allowDepartmentOverrides=false blocks the department entirely, regardless of lockedFields', () => {
    const noOverrides = { ...organization, allowDepartmentOverrides: false }
    const department = { primaryColor: '#112233', allowTeamOverrides: true, lockedFields: [] }
    expect(resolveBrand(noOverrides, department).primaryColor).toBe('#163a2c')
  })

  it('a team inherits from the department, not directly from the organization, once the department deviates', () => {
    const department = { primaryColor: '#112233', allowTeamOverrides: true, lockedFields: [] }
    const team = {}
    expect(resolveBrand(organization, department, team).primaryColor).toBe('#112233')
  })

  it('a team can override a field the department left untouched', () => {
    const department = { accentColor: '#445566', allowTeamOverrides: true, lockedFields: [] }
    const team = { primaryColor: '#778899' }
    const resolved = resolveBrand(organization, department, team)
    expect(resolved.primaryColor).toBe('#778899')
    expect(resolved.accentColor).toBe('#445566')
  })

  it('an organization-level lock propagates to the team even if the department does not repeat it', () => {
    const locked = { ...organization, lockedFields: ['primaryColor'] }
    const department = { allowTeamOverrides: true, lockedFields: [] }
    const team = { primaryColor: '#000000' }
    expect(resolveBrand(locked, department, team).primaryColor).toBe('#163a2c')
  })

  it('a department that may not deviate cannot open the door for its teams either', () => {
    const noOverrides = { ...organization, allowDepartmentOverrides: false }
    const department = { allowTeamOverrides: true, lockedFields: [] }
    const team = { primaryColor: '#000000' }
    expect(resolveBrand(noOverrides, department, team).primaryColor).toBe('#163a2c')
  })

  it('a department cannot override a color role the organization alone controls', () => {
    // backgroundColor/textColor/onPrimaryColor und die kuratierten Schriftschluessel haben auf
    // den unteren Ebenen keine Spalte -- BRAND_LOCKABLE_FIELDS bildet genau das ab.
    const department = { backgroundColor: '#000000', allowTeamOverrides: true, lockedFields: [] } as never
    expect(resolveBrand(organization, department).backgroundColor).toBe('#f6f4ec')
  })

  it('exposes exactly the fields a department or team can actually carry', () => {
    expect([...BRAND_LOCKABLE_FIELDS]).toEqual(['primaryColor', 'accentColor', 'tone', 'logoAssetId', 'displayFontAssetId', 'bodyFontAssetId'])
  })
})

describe('relativeLuminance input validation', () => {
  it('rejects a short hex form instead of returning NaN', () => {
    expect(() => contrastRatio('#abc', '#ffffff')).toThrow(/invalid hex color/)
  })

  it('rejects a half-typed color instead of returning NaN', () => {
    expect(() => meetsMinimumContrast('#12', '#ffffff')).toThrow(/invalid hex color/)
  })
})

describe('isBrandAssetSelectable', () => {
  it('an organization-wide asset is selectable everywhere', () => {
    expect(isBrandAssetSelectable({ scope: 'organization' }, 'team', 'dept-1', 'team-1')).toBe(true)
  })

  it('a department asset is selectable within its own department and its teams, not a sibling department', () => {
    const asset = { scope: 'department' as const, departmentId: 'dept-1' }
    expect(isBrandAssetSelectable(asset, 'team', 'dept-1', 'team-1')).toBe(true)
    expect(isBrandAssetSelectable(asset, 'department', 'dept-2')).toBe(false)
  })

  it('a team asset is selectable only for that exact team', () => {
    const asset = { scope: 'team' as const, departmentId: 'dept-1', teamId: 'team-1' }
    expect(isBrandAssetSelectable(asset, 'team', 'dept-1', 'team-1')).toBe(true)
    expect(isBrandAssetSelectable(asset, 'team', 'dept-1', 'team-2')).toBe(false)
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

describe('metrics (Paket 016)', () => {
  describe('dayWindow', () => {
    it('resolves midnight-to-midnight in the club timezone, not UTC', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      // CEST ist im August UTC+2 -- lokale Mitternacht liegt zwei Stunden vor UTC-Mitternacht.
      expect(window).toEqual({ startUtc: '2026-08-09T22:00:00.000Z', endUtc: '2026-08-10T22:00:00.000Z' })
    })

    it('accounts for the CET-to-CEST spring-forward transition -- the day has only 23 hours', () => {
      const window = dayWindow('2026-03-29', 'Europe/Berlin')
      expect(window).toEqual({ startUtc: '2026-03-28T23:00:00.000Z', endUtc: '2026-03-29T22:00:00.000Z' })
      const hours = (new Date(window.endUtc).getTime() - new Date(window.startUtc).getTime()) / 3_600_000
      expect(hours).toBe(23)
    })
  })

  describe('addDays', () => {
    it('rolls over into the next month', () => {
      expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    })

    it('rolls over into the next year', () => {
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    })
  })

  describe('rangeWindow', () => {
    it('spans from the start of the first day to the start of the (exclusive) end day', () => {
      expect(rangeWindow('2026-08-01', '2026-08-08', 'Europe/Berlin')).toEqual({
        startUtc: '2026-07-31T22:00:00.000Z',
        endUtc: '2026-08-07T22:00:00.000Z',
      })
    })
  })

  describe('median', () => {
    it('averages the two middle values for an even count', () => {
      expect(median([10, 30, 20, 40])).toBe(25)
    })

    it('returns the middle value for an odd count', () => {
      expect(median([5, 1, 3])).toBe(3)
    })

    it('returns null for an empty sample', () => {
      expect(median([])).toBeNull()
    })
  })

  describe('computeTrend', () => {
    it('returns null when there is no previous value (incomplete previous period)', () => {
      expect(computeTrend(10, null)).toBeNull()
    })

    it('returns null when the previous value is zero -- a percentage cannot be expressed', () => {
      expect(computeTrend(10, 0)).toBeNull()
    })

    it('computes a positive relative change', () => {
      expect(computeTrend(120, 100)).toBeCloseTo(0.2)
    })

    it('computes a negative relative change', () => {
      expect(computeTrend(80, 100)).toBeCloseTo(-0.2)
    })
  })

  describe('computeCountMetrics', () => {
    const window = dayWindow('2026-08-10', 'Europe/Berlin')
    const outsideWindow = '2026-08-01T10:00:00.000Z'
    const insideWindow = '2026-08-10T10:00:00.000Z'

    it('counts posts created in the window and ignores posts created outside it', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [{ id: 'p1', createdAt: insideWindow }, { id: 'p2', createdAt: outsideWindow }],
        publishedTransitions: [], approvalDecisions: [], publications: [], workflowRuns: [], postVersions: [],
      })
      expect(result.postsCreated).toBe(1)
    })

    it('counts a post as published only on the day of its FIRST published transition, not on a later re-publish', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [],
        publishedTransitions: [
          { postId: 'p1', occurredAt: insideWindow },
          { postId: 'p1', occurredAt: '2026-08-11T10:00:00.000Z' }, // erneut veroeffentlicht -- zaehlt nicht nochmal
        ],
        approvalDecisions: [], publications: [], workflowRuns: [], postVersions: [],
      })
      expect(result.postsPublished).toBe(1)
    })

    it('counts a single post published on two channels as one post but two publications', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [],
        publishedTransitions: [{ postId: 'p1', occurredAt: insideWindow }],
        approvalDecisions: [],
        publications: [
          { status: 'published', updatedAt: insideWindow },
          { status: 'published', updatedAt: insideWindow },
        ],
        workflowRuns: [], postVersions: [],
      })
      expect(result.postsPublished).toBe(1)
      expect(result.publicationsPublished).toBe(2)
    })

    it('counts approval decisions by type within the window', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [], publishedTransitions: [],
        approvalDecisions: [
          { decision: 'approved', createdAt: insideWindow },
          { decision: 'approved', createdAt: insideWindow },
          { decision: 'changes_requested', createdAt: insideWindow },
          { decision: 'rejected', createdAt: outsideWindow },
        ],
        publications: [], workflowRuns: [], postVersions: [],
      })
      expect(result.approvalsGranted).toBe(2)
      expect(result.approvalsChangesRequested).toBe(1)
      expect(result.approvalsRejected).toBe(0)
    })

    it('sums revisions (max version_number) only for posts published within the window, as sum+count not a pre-averaged mean', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [],
        publishedTransitions: [{ postId: 'p1', occurredAt: insideWindow }, { postId: 'p2', occurredAt: outsideWindow }],
        approvalDecisions: [], publications: [], workflowRuns: [],
        postVersions: [
          { postId: 'p1', versionNumber: 1 }, { postId: 'p1', versionNumber: 2 }, { postId: 'p1', versionNumber: 3 },
          { postId: 'p2', versionNumber: 1 }, { postId: 'p2', versionNumber: 5 },
        ],
      })
      // p2 wurde ausserhalb des Fensters veroeffentlicht und darf die Summe nicht beeinflussen.
      expect(result.revisionsSum).toBe(3)
      expect(result.revisionsCount).toBe(1)
    })

    it('counts workflow runs and failures within the window', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [], publishedTransitions: [], approvalDecisions: [], publications: [], postVersions: [],
        workflowRuns: [
          { technicalStatus: 'succeeded', updatedAt: insideWindow },
          { technicalStatus: 'failed', updatedAt: insideWindow },
          { technicalStatus: 'failed', updatedAt: outsideWindow },
        ],
      })
      expect(result.workflowRuns).toBe(2)
      expect(result.workflowFailures).toBe(1)
    })
  })

  describe('leadTimeSecondsSamples', () => {
    it('computes the duration from post creation to the first published transition', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const samples = leadTimeSecondsSamples(
        window,
        [{ id: 'p1', createdAt: '2026-08-09T10:00:00.000Z' }],
        [{ postId: 'p1', occurredAt: '2026-08-10T10:00:00.000Z' }],
      )
      expect(samples).toEqual([86_400])
    })

    it('ignores a post whose first published transition falls outside the window', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const samples = leadTimeSecondsSamples(
        window,
        [{ id: 'p1', createdAt: '2026-08-01T10:00:00.000Z' }],
        [{ postId: 'p1', occurredAt: '2026-08-01T11:00:00.000Z' }],
      )
      expect(samples).toEqual([])
    })
  })

  describe('approvalDurationSecondsSamples', () => {
    it('pairs an awaiting_approval transition with the next resolution of the same post', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const samples = approvalDurationSecondsSamples(window, [
        { postId: 'p1', toStatus: 'awaiting_approval', occurredAt: '2026-08-10T09:00:00.000Z' },
        { postId: 'p1', toStatus: 'approved', occurredAt: '2026-08-10T11:00:00.000Z' },
      ])
      expect(samples).toEqual([7_200])
    })

    it('opens a new pair after changes_requested -- a re-submitted post is measured again, not conflated with the first round', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const samples = approvalDurationSecondsSamples(window, [
        { postId: 'p1', toStatus: 'awaiting_approval', occurredAt: '2026-08-09T09:00:00.000Z' },
        { postId: 'p1', toStatus: 'changes_requested', occurredAt: '2026-08-09T10:00:00.000Z' },
        { postId: 'p1', toStatus: 'awaiting_approval', occurredAt: '2026-08-10T09:00:00.000Z' },
        { postId: 'p1', toStatus: 'approved', occurredAt: '2026-08-10T10:00:00.000Z' },
      ])
      // nur das zweite Paar faellt in das Fenster vom 10.8.
      expect(samples).toEqual([3_600])
    })
  })

  describe('computeFunnel', () => {
    it('counts each stage once per post, at its first transition within the window', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const posts = [{ id: 'p1', createdAt: '2026-08-10T08:00:00.000Z' }, { id: 'p2', createdAt: '2026-08-10T09:00:00.000Z' }]
      const transitions = [
        { postId: 'p1', toStatus: 'awaiting_approval', occurredAt: '2026-08-10T09:00:00.000Z' },
        { postId: 'p1', toStatus: 'approved', occurredAt: '2026-08-10T10:00:00.000Z' },
        { postId: 'p1', toStatus: 'scheduled', occurredAt: '2026-08-10T10:30:00.000Z' },
        { postId: 'p1', toStatus: 'published', occurredAt: '2026-08-10T11:00:00.000Z' },
      ]
      expect(computeFunnel(window, posts, transitions)).toEqual([
        { stage: 'draft', count: 2 },
        { stage: 'approval_requested', count: 1 },
        { stage: 'approved', count: 1 },
        { stage: 'scheduled', count: 1 },
        { stage: 'published', count: 1 },
      ])
    })
  })
})
