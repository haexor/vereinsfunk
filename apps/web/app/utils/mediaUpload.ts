import { z } from 'zod'
import type { createApiClient } from './apiClient'
import { sha256Hex } from './sha256'

const InitiatedUploadSchema = z.object({ assetId: z.uuid(), uploadUrl: z.url() })
const UploadCompletionSchema = z.object({
  accepted: z.literal(true),
  uploadStatus: z.enum(['initiated', 'uploaded', 'normalizing', 'ready', 'quarantined', 'failed', 'deleted']),
  // Serverseitig aus den Bytes erkannt -- anders als File.type nicht vom Browser behauptet.
  mimeType: z.string().nullable(),
})

export type CompletedMediaUpload = z.infer<typeof UploadCompletionSchema> & { assetId: string }

/**
 * Der eine Upload-Ablauf fuer Medien: Reservierung (POST /v1/media/uploads), PUT an die signierte
 * URL, Pruefsumme und Abschluss. complete() prueft synchron, seine Antwort ist deshalb schon der
 * endgueltige Status -- kein erneutes Nachlesen von media_assets noetig. Was ein anderer Status
 * als 'ready' bedeutet, entscheidet der Aufrufer.
 */
export async function uploadMediaAsset(
  api: Pick<ReturnType<typeof createApiClient>, 'request'>,
  input: { organizationId: string; departmentId: string | null; file: File; onUploaded?: () => void },
): Promise<CompletedMediaUpload> {
  const { file } = input
  const initiated = await api.request('/v1/media/uploads', {
    method: 'POST',
    body: { organizationId: input.organizationId, departmentId: input.departmentId, filename: file.name, mimeType: file.type, byteSize: file.size },
  }, InitiatedUploadSchema)
  const sent = await fetch(initiated.uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type } })
  if (!sent.ok) throw new Error('upload_failed')
  input.onUploaded?.()
  const completed = await api.request(`/v1/media/${initiated.assetId}/complete`, { method: 'POST', body: { sha256: await sha256Hex(file) } }, UploadCompletionSchema)
  return { ...completed, assetId: initiated.assetId }
}
