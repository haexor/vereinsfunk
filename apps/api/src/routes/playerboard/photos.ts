import {
  CreatePlayerboardPhotoUploadRequestSchema,
  PlayerboardPhotoSchema,
  PlayerboardPhotoUploadSchema,
  ReviewPlayerboardPhotoRequestSchema,
  SetPlayerboardPhotoPublicRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ApiRouteContext } from '../context.js'
import { createAuditRecorder } from '../shared.js'
import { loadTeamScope, sendDatabaseError } from './shared.js'

export const PLAYERBOARD_PHOTO_BUCKET = 'playerboard-training-photos'
const SIGNED_URL_SECONDS = 600
const PHOTO_COLUMNS = 'id, training_id, storage_path, content_type, size_bytes, public, consent_review_status, all_recognizable_people_listed, uploaded_at, upload_completed_at'

type PhotoRow = {
  id: string; training_id: string; storage_path: string; content_type: string; size_bytes: number; public: boolean
  consent_review_status: string; all_recognizable_people_listed: boolean; uploaded_at: string; upload_completed_at: string | null
}

const PeopleDetailSchema = z.array(z.object({ directoryPersonId: z.string(), consentRecordId: z.string() }))

async function mapPhotos(client: SupabaseClient, service: SupabaseClient, rows: readonly PhotoRow[]) {
  if (rows.length === 0) return []
  const [people, signed] = await Promise.all([
    client.from('playerboard_training_photo_people').select('photo_id, directory_person_id, consent_record_id').in('photo_id', rows.map((row) => row.id)),
    service.storage.from(PLAYERBOARD_PHOTO_BUCKET).createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_SECONDS),
  ])
  if (people.error) throw people.error
  if (signed.error) throw signed.error
  const urlByPath = new Map(signed.data.map((entry) => [entry.path, entry.signedUrl]))
  return rows.flatMap((row) => {
    const url = urlByPath.get(row.storage_path)
    if (!url) return []
    return [PlayerboardPhotoSchema.parse({
      id: row.id, trainingId: row.training_id, url, contentType: row.content_type, sizeBytes: row.size_bytes, public: row.public,
      consentReviewStatus: row.consent_review_status, allRecognizablePeopleListed: row.all_recognizable_people_listed,
      people: people.data.filter((person) => person.photo_id === row.id)
        .map((person) => ({ directoryPersonId: person.directory_person_id, consentRecordId: person.consent_record_id })),
      uploadedAt: row.uploaded_at,
    })]
  })
}

// Paket 052: Trainingsfotos. Der Bucket ist privat und hat keine Policies fuer authenticated --
// Hoch- und Herunterladen laufen ausschliesslich ueber signierte URLs, die diese Routen nach eigener
// Rechtepruefung ausstellen. Freigabe und "oeffentlich" aendern nur die RPCs der Migration.
export function registerPlayerboardPhotoRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, requirePermissionAnyOf, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  async function trainingScope(request: FastifyRequest, reply: FastifyReply, trainingId: string) {
    const training = await supabaseClients.forService().from('playerboard_trainings').select('team_id').eq('id', trainingId).maybeSingle()
    if (training.error) throw training.error
    const scope = training.data ? await loadTeamScope(supabaseClients.forService(), training.data.team_id as string) : null
    if (!scope) reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return scope
  }

  async function loadPhoto(request: FastifyRequest, reply: FastifyReply, photoId: string) {
    const photo = await supabaseClients.forService().from('playerboard_training_photos').select(PHOTO_COLUMNS).eq('id', photoId).maybeSingle()
    if (photo.error) throw photo.error
    if (!photo.data) {
      reply.code(404).send({ error: 'not_found', correlationId: request.id })
      return null
    }
    const row = photo.data as unknown as PhotoRow
    const scope = await trainingScope(request, reply, row.training_id)
    return scope ? { row, scope } : null
  }

  async function photoResponse(request: FastifyRequest, photoId: string) {
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const row = await client.from('playerboard_training_photos').select(PHOTO_COLUMNS).eq('id', photoId).single()
    if (row.error) throw row.error
    const [photo] = await mapPhotos(client, supabaseClients.forService(), [row.data as unknown as PhotoRow])
    return photo
  }

  app.get('/v1/playerboard/trainings/:id/photos', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const scope = await trainingScope(request, reply, params.id)
    if (!scope) return
    // Fotos bleiben mannschaftsintern: training.view, nicht stats_visibility.
    if (!(await requirePermission(request, reply, 'training.view', scope))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client.from('playerboard_training_photos').select(PHOTO_COLUMNS)
      .eq('training_id', params.id).not('upload_completed_at', 'is', null).order('uploaded_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(await mapPhotos(client, supabaseClients.forService(), rows.data as unknown as PhotoRow[]))
  })

  app.post('/v1/playerboard/trainings/:id/photos', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreatePlayerboardPhotoUploadRequestSchema.parse(request.body)
    const scope = await trainingScope(request, reply, params.id)
    if (!scope) return
    if (!(await requirePermission(request, reply, 'training.manage', scope))) return
    const service = supabaseClients.forService()
    // Pruefung und Reservierung auf das Speicherkontingent in einer Transaktion (Paket 021).
    const reserved = await service.rpc('playerboard_reserve_photo_upload', {
      target_photo_id: randomUUID(), target_training_id: params.id, target_content_type: input.contentType,
      announced_bytes: input.sizeBytes, target_uploaded_by: request.auth!.userId,
    })
    if (reserved.error) {
      if (sendDatabaseError(request, reply, reserved.error)) return
      throw reserved.error
    }
    const photo = reserved.data as { id: string; storage_path: string }
    const signed = await service.storage.from(PLAYERBOARD_PHOTO_BUCKET).createSignedUploadUrl(photo.storage_path)
    if (signed.error) {
      await service.from('playerboard_training_photos').delete().eq('id', photo.id)
      throw signed.error
    }
    return reply.code(201).send(PlayerboardPhotoUploadSchema.parse({
      photoId: photo.id, uploadUrl: signed.data.signedUrl,
      // Supabase gibt signierten Upload-URLs eine feste Lebensdauer von zwei Stunden.
      expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    }))
  })

  // Abschluss: erst wenn die Datei wirklich im Bucket liegt, erscheint das Foto. Die gemeldete Groesse
  // ersetzt die angekuendigte (beide zaehlen aufs Kontingent).
  app.post('/v1/playerboard/photos/:id/complete', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const loaded = await loadPhoto(request, reply, params.id)
    if (!loaded) return
    if (!(await requirePermission(request, reply, 'training.manage', loaded.scope))) return
    const service = supabaseClients.forService()
    const slash = loaded.row.storage_path.lastIndexOf('/')
    const listing = await service.storage.from(PLAYERBOARD_PHOTO_BUCKET).list(loaded.row.storage_path.slice(0, slash), {
      search: loaded.row.storage_path.slice(slash + 1), limit: 1,
    })
    if (listing.error) throw listing.error
    const object = listing.data.find((entry) => entry.name === loaded.row.storage_path.slice(slash + 1))
    if (!object) return reply.code(409).send({ error: 'upload_missing', correlationId: request.id })
    const actualSize = Number((object.metadata as { size?: number } | null)?.size ?? loaded.row.size_bytes)
    const update = await service.from('playerboard_training_photos')
      .update({ upload_completed_at: new Date().toISOString(), ...(actualSize > 0 ? { size_bytes: actualSize } : {}) })
      .eq('id', params.id).is('upload_completed_at', null)
    if (update.error) throw update.error
    await recordAuditEvent(request, {
      organizationId: loaded.scope.organizationId, action: 'playerboard_photo.uploaded', entityType: 'playerboard_training_photos', entityId: params.id,
    })
    return reply.code(200).send(await photoResponse(request, params.id))
  })

  // Verbindlicher Einzelbild-Review (Plan 052, "Fotos"): Trainer oder Einwilligungsverwaltung.
  app.post('/v1/playerboard/photos/:id/review', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = ReviewPlayerboardPhotoRequestSchema.parse(request.body)
    const loaded = await loadPhoto(request, reply, params.id)
    if (!loaded) return
    if (!(await requirePermissionAnyOf(request, reply, ['training.manage', 'consent.manage'], loaded.scope))) return
    const result = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_review_photo_consent', {
      target_photo_id: params.id, target_people: input.people,
      all_recognizable_people_listed: input.allRecognizablePeopleListed, make_public: input.makePublic,
    })
    if (result.error) {
      if (result.error.message.includes('photo_consent_invalid')) {
        let invalid: z.infer<typeof PeopleDetailSchema> = []
        try {
          invalid = PeopleDetailSchema.parse(JSON.parse(result.error.details ?? '[]'))
        } catch {
          invalid = []
        }
        return reply.code(422).send({ error: 'photo_consent_invalid', invalid, correlationId: request.id })
      }
      if (sendDatabaseError(request, reply, result.error)) return
      throw result.error
    }
    await recordAuditEvent(request, {
      organizationId: loaded.scope.organizationId, action: 'playerboard_photo.consent_reviewed', entityType: 'playerboard_training_photos', entityId: params.id,
      metadata: { people: input.people.length, makePublic: input.makePublic },
    })
    return reply.code(200).send(await photoResponse(request, params.id))
  })

  app.put('/v1/playerboard/photos/:id/public', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SetPlayerboardPhotoPublicRequestSchema.parse(request.body)
    const loaded = await loadPhoto(request, reply, params.id)
    if (!loaded) return
    if (!(await requirePermission(request, reply, 'training.manage', loaded.scope))) return
    const result = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_set_photo_public', {
      target_photo_id: params.id, make_public: input.public,
    })
    if (result.error) {
      if (sendDatabaseError(request, reply, result.error)) return
      // CHECK playerboard_training_photos_public_requires_review (z. B. Upload nicht abgeschlossen).
      if (result.error.code === '23514') return reply.code(409).send({ error: 'photo_consent_not_approved', correlationId: request.id })
      throw result.error
    }
    await recordAuditEvent(request, {
      organizationId: loaded.scope.organizationId, action: 'playerboard_photo.visibility_changed', entityType: 'playerboard_training_photos', entityId: params.id,
      metadata: { public: input.public },
    })
    return reply.code(200).send(await photoResponse(request, params.id))
  })

  app.delete('/v1/playerboard/photos/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const loaded = await loadPhoto(request, reply, params.id)
    if (!loaded) return
    if (!(await requirePermission(request, reply, 'training.manage', loaded.scope))) return
    const result = await supabaseClients.forUser(request.auth!.accessToken).from('playerboard_training_photos').delete().eq('id', params.id).select('id')
    if (result.error) throw result.error
    if (result.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const removed = await supabaseClients.forService().storage.from(PLAYERBOARD_PHOTO_BUCKET).remove([loaded.row.storage_path])
    if (removed.error) request.log.error({ err: removed.error, correlationId: request.id }, 'playerboard photo cleanup failed')
    await recordAuditEvent(request, {
      organizationId: loaded.scope.organizationId, action: 'playerboard_photo.deleted', entityType: 'playerboard_training_photos', entityId: params.id,
    })
    return reply.code(204).send()
  })
}
