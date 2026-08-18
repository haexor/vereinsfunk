export const consentPurposes = ['social_media', 'website', 'print', 'internal'] as const
export type ConsentPurpose = (typeof consentPurposes)[number]

export const consentPlatforms = ['instagram', 'facebook', 'twitter', 'linkedin'] as const
export type ConsentPlatform = (typeof consentPlatforms)[number]

export const consentMediaKinds = ['photo', 'video'] as const
export type ConsentMediaKind = (typeof consentMediaKinds)[number]

export const consentContexts = ['team_photo', 'match', 'training', 'event', 'portrait'] as const
export type ConsentContext = (typeof consentContexts)[number]

export interface ConsentScope {
  purposes: readonly ConsentPurpose[]
  platforms: readonly ConsentPlatform[] | null // null = alle erlaubten
  mediaKinds: readonly ConsentMediaKind[]
  contexts: readonly ConsentContext[] | null // null = alle
  namingAllowed: boolean
  departmentIds: readonly string[] | null // null = vereinsweit
}

export const consentBlockers = [
  'revoked',
  'superseded',
  'not_yet_valid',
  'expired',
  'guardian_missing',
  'purpose_not_covered',
  'platform_not_covered',
  'media_kind_not_covered',
  'context_not_covered',
  'department_not_covered',
  'person_left',
] as const
export type ConsentBlocker = (typeof consentBlockers)[number]

// Diese Gruende betreffen die Zeile selbst (sie gilt aktuell nicht, unabhaengig davon, was
// angefragt wird). Alle anderen Gruende betreffen nur die Deckung des angefragten Umfangs --
// die Zeile ist an sich gueltig, deckt aber diesen einen Fall nicht ab. Die Unterscheidung
// speist zwei unterschiedliche MediaGateBlocker (consent_invalid vs. consent_scope_mismatch).
const RECORD_INVALID_REASONS: ReadonlySet<ConsentBlocker> = new Set([
  'revoked',
  'superseded',
  'not_yet_valid',
  'expired',
  'guardian_missing',
  'person_left',
])

export function isConsentRecordInvalid(reasons: readonly ConsentBlocker[]): boolean {
  return reasons.some((reason) => RECORD_INVALID_REASONS.has(reason))
}

export function isConsentScopeMismatch(reasons: readonly ConsentBlocker[]): boolean {
  return reasons.some((reason) => !RECORD_INVALID_REASONS.has(reason))
}

export interface ConsentRecordForEvaluation {
  guardianConfirmed: boolean
  signerRole: 'self' | 'guardian' | null
  // Heute per API-Guard durchgesetzt (POST /v1/consents, /v1/consent-requests,
  // /v1/consents/:id/supersede lehnen signerRole/recipientRole: 'self' fuer eine minderjaehrige
  // Person ab) -- hier zusaetzlich geprueft, damit ein weiterer Schreibpfad (z. B.
  // origin='imported') sich nicht allein auf den API-Guard verlassen muss (gefunden im Code-Review).
  subjectIsMinor: boolean
  supersededBy: string | null
  revokedAt: string | null
  validFrom: string | null
  validUntil: string | null
  scopeStructured: ConsentScope
  personLeft: boolean
}

export interface RequiredConsent {
  purpose: ConsentPurpose
  platform: ConsentPlatform | null
  mediaKind: ConsentMediaKind
  context: ConsentContext | null
  departmentId: string | null
}

// scope=Freitext bleibt die menschenlesbare Wiedergabe der Erklaerung; scope_structured ist das
// hier geprueft wird (Plan 015, "Fachliches Modell"). Gueltig ist ausschliesslich eine Zeile ohne
// jeden der elf Blocker -- insbesondere eine abgeloeste Zeile (supersededBy gesetzt) ist NIE
// gueltig, selbst wenn sie sonst jede Pruefung bestehen wuerde.
export function evaluateConsent(
  record: ConsentRecordForEvaluation,
  at: Date,
  required: RequiredConsent,
  policy: { consentExpiresOnLeave: boolean },
): { valid: boolean; reasons: readonly ConsentBlocker[] } {
  const reasons: ConsentBlocker[] = []
  if (record.supersededBy !== null) reasons.push('superseded')
  if (record.revokedAt !== null) reasons.push('revoked')
  if (record.validFrom !== null && at < new Date(record.validFrom)) reasons.push('not_yet_valid')
  if (record.validUntil !== null && at > new Date(record.validUntil)) reasons.push('expired')
  if (record.subjectIsMinor && record.signerRole !== 'guardian') reasons.push('guardian_missing')
  else if (record.signerRole === 'guardian' && !record.guardianConfirmed) reasons.push('guardian_missing')
  if (record.personLeft && policy.consentExpiresOnLeave) reasons.push('person_left')

  const scope = record.scopeStructured
  if (!scope.purposes.includes(required.purpose)) reasons.push('purpose_not_covered')
  if (required.platform !== null && scope.platforms !== null && !scope.platforms.includes(required.platform)) {
    reasons.push('platform_not_covered')
  }
  if (!scope.mediaKinds.includes(required.mediaKind)) reasons.push('media_kind_not_covered')
  if (required.context !== null && scope.contexts !== null && !scope.contexts.includes(required.context)) {
    reasons.push('context_not_covered')
  }
  if (
    required.departmentId !== null &&
    scope.departmentIds !== null &&
    !scope.departmentIds.includes(required.departmentId)
  ) {
    reasons.push('department_not_covered')
  }

  return { valid: reasons.length === 0, reasons }
}

export interface LinkedPersonForTextScan {
  firstName: string
  lastName: string
  namingAllowed: boolean
}

export const textScanFindingKinds = ['phone', 'email', 'iban', 'street_address', 'birthdate', 'name'] as const
export type TextScanFindingKind = (typeof textScanFindingKinds)[number]

export interface TextScanFinding {
  kind: TextScanFindingKind
  excerpt: string
}

export interface TextScanResult {
  namingNotAllowed: boolean
  sensitiveTextData: boolean
  findings: readonly TextScanFinding[]
}

// Regelbasiert und deterministisch (Plan 015, "Sensible Angaben im Text"): faelschlich positive
// Treffer sind hinnehmbar, faelschlich negative nicht. Kein Sprachmodell hier -- das setzt
// separat und nur beratend SafetyFlagSchema.sensitive_data (packages/content-engine), blockiert
// aber nichts allein.
const PHONE_PATTERN = /(?:\+49[\s/-]?|0)\d{2,5}[\s/-]?\d{3,10}/g
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const IBAN_PATTERN = /\bDE\d{2}(?:\s?\d{4}){4}(?:\s?\d{2})\b/gi
const STREET_PATTERN = /\b[A-ZÄÖÜ][a-zäöüß]+(?:straße|strasse|weg|allee|platz|gasse)\s?\d{1,4}[a-z]?\b/gi
const BIRTHDATE_PATTERN = /\b(?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.(?:19|20)\d{2}\b/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function scanTextForSensitiveData(
  text: string,
  linkedPersons: readonly LinkedPersonForTextScan[],
): TextScanResult {
  const findings: TextScanFinding[] = []
  const patterns: readonly [TextScanFindingKind, RegExp][] = [
    ['phone', PHONE_PATTERN],
    ['email', EMAIL_PATTERN],
    ['iban', IBAN_PATTERN],
    ['street_address', STREET_PATTERN],
    ['birthdate', BIRTHDATE_PATTERN],
  ]
  for (const [kind, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) findings.push({ kind, excerpt: match[0] })
  }

  // \b kennt nur ASCII-Wortzeichen -- bei einem Namen wie "Öztürk" oder "Weiß" versagt die Grenze
  // am Wortrand, der Treffer bliebe unentdeckt (gefunden im Code-Review). Lookarounds gegen
  // Unicode-Buchstaben/-Ziffern erfassen auch Umlaute und ß als Wortrand.
  let namingNotAllowed = false
  for (const person of linkedPersons) {
    if (person.namingAllowed) continue
    const matchesFirstName = person.firstName.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(person.firstName)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
    const matchesLastName = person.lastName.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(person.lastName)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
    if (matchesFirstName || matchesLastName) {
      namingNotAllowed = true
      findings.push({ kind: 'name', excerpt: `${person.firstName} ${person.lastName}`.trim() })
    }
  }

  return {
    namingNotAllowed,
    sensitiveTextData: findings.some((finding) => finding.kind !== 'name'),
    findings,
  }
}
