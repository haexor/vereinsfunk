import {
  ImageStyleFilterPreviewsResponseSchema,
  ImageStyleFilterSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { readMultipartUpload, type MultipartUploadResult } from '../multipartUpload.js'
import { assertImageStyleInputSize, ImageTooLargeError } from '../imageStyleInput.js'
import { GmicImageEffectError } from '@vereinsfunk/media-processing'
import { renderImageStyle } from '../imageStyle.js'
import { GmicNotEnabledError } from '../imageStyleFilters.js'
import type { ApiRouteContext } from './context.js'
import { resolveDirectoryScope } from '../services/scopeAuthorization.js'
import { loadResolvedBrandColors } from '../services/brandResolution.js'
import { previewWorkshopImageStyleFilters } from '../services/imageStyleRendering.js'

const WorkshopFilterFieldsSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable().optional(),
  filter: ImageStyleFilterSchema,
})

const WorkshopFilterPreviewsFieldsSchema = WorkshopFilterFieldsSchema.omit({ filter: true })

const WorkshopImageMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

const WorkshopFilterMultipartSchema = WorkshopFilterFieldsSchema.extend({
  mimetype: WorkshopImageMimeTypeSchema,
})

const WorkshopFilterPreviewsMultipartSchema = WorkshopFilterPreviewsFieldsSchema.extend({
  mimetype: WorkshopImageMimeTypeSchema,
})

// Am Response-Stream statt am Request lauschen: der Multipart-Body ist hier bereits vollstaendig
// gelesen, und danach feuert Node auf request.raw weder 'aborted' noch 'close' -- ein getrennter
// Client liess die komplette G'MIC-Galerie trotzdem weiterrechnen. Ein 'close' der Antwort vor
// ihrem Ende bedeutet dagegen immer, dass die Verbindung weg ist.
function createRequestAbortController(reply: FastifyReply): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const abortOnDisconnect = () => {
    if (!reply.raw.writableEnded) controller.abort()
  }
  if (reply.raw.destroyed) abortOnDisconnect()
  reply.raw.once('close', abortOnDisconnect)
  return {
    signal: controller.signal,
    dispose: () => reply.raw.off('close', abortOnDisconnect),
  }
}

// Beide Werkstatt-Routen nehmen dasselbe lokal zugeschnittene Foto entgegen. Eine Datei, die sharp
// nicht lesen kann, ist 422 invalid_image; die Pixelgrenze gilt schon vor dem Berechtigungscheck,
// damit kein Rendering an einem zu grossen Foto startet.
async function readWorkshopUpload<Schema extends z.ZodType>(
  request: FastifyRequest,
  schema: Schema,
): Promise<MultipartUploadResult<z.output<Schema>>> {
  const upload = await readMultipartUpload(request, schema, {
    fileSize: 100 * 1024 * 1024,
    unsupportedMimetypeError: 'unsupported_image_type',
  })
  if (!upload.ok) return upload
  try {
    await assertImageStyleInputSize(upload.buffer)
  } catch (error) {
    if (error instanceof ImageTooLargeError) return { ok: false, status: 413, error: 'image_too_large' }
    return { ok: false, status: 422, error: 'invalid_image' }
  }
  return upload
}

export function registerImageStyleWorkshopRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, checkRateLimit } = context

  // Der Upload-Editor darf G'MIC nicht durch CSS imitieren: die Ergebnisse wären irreführend
  // und das gespeicherte Bild sähe anders aus als die Vorschau. Der Browser übergibt hier nur
  // das bereits lokal zugeschnittene Bild; die Bytes werden nicht gespeichert oder geloggt.
  app.post('/v1/image-style-workshop/filter', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!checkRateLimit(`image-style-workshop-filter:${request.auth!.userId}`, 30, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const upload = await readWorkshopUpload(request, WorkshopFilterMultipartSchema)
    if (!upload.ok) return reply.code(upload.status).send({ error: upload.error, correlationId: request.id })
    const { buffer: sourceBuffer, fields: input } = upload

    const client = supabaseClients.forUser(request.auth!.accessToken)
    const resolvedScope = await resolveDirectoryScope(client, input.organizationId, input.departmentId ?? null, null)
    if (resolvedScope === null)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', resolvedScope))) return

    try {
      const brandColors = await loadResolvedBrandColors(
        supabaseClients.forService(),
        input.organizationId,
        resolvedScope.departmentId ?? null,
        null,
      )
      const rendered = await renderImageStyle({
        sourceBuffer,
        preset: {
          frameType: 'none', frameStyle: null, frameColor: null, frameWidthPx: null,
          frameCornerRadiusPx: null, logoEnabled: false, logoPosition: 'bottom_right',
          logoSizePercent: null, logoMarginPercent: null, filter: input.filter,
        },
        brandColors,
        ...(context.imageEffects ? { imageEffects: context.imageEffects } : {}),
      })
      return reply.type(rendered.contentType).send(rendered.buffer)
    } catch (error) {
      if (error instanceof GmicNotEnabledError || error instanceof GmicImageEffectError)
        return reply.code(422).send({ error: 'gmic_not_enabled', correlationId: request.id })
      throw error
    }
  })

  // Die Vorschaukacheln gehören zum selben Upload-Workshop, sind aber ein eigener, teurer
  // Galerie-Request. Ein eigener Bucket verhindert, dass die vielen internen G'MIC-Berechnungen
  // das Rate-Limit des interaktiven Einzel-Filter-Requests oben aufbrauchen.
  app.post('/v1/image-style-workshop/filter-previews', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!checkRateLimit(`image-style-workshop-filter-previews:${request.auth!.userId}`, 6, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const upload = await readWorkshopUpload(request, WorkshopFilterPreviewsMultipartSchema)
    if (!upload.ok) return reply.code(upload.status).send({ error: upload.error, correlationId: request.id })
    const { buffer: sourceBuffer, fields: input } = upload

    const client = supabaseClients.forUser(request.auth!.accessToken)
    const resolvedScope = await resolveDirectoryScope(client, input.organizationId, input.departmentId ?? null, null)
    if (resolvedScope === null)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', resolvedScope))) return

    const requestAbort = createRequestAbortController(reply)
    try {
      const result = await previewWorkshopImageStyleFilters(
        supabaseClients.forService(),
        context,
        sourceBuffer,
        input,
        resolvedScope,
        requestAbort.signal,
      )
      if (requestAbort.signal.aborted) return
      return reply.code(200).send(ImageStyleFilterPreviewsResponseSchema.parse(result))
    } catch (error) {
      if (requestAbort.signal.aborted) return
      throw error
    } finally {
      requestAbort.dispose()
    }
  })
}
