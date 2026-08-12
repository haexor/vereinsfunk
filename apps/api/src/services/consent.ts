import { ConsentRecordSchema, ConsentRequestSchema, type ConsentScope, type ConsentStatus, type ScopeLevel } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import type { EmailMessage } from '../email.js'
import type { PermissionScope } from '../auth.js'
import { CONSENT_RECORD_SELECT, toPermissionScope, type ConsentRecordRow } from '../routes/shared.js'

// Alles, was die Einwilligungsverwaltung an reiner Logik und an Ladefunktionen braucht -- geteilt
// von routes/consent.ts (angemeldete Verwaltung) und routes/consentPublic.ts (die oeffentlichen
// Token-Seiten). Ohne Fastify-Bezug, damit beide Routen-Module dieselbe Fassung benutzen statt sie
// je Modul abzuschreiben.

// Bereitgestellte Vorlage, bis ein Verein einen eigenen Text hinterlegt (Plan 015, "Einwilligungstext
// pro Verein editierbar"). Anwaltliche Pruefung ist Voraussetzung fuer den Produktivbetrieb, siehe
// plans/README.md "Entschiedene Produktfragen" -- diese Vorlage ist ein Platzhalter, kein Rechtstext.
export const DEFAULT_CONSENT_TEXT_TEMPLATE = `Einwilligung zur Veröffentlichung von Fotos und Videos in sozialen Medien

Der Verein möchte über sein Vereinsleben berichten und dafür auch Fotos und Videos auf seinen Social-Media-Kanälen veröffentlichen. Mit dieser Einwilligung bestätigen Sie, dass Fotos und Videos im hier beschriebenen Umfang veröffentlicht werden dürfen.

Diese Einwilligung ist freiwillig. Sie können sie jederzeit ohne Angabe von Gründen für die Zukunft widerrufen; das beeinträchtigt nicht die Rechtmäßigkeit der bis zum Widerruf erfolgten Veröffentlichungen.`

export const CONSENT_REQUEST_SELECT =
  'id, organization_id, department_id, directory_person_id, recipient_email, recipient_role, requested_scope, text_version, status, expires_at, responded_at, consent_record_id, send_count, last_sent_at, created_by, created_at'
export const ALLOWED_EVIDENCE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

// Jede Antwort auf ein ungueltiges, abgelaufenes oder bereits beantwortetes Token ist absichtlich
// identisch, damit ein Token nicht durch unterschiedliche Fehlercodes erraten/bestaetigt werden kann.
export const CONSENT_TOKEN_INVALID_RESPONSE = { error: 'invalid_or_expired', correlationId: undefined as string | undefined }

// setUTCMonth() ueberlaeuft korrekt auf das naechste Jahr (z. B. Monat 13 -> Januar des
// Folgejahres) -- kein eigener Divisions-/Modulo-Code fuer den Jahresuebertrag noetig. Der Tag
// wird vorher auf 1 gesetzt und danach auf den letzten Tag des Zielmonats begrenzt, sonst wuerde
// z. B. der 31. August + 6 Monate ueber den 28./29. Februar hinaus in den Maerz ueberlaufen
// (gefunden im Code-Review) und die Einwilligung faelschlich laenger gueltig machen.
export function addMonthsToIsoDate(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDayOfTargetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDayOfTargetMonth))
  return date.toISOString()
}

export function generatePublicToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex')
  return { rawToken, tokenHash: createHash('sha256').update(rawToken).digest('hex') }
}

export function hashPublicToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

// Reine Aussage ueber die Zeile selbst (Ampel fuer die Uebersicht) -- unabhaengig von jedem
// konkreten Verwendungszweck. evaluateConsent (packages/domain) prueft zusaetzlich die Deckung
// eines KONKRETEN Beitrags und wird separat fuer die Gate-Auswertung verwendet, nicht hier.
export function computeConsentRecordStatus(row: ConsentRecordRow, now: Date): ConsentStatus {
  if (row.superseded_by !== null) return 'superseded'
  if (row.revoked_at !== null) return 'revoked'
  if (row.signer_role === 'guardian' && !row.guardian_confirmed) return 'guardian_missing'
  if (new Date(row.valid_from) > now) return 'not_yet_valid'
  if (row.valid_until !== null) {
    const validUntil = new Date(row.valid_until)
    if (validUntil <= now) return 'expired'
    if ((validUntil.getTime() - now.getTime()) / 86_400_000 <= 30) return 'expiring_soon'
  }
  return 'valid'
}

export function mapConsentRecordRow(row: ConsentRecordRow, now: Date) {
  return ConsentRecordSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    directoryPersonId: row.directory_person_id,
    pseudonymousSubjectRef: row.pseudonymous_subject_ref,
    scope: row.scope,
    scopeStructured: row.scope_structured,
    origin: row.origin,
    sourceId: row.source_id,
    signedAt: row.signed_at,
    signerName: row.signer_name,
    signerRole: row.signer_role,
    guardianConfirmed: row.guardian_confirmed,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revocationReason: row.revocation_reason,
    supersededBy: row.superseded_by,
    status: computeConsentRecordStatus(row, now),
    createdAt: row.created_at,
  })
}

export type ConsentRequestRow = {
  id: string
  organization_id: string
  department_id: string
  directory_person_id: string
  recipient_email: string
  recipient_role: 'self' | 'guardian'
  requested_scope: ConsentScope
  text_version: string
  status: 'sent' | 'granted' | 'declined' | 'expired' | 'revoked_link'
  expires_at: string
  responded_at: string | null
  consent_record_id: string | null
  send_count: number
  last_sent_at: string
  created_by: string
  created_at: string
}

export function mapConsentRequestRow(row: ConsentRequestRow) {
  return ConsentRequestSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    departmentId: row.department_id,
    directoryPersonId: row.directory_person_id,
    recipientEmail: row.recipient_email,
    recipientRole: row.recipient_role,
    requestedScope: row.requested_scope,
    textVersion: row.text_version,
    status: row.status,
    expiresAt: row.expires_at,
    respondedAt: row.responded_at,
    consentRecordId: row.consent_record_id,
    sendCount: row.send_count,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
  })
}

export function describeConsentScope(scope: ConsentScope): string[] {
  const lines: string[] = []
  const purposeLabels: Record<string, string> = {
    social_media: 'Social Media', website: 'Vereinswebsite', print: 'Printmaterial', internal: 'interne Nutzung',
  }
  const contextLabels: Record<string, string> = {
    team_photo: 'Mannschaftsfoto', match: 'Spiel', training: 'Training', event: 'Veranstaltung', portrait: 'Porträt',
  }
  lines.push(`Zweck: ${scope.purposes.map((purpose) => purposeLabels[purpose] ?? purpose).join(', ')}`)
  lines.push(`Plattformen: ${scope.platforms === null ? 'alle vom Verein genutzten' : scope.platforms.join(', ')}`)
  lines.push(`Medienart: ${scope.mediaKinds.map((kind) => (kind === 'photo' ? 'Foto' : 'Video')).join(', ')}`)
  lines.push(`Anlässe: ${scope.contexts === null ? 'alle' : scope.contexts.map((context) => contextLabels[context] ?? context).join(', ')}`)
  lines.push(scope.namingAllowed ? 'Namentliche Nennung ist erlaubt.' : 'Namentliche Nennung ist nicht erlaubt.')
  return lines
}

export function buildConsentRequestEmail(options: { to: string; organizationName: string; personLabel: string; respondUrl: string }): EmailMessage {
  return {
    to: options.to,
    subject: `Einwilligung zur Veröffentlichung von Fotos/Videos – ${options.organizationName}`,
    text: `${options.organizationName} bittet um Ihre Einwilligung zur Veröffentlichung von Fotos/Videos von ${options.personLabel} in sozialen Medien.\n\nZur Anfrage: ${options.respondUrl}\n\nDer Link ist 14 Tage gültig. Eine Einwilligung ist freiwillig und jederzeit für die Zukunft widerrufbar.`,
  }
}

// Nur Vorname plus initialer Buchstabe des Nachnamens: eine E-Mail an eine Adresse, deren
// Zugehoerigkeit nicht bewiesen ist, nennt nie den vollen Namen einer (moeglicherweise
// minderjaehrigen) Person. Dieselbe Kurzform in E-Mail und oeffentlicher Ansicht.
export function shortPersonLabel(firstName: string, lastName: string): string {
  return `${firstName} ${lastName.charAt(0)}.`
}

export async function currentOrganizationConsentText(
  client: SupabaseClient, organizationId: string,
): Promise<{ id: string | null; body: string; createdAt: string | null }> {
  const latest = await client
    .from('organization_consent_texts')
    .select('id, body, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest.error) throw latest.error
  if (!latest.data) return { id: null, body: DEFAULT_CONSENT_TEXT_TEMPLATE, createdAt: null }
  return { id: latest.data.id as string, body: latest.data.body as string, createdAt: latest.data.created_at as string }
}

// Herkunft eines directoryPersonId fuer den Rechtescope pruefen: gehoert die Person ueberhaupt
// zum angegebenen organizationId, und in welcher Abteilung steht sie (fuer requirePermission).
export async function departmentOfDirectoryPerson(
  client: SupabaseClient, organizationId: string, directoryPersonId: string,
): Promise<string | null | 'not_found'> {
  const person = await client.from('directory_people').select('organization_id, department_id').eq('id', directoryPersonId).maybeSingle()
  if (person.error) throw person.error
  if (!person.data || person.data.organization_id !== organizationId) return 'not_found'
  return person.data.department_id as string | null
}

// Abteilung faellt auf Verein zurueck, wenn sie selbst keine Frist gesetzt hat (Plan 015:
// "Aufbewahrungsfrist"-artiger Vorbelegungswert, anders als reviewMinimumApprovals, das
// bewusst knotenlokal bleibt) -- nur fuer die Vorbelegung neuer Einwilligungen gebraucht, nicht
// Teil der generischen Policy-Anzeige.
export async function resolveConsentValidityMonths(
  client: SupabaseClient, organizationId: string, departmentId: string | null,
): Promise<number | null> {
  const rows = await client.from('policy_settings').select('scope, department_id, consent_validity_months').eq('organization_id', organizationId)
  if (rows.error) throw rows.error
  const data = rows.data as { scope: ScopeLevel; department_id: string | null; consent_validity_months: number | null }[]
  const orgValue = data.find((row) => row.scope === 'organization')?.consent_validity_months ?? null
  const deptValue = departmentId ? data.find((row) => row.scope === 'department' && row.department_id === departmentId)?.consent_validity_months ?? null : null
  return deptValue ?? orgValue
}

export async function loadConsentRecordForScope(
  client: SupabaseClient, params: { id: string },
): Promise<{ row: ConsentRecordRow; scope: PermissionScope } | 'not_found'> {
  const existing = await client.from('consent_records').select(CONSENT_RECORD_SELECT).eq('id', params.id).maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) return 'not_found'
  const row = existing.data as ConsentRecordRow
  let departmentId: string | null = null
  if (row.directory_person_id) {
    const person = await client.from('directory_people').select('department_id').eq('id', row.directory_person_id).maybeSingle()
    if (person.error) throw person.error
    departmentId = (person.data?.department_id as string | null) ?? null
  }
  return { row, scope: toPermissionScope(row.organization_id, departmentId) }
}

export async function findOpenConsentRequestByToken(service: SupabaseClient, rawToken: string): Promise<ConsentRequestRow | null> {
  const found = await service.from('consent_requests').select(CONSENT_REQUEST_SELECT).eq('token_hash', hashPublicToken(rawToken)).maybeSingle()
  if (found.error) throw found.error
  if (!found.data) return null
  const row = found.data as ConsentRequestRow
  if (row.status !== 'sent') return null
  if (new Date(row.expires_at) < new Date()) return null
  return row
}
