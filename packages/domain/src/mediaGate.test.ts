import { describe, expect, it } from 'vitest'
import { evaluateMediaGate } from './index.js'

describe('evaluateMediaGate (Paket 015 extension)', () => {
  const basePublishable = {
    scanStatus: 'clean' as const,
    peopleReviewPending: false,
    hasOriginalSelected: false,
    derivativeCurrent: true,
    faces: [],
    minorReviewConfirmed: false,
  }

  it('is publishable with no faces and no text blockers', () => {
    expect(evaluateMediaGate(basePublishable)).toEqual({ publishable: true, blockers: [] })
  })

  it('blocks on people_review_pending, distinct from face_pending', () => {
    const result = evaluateMediaGate({ ...basePublishable, peopleReviewPending: true })
    expect(result).toEqual({ publishable: false, blockers: ['people_review_pending'] })
  })

  it('blocks on face_pending for an undecided face region even once the photo itself was reviewed', () => {
    const result = evaluateMediaGate({ ...basePublishable, faces: [{ subjectKind: 'adult', decision: 'pending' }] })
    expect(result.blockers).toEqual(['face_pending'])
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

