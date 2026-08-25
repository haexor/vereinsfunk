import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import type { MediaUploadService } from './routes/context.js'

type MediaMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'audio/mpeg' | 'audio/mp4'

const SignedUploadDataSchema = z.object({ signedUrl: z.string().min(1) })
const MediaAssetDataSchema = z.object({
  bucket_id: z.string().min(1),
  object_path: z.string().min(1),
  upload_status: z.string().min(1),
  mime_type: z.string().nullable(),
})
const UploadStatusRowSchema = z.object({ upload_status: z.string().min(1) })
const DownloadDataSchema = z.instanceof(Blob)

function parseSupabaseData<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data
  const error = new Error('Unexpected Supabase response')
  error.name = 'SupabaseResponseError'
  throw error
}

/**
 * Byte-sniff, never trust the client-declared Content-Type -- same reasoning as
 * apps/api/src/brandLogo.ts. video/mp4 is checked structurally only (magic bytes); there is no
 * frame-level validation or re-encode for video in this package.
 */
function detectMediaMimeType(buffer: Buffer): MediaMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return buffer.subarray(8, 12).toString('ascii') === 'M4A ' ? 'audio/mp4' : 'video/mp4'
  if ((buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)) return 'audio/mpeg'
  return null
}

/**
 * Replaces the LocalUploadService stub (Plan 045, PR 0 Step 1). create() issues a real,
 * time-boxed Supabase Storage signed upload URL (the client PUTs its bytes directly to it --
 * Fastify's own multipart limit is 8 MiB, far below the 100 MiB media ceiling, so file bytes must
 * never flow through this API process). complete() downloads the uploaded object, verifies it
 * byte-for-byte, and is the ONLY writer of media_assets.scan_status/upload_status/
 * structural_validation_status: the 2026081801 migration revokes the blanket UPDATE grant
 * authenticated used to have on media_assets, so a browser can no longer self-certify its own
 * upload as clean.
 */
export class SupabaseUploadService implements MediaUploadService {
  constructor(private readonly getServiceClient: () => SupabaseClient) {}

  async create(input: { organizationId: string; departmentId: string | null; assetId: string; filename: string; mimeType: string; byteSize: number }) {
    const objectPath = input.departmentId
      ? `organizations/${input.organizationId}/departments/${input.departmentId}/assets/${input.assetId}/${input.filename}`
      : `organizations/${input.organizationId}/assets/${input.assetId}/${input.filename}`
    const service = this.getServiceClient()
    const signed = await service.storage.from('raw-media').createSignedUploadUrl(objectPath)
    if (signed.error) throw signed.error
    const signedData = parseSupabaseData(SignedUploadDataSchema, signed.data)
    return {
      uploadUrl: signedData.signedUrl,
      objectPath,
      // Supabase's signed upload token has a fixed, non-configurable 2h server-side lifetime --
      // this is descriptive of that fact, not a value this code controls.
      expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    }
  }

  async complete(input: { assetId: string; sha256: string }): Promise<{ accepted: true; uploadStatus: string; mimeType: string | null }> {
    const service = this.getServiceClient()
    const existing = await service.from('media_assets').select('bucket_id, object_path, upload_status, mime_type').eq('id', input.assetId).single()
    if (existing.error) throw existing.error
    const existingData = parseSupabaseData(MediaAssetDataSchema, existing.data)
    // Idempotent: a second /complete call for an asset that already left 'initiated' (ready,
    // failed, quarantined, ...) must not re-download and re-process bytes that may since have
    // been superseded -- the same "never silently re-render" discipline media_derivatives already
    // enforces via enforce_immutable_derivative().
    if (existingData.upload_status !== 'initiated') return { accepted: true, uploadStatus: existingData.upload_status, mimeType: existingData.mime_type }

    // Compare-and-set on upload_status = 'initiated': two concurrent /complete calls for the same
    // asset both pass the read above before either writes. Without the .eq() below, whichever call
    // reaches this update last would silently overwrite the other's terminal state (e.g. a stale
    // retry marking an already-'ready' asset 'failed'). When no row matches, someone else already
    // resolved this asset -- report that persisted state instead of pretending this call won.
    const applyTerminalUpdate = async (payload: Record<string, unknown>, uploadStatus: string, mimeType: string | null) => {
      const update = await service.from('media_assets').update(payload).eq('id', input.assetId).eq('upload_status', 'initiated').select('upload_status')
      if (update.error) throw update.error
      if (update.data.length === 0) {
        const current = await service.from('media_assets').select('upload_status').eq('id', input.assetId).single()
        if (current.error) throw current.error
        return { accepted: true as const, uploadStatus: parseSupabaseData(UploadStatusRowSchema, current.data).upload_status, mimeType: null }
      }
      return { accepted: true as const, uploadStatus, mimeType }
    }

    const markFailed = () => applyTerminalUpdate({ structural_validation_status: 'failed', scan_status: 'failed', upload_status: 'failed' }, 'failed', null)

    const download = await service.storage.from(existingData.bucket_id).download(existingData.object_path)
    if (download.error) throw download.error
    const downloadData = parseSupabaseData(DownloadDataSchema, download.data)
    const buffer = Buffer.from(await downloadData.arrayBuffer())

    if (createHash('sha256').update(buffer).digest('hex') !== input.sha256) return markFailed()

    const detectedMimeType = detectMediaMimeType(buffer)
    if (!detectedMimeType) return markFailed()

    let normalizedBuffer = buffer
    let width: number | null = null
    let height: number | null = null
    if (detectedMimeType.startsWith('image/')) {
      try {
        const metadata = await sharp(buffer).metadata()
        // .rotate() bakes in EXIF orientation; omitting .withMetadata() during re-encode drops
        // the rest of it (GPS, camera/software identifiers, ...) -- same reasoning as brandLogo.ts.
        normalizedBuffer =
          detectedMimeType === 'image/png' ? await sharp(buffer).rotate().png().toBuffer() :
          detectedMimeType === 'image/webp' ? await sharp(buffer).rotate().webp().toBuffer() :
          await sharp(buffer).rotate().jpeg().toBuffer()
        // Dimensions must describe the ENCODED buffer: EXIF orientation 5-8 makes .rotate() swap
        // width/height relative to the original file's metadata() (same gotcha as brandLogo.ts).
        const encodedMetadata = await sharp(normalizedBuffer).metadata()
        width = encodedMetadata.width ?? metadata.width ?? null
        height = encodedMetadata.height ?? metadata.height ?? null
      } catch {
        // libvips can read IHDR-level metadata from a file whose pixel data is corrupt, so
        // metadata() above can succeed while the actual decode during re-encoding still fails.
        return markFailed()
      }
    }

    // The original client upload remains available until the durable state update succeeds. A
    // retry after a database failure therefore verifies the original bytes, never normalized ones.
    const normalizedObjectPath = `${existingData.object_path}.normalized`
    const upload = await service.storage.from(existingData.bucket_id).upload(normalizedObjectPath, normalizedBuffer, { contentType: detectedMimeType, upsert: true })
    if (upload.error) throw upload.error

    // Entscheidung (Betreiber, 2026-08-18, siehe Migration 2026081801): kein separater
    // Malware-Scanner. Ein erfolgreicher Struktur-Befund setzt scan_status direkt auf 'clean' --
    // es gibt keine zweite, unabhaengige Scan-Stufe in diesem Pfad.
    return applyTerminalUpdate({
      structural_validation_status: 'valid',
      scan_status: 'clean',
      upload_status: 'ready',
      object_path: normalizedObjectPath,
      sha256: createHash('sha256').update(normalizedBuffer).digest('hex'),
      byte_size: normalizedBuffer.length,
      mime_type: detectedMimeType,
      width, height,
      exif_stripped_at: detectedMimeType.startsWith('image/') ? new Date().toISOString() : null,
    }, 'ready', detectedMimeType)
  }
}
