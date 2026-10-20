import type { ConsentScope } from '@vereinsfunk/contracts'
import { SocialConnectionSchema, SyncIdempotencyKeySchema, type SocialConnection } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { mapChannelScopeRow, mapSocialConnectionRow } from '../apiMappers.js'
import type { PermissionScope } from '../auth.js'
import type { SupabaseClientFactory } from './context.js'
import { toPermissionScope } from '../services/scopeAuthorization.js'

// Ein abteilungseigener Kanal -- Instagram/Facebook per OAuth (channelOAuth.ts), ein Website-Kanal
// per POST /v1/channels (Plan 039) -- braucht dieselbe vereinsweite Freigabe (Plan 012: "eine
// Abteilung darf sich diese Erlaubnis nicht selbst geben"). Beide Anlagewege teilen sich diese
// Pruefung, damit sie nicht auseinanderlaufen.
export async function isDepartmentOwnedChannelAllowed(client: SupabaseClient, organizationId: string): Promise<boolean> {
  const policyRow = await client
    .from('policy_settings')
    .select('allow_department_owned_channels')
    .eq('organization_id', organizationId)
    .eq('scope', 'organization')
    .maybeSingle()
  if (policyRow.error) throw policyRow.error
  return policyRow.data?.allow_department_owned_channels ?? false
}

// Einfacher In-Prozess-Sliding-Window-Zaehler statt einer neuen Abhaengigkeit (@fastify/rate-limit):
// die oeffentlichen Einwilligungsseiten unten sind die exponierteste Flaeche des Systems (Plan
// 015, Abschnitt 3) und brauchen ein Rate-Limit pro IP und pro Token. Fuer einen einzelnen
// API-Prozess ausreichend; ein mehrknotiges Produktions-Deployment braucht einen gemeinsamen
// Speicher (Redis) statt dieser lokalen Map -- dokumentierte Grenze, kein stiller Kompromiss.
// buildApp erzeugt genau einen Zaehler pro App-Instanz und reicht ihn ueber ApiRouteContext an
// alle Route-Module weiter; die teilen sich darueber denselben Zaehler pro Praefix-Key. Frueher
// ein Modul-Singleton: dann setzte jede weitere App-Instanz im selben Prozess (jeder Test) den
// Zaehlerstand der vorherigen fort.
export type RateLimiter = (key: string, limit: number, windowMs: number) => boolean

export function createRateLimiter(): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  let nextSweepAt = 0
  return (key, limit, windowMs) => {
    const now = Date.now()
    // Diese Routen sind oeffentlich erreichbar; ohne Aufraeumen wuerde jede neue Quell-IP dauerhaft
    // einen Eintrag belegen (gefunden im Code-Review). Nur bei Bedarf durchsuchen, statt bei jedem
    // Aufruf ueber die ganze Map zu iterieren -- und selbst dann hoechstens einmal pro Minute, sonst
    // wuerde ein Schwarm neuer IPs bei gleichzeitig >10.000 aktiven Eintraegen (resetAt >= now, der
    // Durchlauf loescht dann nichts) jeden weiteren Aufruf erneut die ganze Map durchsuchen lassen.
    if (buckets.size > 10_000 && now >= nextSweepAt) {
      nextSweepAt = now + 60_000
      for (const [bucketKey, entry] of buckets) {
        if (entry.resetAt < now) buckets.delete(bucketKey)
      }
    }
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    if (bucket.count >= limit) return false
    bucket.count += 1
    return true
  }
}

type AuditEvent = { organizationId: string; action: string; entityType: string; entityId: string | null; metadata?: Record<string, unknown> }

// Service-Client, weil audit_events fuer authenticated keine INSERT-Policy hat. Fehler werden
// geloggt, nicht geworfen -- ein fehlgeschlagener Audit-Eintrag darf die bereits durchgefuehrte
// Aenderung nicht nachtraeglich als Fehler ausgeben. Als Factory, weil der Recorder
// supabaseClients aus der Closure von buildApp braucht; jedes Route-Modul ruft
// createAuditRecorder(supabaseClients) einmal auf.
export function createAuditRecorder(supabaseClients: SupabaseClientFactory) {
  const recordExternalActionAuditEvent = createExternalActionAuditRecorder(supabaseClients)
  return (request: FastifyRequest, event: AuditEvent): Promise<void> =>
    recordExternalActionAuditEvent(request, request.auth!.userId, event)
}

// OAuth-Callbacks und oeffentliche Token-Links (Einwilligung, Widerruf) haben keinen
// request.auth-Kontext. Der Akteur kommt deshalb explizit: der beim OAuth-Start gespeicherte
// Nutzer, oder null, wenn die handelnde Person kein Konto hat.
export function createExternalActionAuditRecorder(supabaseClients: SupabaseClientFactory) {
  return async function recordExternalActionAuditEvent(request: FastifyRequest, actorUserId: string | null, event: AuditEvent): Promise<void> {
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: event.organizationId,
      actor_user_id: actorUserId,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      correlation_id: request.id,
      metadata: event.metadata ?? {},
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
  }
}

// Gemeinsame Zeilenform fuer consent_records (Paket 015) -- gebraucht sowohl von den
// Datenschutz-Routen als auch von computeMediaGateBlockersForPostVersion in services/mediaGate.ts
// (Freigabe-Medien-Gate liest bestehende Einwilligungen).
export const CONSENT_RECORD_SELECT =
  'id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, scope_structured, origin, source_id, signed_at, signer_name, signer_role, guardian_confirmed, valid_from, valid_until, revoked_at, revoked_by, revocation_reason, superseded_by, created_at'

export type ConsentRecordRow = {
  id: string
  organization_id: string
  directory_person_id: string | null
  pseudonymous_subject_ref: string | null
  scope: string
  scope_structured: ConsentScope
  origin: 'paper' | 'digital' | 'imported'
  source_id: string | null
  signed_at: string | null
  signer_name: string | null
  signer_role: 'self' | 'guardian' | null
  guardian_confirmed: boolean
  valid_from: string
  valid_until: string | null
  revoked_at: string | null
  revoked_by: 'self' | 'guardian' | 'organization' | null
  revocation_reason: string | null
  superseded_by: string | null
  created_at: string
}

// Spaltenliste einer social_connections-Zeile -- von Kanalverwaltung und OAuth-Auswahl geteilt.
export const SOCIAL_CONNECTION_COLUMNS =
  'id, platform, external_account_id, display_name, status, token_expires_at, last_verified_at, owner_scope, owner_department_id, responsible_profile_id, purpose, confidential, archived_at, created_at, imprint_url, privacy_url, editorial_responsible_profile_id, editorial_responsible_note, website_url, max_characters'

// Antwortform nach jedem Schreibzugriff auf einen Kanal: die frisch gelesene Zeile plus ihre
// aktuellen Freigaben. Stand viermal wortgleich in channels.ts und channelOAuth.ts.
export async function loadSocialConnectionResponse(service: SupabaseClient, row: Record<string, unknown>, organizationId: string): Promise<SocialConnection> {
  const scopes = await service.from('channel_scopes').select('id, scope, department_id, team_id, can_schedule').eq('organization_id', organizationId).eq('social_connection_id', row.id as string)
  if (scopes.error) throw scopes.error
  return SocialConnectionSchema.parse({ ...mapSocialConnectionRow(row), scopes: scopes.data.map((scopeRow) => mapChannelScopeRow(scopeRow, organizationId)) })
}

// Massgeblich fuer jede Kanal-Berechtigung ist der Kanalbesitz: eine Verbindung im Besitz einer
// Abteilung wird in deren Scope geprueft, eine vereinseigene auf Vereinsebene (Plan 012,
// "Zuordnung und Verantwortung"). Stand sechsmal wortgleich in routes/channels.ts.
export function channelOwnerScope(row: { organization_id: unknown; owner_scope: unknown; owner_department_id: unknown }): PermissionScope {
  return toPermissionScope(row.organization_id as string, row.owner_scope === 'department' ? (row.owner_department_id as string) : null)
}

// Liest den optionalen Idempotency-Key-Header (Sync-Routen, Veo-Abgleich, Vorschau). Ohne Header
// ein zufaelliger Schluessel, also keine Deduplizierung; null bei mehrfachem oder ungueltigem Wert
// -- der Aufrufer antwortet dann mit 400 invalid_idempotency_key.
export function readIdempotencyKeyHeader(request: FastifyRequest): string | null {
  const header = request.headers['idempotency-key']
  if (Array.isArray(header)) return null
  const parsed = SyncIdempotencyKeySchema.safeParse(header ?? randomUUID())
  return parsed.success ? parsed.data : null
}
