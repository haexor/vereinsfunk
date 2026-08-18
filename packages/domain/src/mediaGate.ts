export function createIdempotencyKey(
  kind: 'submission' | 'draft' | 'render' | 'approval' | 'publish',
  ...parts: readonly (string | number)[]
): string {
  if (parts.some((part) => String(part).includes(':'))) {
    throw new Error('Idempotency key parts must not contain colons')
  }
  return [kind, ...parts].join(':')
}

export type MediaGateInput = {
  scanStatus: 'pending' | 'clean' | 'failed'
  // Plan 045, PR 0 Schritt 2: ob der Foto-Anhang ueberhaupt schon auf abgebildete Personen
  // gesichtet wurde (media_assets.people_reviewed_at). Ersetzt das vorherige facesConfirmedComplete,
  // das mit "keine face_regions-Zeile ist noch pending" zu einem einzigen face_pending-Blocker
  // verschmolzen war -- fuer die anzeigende Person ist "Foto ueberhaupt erst sichten" ein anderer
  // naechster Schritt als "eine bereits markierte Box entscheiden", deshalb ein eigener Blocker.
  peopleReviewPending: boolean
  hasOriginalSelected: boolean
  derivativeCurrent: boolean
  faces: readonly {
    subjectKind: 'adult' | 'minor' | 'unknown'
    decision: 'pending' | 'consented' | 'obscure' | 'exclude'
    consentValid?: boolean | undefined
    // Paket 015: die Zeile selbst ist gueltig, deckt aber nicht den angefragten Umfang
    // (Plattform/Medienart/Kontext/Abteilung) ab -- siehe isConsentScopeMismatch in consent.ts.
    consentScopeMismatch?: boolean | undefined
  }[]
  minorReviewConfirmed: boolean
  // Paket 015: Textpruefung (scanTextForSensitiveData in consent.ts) laeuft unabhaengig von
  // Gesichtern -- ein Beitrag ohne jedes Foto kann trotzdem blockiert sein (Plan, "Sensible
  // Angaben im Text, nicht nur im Bild").
  namingNotAllowed?: boolean | undefined
  sensitiveTextData?: boolean | undefined
}

export type MediaGateBlocker =
  | 'scan_pending'
  | 'people_review_pending'
  | 'face_pending'
  | 'consent_invalid'
  | 'derivative_stale'
  | 'minor_review_required'
  | 'original_selected'
  | 'consent_scope_mismatch'
  | 'naming_not_allowed'
  | 'sensitive_text_data'

export function evaluateMediaGate(input: MediaGateInput): { publishable: boolean; blockers: MediaGateBlocker[] } {
  const blockers: MediaGateBlocker[] = []
  if (input.scanStatus !== 'clean') blockers.push('scan_pending')
  if (input.peopleReviewPending) blockers.push('people_review_pending')
  if (input.faces.some((face) => face.decision === 'pending')) blockers.push('face_pending')
  if (input.faces.some((face) => face.decision === 'consented' && !face.consentValid)) blockers.push('consent_invalid')
  if (input.faces.some((face) => face.decision === 'consented' && face.consentScopeMismatch === true)) blockers.push('consent_scope_mismatch')
  if (!input.derivativeCurrent) blockers.push('derivative_stale')
  if (input.hasOriginalSelected) blockers.push('original_selected')
  if (input.faces.some((face) => face.subjectKind === 'minor') && !input.minorReviewConfirmed) blockers.push('minor_review_required')
  if (input.namingNotAllowed) blockers.push('naming_not_allowed')
  if (input.sensitiveTextData) blockers.push('sensitive_text_data')
  return { publishable: blockers.length === 0, blockers }
}
