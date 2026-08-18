import {
  evaluateConsent,
  evaluateMediaGate,
  isConsentRecordInvalid,
  isConsentScopeMismatch,
  scanTextForSensitiveData,
  type MediaGateBlocker,
} from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CONSENT_RECORD_SELECT, type ConsentRecordRow } from '../routes/shared.js'

// Fuer freigaben.vue ("wartet auf mich") und die Detailansicht: Faltet post_media ->
// media_derivatives -> media_assets -> face_regions -> consent_records zusammen und ruft
// evaluateConsent je Gesicht auf. Bekannte, dokumentierte Grenze: verknuepfte Personen fuer die
// Namensprüfung kommen ausschliesslich aus einwilligungsgeprueften Gesichtern der Medien dieses
// Beitrags -- ein rein textlicher Beitrag ohne jedes Foto einer Person kann diese Person nicht
// als "verknuepft" kennen (siehe plans/015, "Umsetzung: Ergebnis und Abweichungen").
// minorReviewConfirmed ist bewusst konservativ immer false: ein eigenes, freigabestufenbasiertes
// Minderjaehrigenschutz existiert bereits seit Paket 011 (is_minor_stage) und bleibt die
// eigentliche Durchsetzung; dieser Blocker ist eine zusaetzliche, informative Erinnerung.
//
// client MUSS der Service-Client sein (beide Aufrufer tun das). Ueber einen Nutzer-Client ist diese
// Funktion still fail-open, nicht bloss unvollstaendig: post_media/media_derivatives/consent_records
// verlangen per RLS is_organization_member und directory_people zusaetzlich 'directory.read' -- fehlt
// eines davon, kommen leere Zeilen zurueck, aus denen scanStatus 'clean', subjectIsMinor false und
// personLeft false abgeleitet werden. Das Ergebnis ist dann eine leere Blockerliste, die aussieht
// wie "nichts zu beanstanden" (gefunden im Code-Review zu Paket 002).
export async function computeMediaGateBlockersForPostVersion(
  client: SupabaseClient, postVersionId: string, departmentId: string, policy: { consentExpiresOnLeave: boolean },
): Promise<MediaGateBlocker[]> {
  const postVersion = await client.from('post_versions').select('title, caption').eq('id', postVersionId).maybeSingle()
  if (postVersion.error) throw postVersion.error
  if (!postVersion.data) return []

  const postMedia = await client.from('post_media').select('media_derivative_id').eq('post_version_id', postVersionId)
  if (postMedia.error) throw postMedia.error
  const derivativeIds = postMedia.data.map((row) => row.media_derivative_id as string)

  if (derivativeIds.length === 0) {
    const scan = scanTextForSensitiveData(`${postVersion.data.title as string} ${postVersion.data.caption as string}`, [])
    return evaluateMediaGate({
      scanStatus: 'clean', peopleReviewPending: false, hasOriginalSelected: false, derivativeCurrent: true,
      faces: [], minorReviewConfirmed: false, namingNotAllowed: scan.namingNotAllowed, sensitiveTextData: scan.sensitiveTextData,
    }).blockers
  }

  const derivatives = await client.from('media_derivatives').select('id, media_asset_id, status').in('id', derivativeIds)
  if (derivatives.error) throw derivatives.error
  const assetIds = Array.from(new Set(derivatives.data.map((row) => row.media_asset_id as string)))
  const [assets, faces] = await Promise.all([
    client.from('media_assets').select('id, mime_type, scan_status, people_reviewed_at').in('id', assetIds),
    client.from('face_regions').select('media_asset_id, subject_kind, decision, consent_record_id').in('media_asset_id', assetIds),
  ])
  if (assets.error) throw assets.error
  if (faces.error) throw faces.error

  const consentRecordIds = Array.from(new Set(faces.data.map((face) => face.consent_record_id as string | null).filter((id): id is string => id !== null)))
  const consents = consentRecordIds.length > 0
    ? await client.from('consent_records').select(CONSENT_RECORD_SELECT).in('id', consentRecordIds)
    : { data: [] as ConsentRecordRow[], error: null as null }
  if (consents.error) throw consents.error
  const consentById = new Map((consents.data as ConsentRecordRow[]).map((row) => [row.id, row]))

  const directoryPersonIds = Array.from(
    new Set((consents.data as ConsentRecordRow[]).map((row) => row.directory_person_id).filter((id): id is string => id !== null)),
  )
  const people = directoryPersonIds.length > 0
    ? await client.from('directory_people').select('id, first_name, last_name, status, is_minor').in('id', directoryPersonIds)
    : { data: [] as { id: string; first_name: string; last_name: string; status: string; is_minor: boolean }[], error: null as null }
  if (people.error) throw people.error
  const personById = new Map(people.data.map((row) => [row.id, row]))

  const now = new Date()
  const mediaKindByAssetId = new Map(
    assets.data.map((row) => [row.id as string, (row.mime_type as string).startsWith('video/') ? ('video' as const) : ('photo' as const)]),
  )

  const faceInputs = faces.data.map((face) => {
    const consent = face.consent_record_id ? consentById.get(face.consent_record_id as string) : undefined
    let consentValid: boolean | undefined
    let consentScopeMismatch: boolean | undefined
    if (face.decision === 'consented' && consent) {
      const person = consent.directory_person_id ? personById.get(consent.directory_person_id) : undefined
      const evaluation = evaluateConsent(
        {
          guardianConfirmed: consent.guardian_confirmed, signerRole: consent.signer_role, supersededBy: consent.superseded_by,
          revokedAt: consent.revoked_at, validFrom: consent.valid_from, validUntil: consent.valid_until,
          scopeStructured: consent.scope_structured, personLeft: person?.status === 'left',
          subjectIsMinor: person?.is_minor ?? false,
        },
        now,
        {
          purpose: 'social_media', platform: null,
          mediaKind: mediaKindByAssetId.get(face.media_asset_id as string) ?? 'photo',
          context: null, departmentId,
        },
        policy,
      )
      consentValid = !isConsentRecordInvalid(evaluation.reasons)
      consentScopeMismatch = isConsentScopeMismatch(evaluation.reasons)
    }
    return {
      subjectKind: face.subject_kind as 'adult' | 'minor' | 'unknown',
      decision: face.decision as 'pending' | 'consented' | 'obscure' | 'exclude',
      consentValid, consentScopeMismatch,
    }
  })

  const linkedPersons = Array.from(personById.values()).map((person) => {
    // Nur nicht widerrufene und nicht abgeloeste Einwilligungen zaehlen, und bei mehreren
    // Treffern die restriktivste Bewertung -- find() waehlte bislang die erste Zeile in
    // Einfuegereihenfolge, eine abgeloeste Einwilligung mit namingAllowed:true haette dann
    // eine neuere mit namingAllowed:false ueberstimmen koennen.
    const consents = Array.from(consentById.values()).filter(
      (row) => row.directory_person_id === person.id && row.revoked_at === null && row.superseded_by === null,
    )
    const namingAllowed = consents.length > 0 && consents.every((row) => row.scope_structured.namingAllowed === true)
    return { firstName: person.first_name, lastName: person.last_name, namingAllowed }
  })
  const scan = scanTextForSensitiveData(`${postVersion.data.title as string} ${postVersion.data.caption as string}`, linkedPersons)

  const scanStatus: 'clean' | 'pending' | 'failed' = assets.data.some((row) => row.scan_status === 'failed')
    ? 'failed'
    : assets.data.every((row) => row.scan_status === 'clean')
      ? 'clean'
      : 'pending'
  const derivativeCurrent = derivatives.data.every((row) => row.status === 'ready')
  // Plan 045, PR 0 Schritt 2: people_reviewed_at is null statt der vorherigen Konstante true.
  const peopleReviewPending = assets.data.some((row) => row.people_reviewed_at == null)

  return evaluateMediaGate({
    scanStatus, peopleReviewPending, hasOriginalSelected: false, derivativeCurrent,
    faces: faceInputs, minorReviewConfirmed: false, namingNotAllowed: scan.namingNotAllowed, sensitiveTextData: scan.sensitiveTextData,
  }).blockers
}

// Paket 002: dieselbe konservative Teilmenge, die schedule_publication (2026081107) als echte,
// per Grant direkt erreichbare Durchsetzungsgrenze in SQL nachbildet -- keine Verdopplung der
// Rechtslogik, nur derselbe Filter zweimal angewendet. minor_review_required bleibt aussen vor
// (minorReviewConfirmed ist oben nie erfuellbar, is_minor_stage ist die eigentliche Durchsetzung),
// ebenso consent_scope_mismatch/naming_not_allowed/sensitive_text_data (bleiben informativ, siehe
// Kommentar in der Migration). Diese Wiederholung hier ist Tiefenverteidigung fuer den Fall, dass
// sich der Medien-/Consent-Zustand zwischen Einplanung und tatsaechlicher Ausfuehrung aendert
// (Plan 002, Pflichtszenario 5: Widerruf nach Freigabe).
export const HARD_PUBLISH_BLOCKERS: readonly MediaGateBlocker[] = ['scan_pending', 'people_review_pending', 'face_pending', 'consent_invalid', 'derivative_stale']
