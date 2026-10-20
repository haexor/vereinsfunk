import { MediaAssetSummarySchema, UuidSchema } from '@vereinsfunk/contracts'
import { z } from 'zod'
import { evaluateMediaGate } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { parseSupabaseData } from '../supabase.js'
import { mapMediaAssetSummaryRow, MEDIA_ASSET_SUMMARY_COLUMNS } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'
import { isAnyMemberOfOrganization, resolveDirectoryScope, toPermissionScope } from '../services/scopeAuthorization.js'

const CompletionAssetScopeSchema = z.object({ organization_id: UuidSchema, department_id: UuidSchema.nullable() })

export function registerMediaRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, uploads } = context

  const UploadInitiateSchema = z.object({ organizationId: UuidSchema, departmentId: UuidSchema.nullable(), filename: z.string().min(1).max(120).regex(/^[^/\\]+$/), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/mp4']), byteSize: z.int().positive().max(100 * 1024 * 1024) })
  app.post('/v1/media/uploads', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UploadInitiateSchema.parse(request.body); const assetId = randomUUID()
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(input.organizationId, input.departmentId)))) return
    const service = supabaseClients.forService()
    // Plan 021: geprueft wird VOR dem Ausstellen der signierten URL, nicht erst nach dem Hochladen
    // -- sonst laege das Objekt schon im Bucket, wenn die Grenze auffiel. reserve_storage_upload()
    // prueft und reserviert atomar unter einer Vereinssperre (dieselbe Begruendung wie
    // enforce_structure_limit()/schedule_publication(): zwei parallele Uploads knapp unter der
    // Grenze duerfen sie nicht gemeinsam ueberschreiten -- eine getrennte TS-seitige Pruefung vor
    // einem ungesperrten insert liesse genau das zu, gefunden im eigenen Review dieser PR).
    // Der Pfad entsteht nur hier: die Reservierung haelt ihn fest, uploads.create() signiert genau
    // ihn, und /complete laedt ihn ueber media_assets.object_path wieder herunter.
    const objectPath = input.departmentId
      ? `organizations/${input.organizationId}/departments/${input.departmentId}/assets/${assetId}/${input.filename}`
      : `organizations/${input.organizationId}/assets/${assetId}/${input.filename}`
    const reservation = await service.rpc('reserve_storage_upload', {
      target_organization: input.organizationId, target_department: input.departmentId, target_asset_id: assetId,
      target_bucket_id: 'raw-media', target_object_path: objectPath,
      target_mime_type: input.mimeType, announced_bytes: input.byteSize, target_created_by: request.auth!.userId,
    })
    if (reservation.error) {
      const match = reservation.error.message.match(/storage_limit_reached: (organization|department)\/(\d+)\/(\d+)/)
      if (match) return reply.code(409).send({ error: 'storage_limit_reached', scope: match[1], limitBytes: Number(match[2]), usedBytes: Number(match[3]), correlationId: request.id })
      throw reservation.error
    }
    const upload = await uploads.create({ objectPath })
    return reply.code(201).send({ assetId, ...upload })
  })
  app.post('/v1/media/:assetId/complete', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ assetId: UuidSchema }).parse(request.params); const body = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(request.body)
    // Zugehoerigkeit ausschliesslich per Service Client nachschlagen, nie per Nutzer-Client:
    // media_assets_select gewaehrt nur is_department_member -- reserve_storage_upload() legt die
    // Zeile synchron an (Paket 021), assetId ist ab dann immer bekannt. Dieselbe Berechtigung wie
    // beim Start: mit 'post.edit' bekam ein contributor die signierte URL, scheiterte nach dem
    // Hochladen aber mit 403, und das Asset blieb mit reserviertem Kontingent auf 'initiated'.
    const service = supabaseClients.forService()
    const asset = await service.from('media_assets').select('organization_id, department_id').eq('id', params.assetId).maybeSingle()
    if (asset.error) throw asset.error
    if (!asset.data) return reply.code(404).send({ error: 'media_asset_not_found', correlationId: request.id })
    const parsedAsset = parseSupabaseData(CompletionAssetScopeSchema, asset.data)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(parsedAsset.organization_id, parsedAsset.department_id)))) return
    return reply.code(202).send(await uploads.complete({ ...params, ...body }))
  })
  // Signed URLs koennen nicht ueber den Nutzer-Client erzeugt werden (kein Storage-Grant fuer
  // authenticated auf rendered-media/raw-media) -- derselbe Service-Client wie in photoLayout.ts:222.
  // Nur fuer Bilder: es gibt keine Video-/Audio-Vorschau-Pipeline. Ein einzelner fehlgeschlagener
  // Storage-Aufruf (z. B. ein geloeschtes/inkonsistentes Objekt) faellt auf signedUrl: null zurueck
  // statt die ganze Liste per throw abzureissen -- die Aufrufer zeigen fehlendes signedUrl bereits
  // als Icon-Platzhalter bzw. lehnen die Wiederverwendung sauber ab (PhotoAttachment.vue).
  async function signMediaAssetSummary(service: SupabaseClient, row: Record<string, unknown>) {
    const mimeType = row.mime_type as string
    if (!mimeType.startsWith('image/')) return mapMediaAssetSummaryRow(row, null)
    const signed = await service.storage.from(row.bucket_id as string).createSignedUrl(row.object_path as string, 600)
    return mapMediaAssetSummaryRow(row, signed.error ? null : signed.data.signedUrl)
  }
  // Fuer eine ganze Liste: ein createSignedUrl-Aufruf je Bild-Zeile waere bei der Galerie (bis zu 60
  // Zeilen) bis zu 60 einzelne Storage-Roundtrips. Bild-Zeilen nach bucket_id gruppieren (raw-media
  // vs. rendered-media) und je Bucket createSignedUrls (Plural, ein Aufruf fuer alle Pfade) nutzen.
  async function signMediaAssetSummaries(service: SupabaseClient, rows: Record<string, unknown>[]) {
    const rowsByBucket = new Map<string, Record<string, unknown>[]>()
    for (const row of rows) {
      if (!(row.mime_type as string).startsWith('image/')) continue
      const bucketId = row.bucket_id as string
      const bucketRows = rowsByBucket.get(bucketId) ?? []
      bucketRows.push(row)
      rowsByBucket.set(bucketId, bucketRows)
    }
    const signedUrlByKey = new Map<string, string>()
    await Promise.all([...rowsByBucket.entries()].map(async ([bucketId, bucketRows]) => {
      const signed = await service.storage.from(bucketId).createSignedUrls(bucketRows.map((row) => row.object_path as string), 600)
      if (signed.error) return
      for (const entry of signed.data) {
        if (entry.path && entry.signedUrl) signedUrlByKey.set(`${bucketId}:${entry.path}`, entry.signedUrl)
      }
    }))
    return rows.map((row) => mapMediaAssetSummaryRow(row, signedUrlByKey.get(`${row.bucket_id as string}:${row.object_path as string}`) ?? null))
  }
  // Medien-/Postuebersicht: Galerie bereits erzeugter Fotos/Videos, plus Auswahlquelle fuer die
  // Wiederverwendung in einem neuen Beitrag und fuer den Chat-Anhang-Picker. Reiner authentifizierter
  // Read, RLS (media_assets_select) traegt die Sichtbarkeit -- gleiches Muster wie
  // GET /v1/organizations/:id/directory-people.
  const MediaAssetListQuerySchema = z.object({
    organizationId: UuidSchema,
    departmentId: UuidSchema.optional(),
    mimeTypePrefix: z.enum(['image/', 'video/', 'audio/']).optional(),
    createdBy: z.literal('me').optional(),
    // reviewedOnly=true grenzt auf Assets ein, deren Personen-/Einwilligungspruefung bereits
    // bestaetigt ist (people_reviewed_at gesetzt) -- Voraussetzung fuer die Wiederverwendung in
    // einem neuen Beitrag, siehe PhotoAttachment.vue. z.stringbool() statt z.coerce.boolean():
    // letzteres macht jeden nicht-leeren String wahr (siehe directory.ts isMinor-Kommentar).
    reviewedOnly: z.stringbool().optional(),
  })
  app.get('/v1/media-assets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = MediaAssetListQuerySchema.parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const validatedScope = await resolveDirectoryScope(client, query.organizationId, query.departmentId ?? null, null)
    if (!validatedScope || !(await isAnyMemberOfOrganization(client, request.auth!.userId, query.organizationId))) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    let builder = client
      .from('media_assets')
      .select(MEDIA_ASSET_SUMMARY_COLUMNS)
      .eq('organization_id', query.organizationId)
      .eq('upload_status', 'ready')
    if (query.departmentId !== undefined) builder = builder.eq('department_id', query.departmentId)
    if (query.mimeTypePrefix) builder = builder.like('mime_type', `${query.mimeTypePrefix}%`)
    if (query.createdBy === 'me') builder = builder.eq('created_by', request.auth!.userId)
    // reviewedOnly gilt nur fuer Bild/Video: nur diese beiden durchlaufen ueberhaupt eine
    // Personen-Pruefung (people_reviewed_at), siehe textGenerationSessions.ts:100. "people_reviewed_at
    // is not null" allein wuerde Audio-Assets, deren Spalte nie gesetzt wird, faelschlich dauerhaft
    // ausschliessen -- deshalb die Bild/Video-Ausnahme mit in den SQL-Filter. Muss VOR limit(60)
    // angewendet werden: ein Filter nach dem Abruf wuerde die bereits gedeckelte Seite weiter
    // ausduennen, statt die 60 relevantesten Treffer zu liefern.
    if (query.reviewedOnly) builder = builder.or('and(mime_type.not.like.image/*,mime_type.not.like.video/*),people_reviewed_at.not.is.null')
    const result = await builder.order('created_at', { ascending: false }).limit(60)
    if (result.error) throw result.error
    const rows = (result.data ?? []) as Record<string, unknown>[]
    const summaries = await signMediaAssetSummaries(supabaseClients.forService(), rows)
    return reply.code(200).send(z.array(MediaAssetSummarySchema).parse(summaries))
  })

  // Einzelabruf fuer die Wiederverwendung eines bestehenden Fotos in PhotoAttachment.vue: dort ist
  // nur die Asset-ID bekannt (aus dem mediaAssetId-Query-Parameter von erstellen.vue), nicht der
  // volle Scope. RLS entscheidet Sichtbarkeit -- ein unbekanntes oder unsichtbares Asset ergibt
  // denselben not_found wie ein tatsaechlich fehlendes, kein Unterschied nach aussen.
  app.get('/v1/media-assets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const found = await client.from('media_assets').select(MEDIA_ASSET_SUMMARY_COLUMNS).eq('id', params.id).eq('upload_status', 'ready').maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(await signMediaAssetSummary(supabaseClients.forService(), found.data as Record<string, unknown>))
  })

  app.post('/v1/media/gate', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    // Keine requirePermission-Pruefung: reine, zustandslose Regelauswertung ohne Scope-Bezug
    // und ohne Datenzugriff -- es gibt nichts scope-Gebundenes, gegen das zu pruefen waere.
    const input = z.object({
      scanStatus: z.enum(['pending', 'clean', 'failed']), peopleReviewPending: z.boolean(), hasOriginalSelected: z.boolean(),
      derivativeCurrent: z.boolean(), minorReviewConfirmed: z.boolean(),
      faces: z.array(z.object({
        subjectKind: z.enum(['adult', 'minor', 'unknown']), decision: z.enum(['pending', 'consented', 'obscure', 'exclude']),
        consentValid: z.boolean().optional(), consentScopeMismatch: z.boolean().optional(),
      })),
      namingNotAllowed: z.boolean().optional(), sensitiveTextData: z.boolean().optional(),
    }).parse(request.body)
    return evaluateMediaGate(input)
  })
}
