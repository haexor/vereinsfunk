import { describe, expect, it } from 'vitest'
import { evaluateConsent, isConsentRecordInvalid, isConsentScopeMismatch, scanTextForSensitiveData, type ConsentRecordForEvaluation, type ConsentScope, type LinkedPersonForTextScan, type RequiredConsent } from './index.js'

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

