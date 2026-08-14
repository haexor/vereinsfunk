import { describe, expect, it } from 'vitest'
import { mergeEffectiveConfig } from './index.js'
import { baseFields } from './testFixtures.js'

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

  // Plan 044: die Gegenseite zu mergeAllowedList -- ein gesetzter Wert ERSETZT die Vorgabe der
  // aeusseren Ebene komplett, statt sie nur zu verschmaelern (Schnittmenge waere hier falsch: eine
  // Abteilung mit ['facebook'] soll die Vereinsvorgabe ['instagram'] ersetzen koennen, nicht auf
  // die leere Schnittmenge kollabieren).
  it('inherits defaultTargetPlatforms when a level does not set it, distinguishes null from an explicit empty selection, and lets a set value replace rather than narrow', () => {
    const base = { policies: { approvalRequired: false, minorApprovalRequired: false, minimumApprovals: 1, forbiddenTopics: [], ...baseFields, defaultTargetPlatforms: ['instagram'] } }

    const inherited = mergeEffectiveConfig(base, { policies: { defaultTargetPlatforms: null } })
    expect(inherited.policies.defaultTargetPlatforms).toEqual(['instagram'])

    const explicitlyEmpty = mergeEffectiveConfig(base, { policies: { defaultTargetPlatforms: [] } })
    expect(explicitlyEmpty.policies.defaultTargetPlatforms).toEqual([])

    const replaced = mergeEffectiveConfig(base, { policies: { defaultTargetPlatforms: ['facebook'] } })
    expect(replaced.policies.defaultTargetPlatforms).toEqual(['facebook'])
  })

  it('locks consentExpiresOnLeave to true once any level requires it, never back (Paket 015)', () => {
    const base = { policies: { approvalRequired: false, minorApprovalRequired: false, minimumApprovals: 1, forbiddenTopics: [], ...baseFields } }
    const tightened = mergeEffectiveConfig(base, { policies: { consentExpiresOnLeave: true } })
    expect(tightened.policies.consentExpiresOnLeave).toBe(true)
    const attemptToLoosen = mergeEffectiveConfig(tightened, { policies: { consentExpiresOnLeave: false } })
    expect(attemptToLoosen.policies.consentExpiresOnLeave).toBe(true)
  })
})

