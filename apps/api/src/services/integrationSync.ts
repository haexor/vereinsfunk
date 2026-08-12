import {
  SyncSourceResponseSchema,
  type FieldMapping,
  type IntegrationDomain,
  type SyncConflictKind,
  type SyncMode,
} from '@vereinsfunk/contracts'
import { resolveIcalDateTime, zonedWallTimeToUtcMs, type SourceTransport, type SyncPlanResult } from '@vereinsfunk/integrations'
import {
} from '@vereinsfunk/club-schedule'
import {
  type DepartmentResolver,
  type PersonExternal,
} from '@vereinsfunk/member-directory'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import { mapSyncConflictRow, mapSyncRunRow, SYNC_CONFLICT_COLUMNS, SYNC_RUN_COLUMNS } from '../apiMappers.js'

// Der Sync-Motor aus Paket 014/019: Rohzeilen einlesen, gegen den Bestand planen, Konflikte
// bilden und den Lauf abschliessen. Bewusst ohne Fastify-Routen und ohne Berechtigungslogik --
// die sitzt in routes/integrations.ts. Hier landet nur, was mehr als eine Domaene teilt oder
// eigenstaendig testbar ist.

export function normalizeStructureName(name: string): string {
  return name.trim().toLowerCase()
}

// Dieselbe Aufloesung wie im geschlossenen resolveIds() aus packages/member-directory/src/match.ts
// -- dort fuer den Feldvergleich waehrend hier fuer das tatsaechliche Schreiben nach
// einer Uebernahme. Keine gemeinsame Exportstelle: zwei Zeilen Lookup rechtfertigen keine eigene
// Paketschnittstelle.
export function resolvePersonScope(entity: PersonExternal, resolver: DepartmentResolver) {
  const departmentId = entity.departmentName ? resolver.resolveDepartmentId(entity.departmentName) : undefined
  const teamId = entity.teamName && departmentId ? resolver.resolveTeamId(departmentId, entity.teamName) : undefined
  return { departmentId, teamId }
}

// Deterministisch aus Quelle, Bereich, Konfliktart, Feld und Identitaet (plans/014: "fingerprint
// ist der Grund, warum ignore_permanently funktioniert"). sha256 statt einer Verkettung roh: Labels
// koennen das Trennzeichen selbst enthalten.
export function conflictFingerprint(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex')
}

export async function collectRows(transport: SourceTransport): Promise<Readonly<Record<string, unknown>>[]> {
  const rows: Readonly<Record<string, unknown>>[] = []
  for await (const row of transport.read({})) rows.push(row)
  return rows
}

export interface PendingConflict {
  kind: SyncConflictKind
  label: string
  field: string
  externalId: string | null
  localId: string | null
  currentValue: string | null
  incomingValue: string | null
  fingerprint: string
}

// Baut die Konfliktzeilen aus einem SyncPlan -- gemeinsam fuer alle vier Bereiche (Personen,
// Mannschaften, Spiele, Veranstaltungen; Paket 019 verallgemeinert, was Paket 014 nur fuer
// Personen brauchte). identityOf ist die des jeweiligen DomainAdapter.
export function buildPendingConflicts<TLocal extends { id: string }, TExternal>(input: {
  plan: SyncPlanResult<TLocal, TExternal>
  sourceId: string
  domain: IntegrationDomain
  identityOf: (entity: TExternal) => { externalId: string } | { fuzzy: readonly string[] }
  invalidRecords: readonly { label: string; reason: string }[]
  ignoredFingerprints: ReadonlySet<string>
}): PendingConflict[] {
  const { plan, sourceId, domain, identityOf, invalidRecords, ignoredFingerprints } = input
  const pendingConflicts: PendingConflict[] = []
  for (const conflict of plan.conflicts) {
    const identity = conflict.incoming ? identityOf(conflict.incoming) : null
    const externalId = identity && 'externalId' in identity ? identity.externalId : null
    const localId = conflict.candidates?.[0]?.id ?? null
    const field = conflict.kind === 'unknown_structure' ? 'structure' : 'identity'
    const fingerprint = conflictFingerprint([sourceId, domain, conflict.kind, field, externalId ?? localId ?? conflict.label])
    if (ignoredFingerprints.has(fingerprint)) continue
    // unknown_structure traegt in conflict.reason den unaufgeloesten Rohwert -- nicht spiegeln
    // (derselbe Fund wie in Paket 014 bei directory_people): eine falsch zugeordnete Spalte
    // (IBAN, Adresse, ...) wuerde diesen Wert sonst ungeprueft in eine nur ueber
    // integration.manage geschuetzte, unauditierte Tabelle schreiben. field/label zeigen genug
    // Kontext, um die eigene Feldzuordnung zu pruefen.
    const incomingValue = conflict.kind === 'unknown_structure' ? null : (conflict.reason ?? null)
    pendingConflicts.push({ kind: conflict.kind, label: conflict.label, field, externalId, localId, currentValue: null, incomingValue, fingerprint })
  }
  for (const invalid of invalidRecords) {
    const fingerprint = conflictFingerprint([sourceId, domain, 'invalid_record', 'record', invalid.label])
    if (ignoredFingerprints.has(fingerprint)) continue
    pendingConflicts.push({ kind: 'invalid_record', label: invalid.label, field: 'record', externalId: null, localId: null, currentValue: null, incomingValue: invalid.reason, fingerprint })
  }
  return pendingConflicts
}

// Ein Konflikt, den erst der Schreibpfad bemerkt (fehlende Abteilung, unaufloesbares Datum,
// Minderjaehrige ohne Elternkontakt) -- nur anlegen, wenn derselbe Fingerabdruck nicht schon in
// dieser Liste steht. Dreimal wortgleich in den Domaenenhandlern, deshalb hier einmal.
export function addUniquePendingConflict(pendingConflicts: PendingConflict[], conflict: PendingConflict): void {
  if (pendingConflicts.some((existing) => existing.fingerprint === conflict.fingerprint)) return
  pendingConflicts.push(conflict)
}

export async function loadIgnoredFingerprints(service: SupabaseClient, sourceId: string): Promise<ReadonlySet<string>> {
  const ignored = await service.from('integration_sync_conflicts').select('fingerprint').eq('source_id', sourceId).eq('resolution', 'ignore_permanently')
  if (ignored.error) throw ignored.error
  return new Set(ignored.data.map((row) => row.fingerprint as string))
}

export async function handleAbortedSync(input: {
  service: SupabaseClient
  runId: string
  organizationId: string
  sourceId: string
  domain: IntegrationDomain
  mode: SyncMode
  idempotencyKey: string
}) {
  const run = await input.service
    .from('integration_sync_runs')
    .update({
      status: 'aborted_loss_threshold', finished_at: new Date().toISOString(),
    })
    .eq('id', input.runId)
    .eq('status', 'running')
    .select(SYNC_RUN_COLUMNS)
    .single()
  if (run.error) throw run.error
  await input.service.from('integration_sources').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'aborted_loss_threshold' }).eq('id', input.sourceId)
  return SyncSourceResponseSchema.parse({ run: mapSyncRunRow(run.data), conflicts: [], idempotencyKey: input.idempotencyKey })
}

export async function finishSyncRun(input: {
  service: SupabaseClient
  request: FastifyRequest
  runId: string
  organizationId: string
  sourceId: string
  domain: IntegrationDomain
  mode: SyncMode
  idempotencyKey: string
  createdCount: number
  updatedCount: number
  retiredCount: number
  skippedCount: number
  pendingConflicts: readonly PendingConflict[]
}) {
  let conflictRows: Record<string, unknown>[] = []
  if (input.pendingConflicts.length > 0) {
    const conflictInsert = await input.service
      .from('integration_sync_conflicts')
      .insert(
        input.pendingConflicts.map((conflict) => ({
          organization_id: input.organizationId, sync_run_id: input.runId, source_id: input.sourceId, domain: input.domain,
          external_id: conflict.externalId, local_id: conflict.localId, label: conflict.label, field: conflict.field,
          current_value: conflict.currentValue, incoming_value: conflict.incomingValue, kind: conflict.kind, fingerprint: conflict.fingerprint,
        })),
      )
      .select(SYNC_CONFLICT_COLUMNS)
    if (conflictInsert.error) throw conflictInsert.error
    conflictRows = conflictInsert.data
  }

  const run = await input.service
    .from('integration_sync_runs')
    .update({
      status: 'succeeded', created_count: input.createdCount, updated_count: input.updatedCount,
      retired_count: input.retiredCount, skipped_count: input.skippedCount,
      conflict_count: input.pendingConflicts.length, finished_at: new Date().toISOString(),
    })
    .eq('id', input.runId)
    .eq('status', 'running')
    .select(SYNC_RUN_COLUMNS)
    .single()
  if (run.error) throw run.error

  await input.service.from('integration_sources').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'succeeded' }).eq('id', input.sourceId)
  // Inline statt des createAuditRecorder-Helfers: der braucht die SupabaseClientFactory, diese
  // Funktion hat bereits den Service-Client, der alles ist, was der Audit-Eintrag benoetigt.
  const audit = await input.service.from('audit_events').insert({
    organization_id: input.organizationId, actor_user_id: input.request.auth!.userId, action: `integration_source.sync_${input.mode}`,
    entity_type: 'integration_sync_runs', entity_id: run.data.id as string, correlation_id: input.request.id,
    metadata: { created: input.createdCount, updated: input.updatedCount, retired: input.retiredCount, conflicts: input.pendingConflicts.length },
  })
  if (audit.error) input.request.log.error({ err: audit.error, correlationId: input.request.id }, 'audit_events insert failed')

  return SyncSourceResponseSchema.parse({ run: mapSyncRunRow(run.data), conflicts: conflictRows.map(mapSyncConflictRow), idempotencyKey: input.idempotencyKey })
}

export async function failSyncRun(input: {
  service: SupabaseClient
  runId: string
  sourceId: string
  error: unknown
}) {
  const errorClass = input.error instanceof Error ? input.error.name : 'unknown'
  const run = await input.service
    .from('integration_sync_runs')
    .update({ status: 'failed', error_class: errorClass, finished_at: new Date().toISOString() })
    .eq('id', input.runId)
    .eq('status', 'running')
  if (run.error) throw run.error
  const source = await input.service
    .from('integration_sources')
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: 'failed' })
    .eq('id', input.sourceId)
  if (source.error) throw source.error
}

export async function loadSyncSourceResponse(input: {
  service: SupabaseClient
  runId: string
  idempotencyKey: string
}) {
  const run = await input.service.from('integration_sync_runs').select(SYNC_RUN_COLUMNS).eq('id', input.runId).single()
  if (run.error) throw run.error
  const conflicts = await input.service.from('integration_sync_conflicts').select(SYNC_CONFLICT_COLUMNS).eq('sync_run_id', input.runId)
  if (conflicts.error) throw conflicts.error
  return SyncSourceResponseSchema.parse({
    run: mapSyncRunRow(run.data), conflicts: conflicts.data.map(mapSyncConflictRow), idempotencyKey: input.idempotencyKey,
  })
}

// ISO-Datum/-Zeit ohne Offset-Erkennung fuer den Fallback unten -- "2026-08-12T19:30:00" ist ohne
// Z oder numerischen Offset keine eindeutige Instanz, nur eine Wanduhrzeit.
const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

// Loest einen rohen Datumswert (iCal-Kompaktform ODER eine bereits vollstaendige ISO-Zeichenkette
// aus einer Datei-Spalte) in eine UTC-Instanz auf. Ein Datei-Export mit einer eigenen
// kickoffAt/startsAt-Spalte liefert ueblicherweise bereits ein eindeutiges Format -- dafuer gilt
// die Angabe als bestaetigt, aber nur wenn ein Z-Suffix oder numerischer Offset vorliegt.
// resolveIcalDateTime deckt nur die iCal-Kompaktform ab. Ohne Offset (z. B. "2026-08-12T19:30:00"
// oder ein reines Datum "2026-08-12") ist der Wert eine Wanduhrzeit, keine Instanz -- new
// Date(rawValue) haette sie von der Prozesszeitzone abhaengig gemacht bzw. Datumsangaben als
// UTC-Mitternacht fehlgedeutet. Dieselbe Regel wie bei resolveIcalDateTime ohne TZID: die
// Vereinszeitzone gilt als Annahme, deshalb confirmed: false.
export function resolveScheduleDateTime(
  rawValue: string,
  tzid: string | undefined,
  fallbackTimezone: string,
): { iso: string; confirmed: boolean } | undefined {
  const icalResolved = resolveIcalDateTime(rawValue, tzid, fallbackTimezone)
  if (icalResolved) return icalResolved
  const isoMatch = ISO_DATE_TIME_PATTERN.exec(rawValue)
  if (isoMatch) {
    const [, year, month, day, hour, minute, second, offset] = isoMatch
    if (!offset) {
      const utcMs = zonedWallTimeToUtcMs(
        Number(year), Number(month), Number(day), hour ? Number(hour) : 0, minute ? Number(minute) : 0, second ? Number(second) : 0, fallbackTimezone,
      )
      return { iso: new Date(utcMs).toISOString(), confirmed: false }
    }
  }
  const parsed = new Date(rawValue)
  if (!Number.isNaN(parsed.getTime())) return { iso: parsed.toISOString(), confirmed: true }
  return undefined
}

// Normalisiert und validiert die Rohzeilen einer Quelle gegen das Schema des Bereichs. Eine Zeile,
// die das Schema nicht erfuellt, wird ein invalid_record-Konflikt statt eines geworfenen Fehlers --
// ein einzelner kaputter Datensatz darf den ganzen Import nicht abbrechen. Vorher stand diese
// Schleife viermal fast wortgleich in den Domaenenhandlern; nur die Beschriftung einer ungueltigen
// Zeile unterscheidet sich, deshalb `labelOf` als Parameter.
export function parseIncomingRows<TExternal>(input: {
  rawRows: readonly Readonly<Record<string, unknown>>[]
  fieldMapping: FieldMapping
  normalize: (raw: Readonly<Record<string, unknown>>, fieldMapping: FieldMapping) => unknown
  schema: { safeParse(value: unknown): { success: true; data: TExternal } | { success: false; error: { issues: { message: string }[] } } }
  labelOf: (normalized: Record<string, unknown>, rowIndex: number) => string
}): { incoming: TExternal[]; invalidRecords: { label: string; reason: string }[] } {
  const incoming: TExternal[] = []
  const invalidRecords: { label: string; reason: string }[] = []
  let rowIndex = 0
  for (const raw of input.rawRows) {
    rowIndex += 1
    const normalized = input.normalize(raw, input.fieldMapping)
    if (normalized === undefined) continue
    const parsed = input.schema.safeParse(normalized)
    if (!parsed.success) {
      invalidRecords.push({
        label: input.labelOf(normalized as Record<string, unknown>, rowIndex),
        reason: parsed.error.issues.map((issue) => issue.message).join('; '),
      })
      continue
    }
    incoming.push(parsed.data)
  }
  return { incoming, invalidRecords }
}

export interface SyncDomainContext {
  request: FastifyRequest
  reply: FastifyReply
  service: SupabaseClient
  organizationId: string
  sourceDepartmentId: string | null
  sourceId: string
  sourceFieldMapping: FieldMapping
  sourceLossThresholdPercent: number
  mode: SyncMode
  domain: IntegrationDomain
  correlationId: string
  runId: string
  idempotencyKey: string
  rawRows: readonly Readonly<Record<string, unknown>>[]
  organizationTimezone: string
}

