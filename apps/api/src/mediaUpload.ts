import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { MediaUploadService } from './routes/context.js'

type MediaMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4'

/**
 * Byte-sniff, never trust the client-declared Content-Type -- same reasoning as
 * apps/api/src/brandLogo.ts. video/mp4 is checked structurally only (magic bytes); there is no
 * frame-level validation or re-encode for video in this package.
 */
function detectMediaMimeType(buffer: Buffer): MediaMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4'
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

  async create(input: { organizationId: string; departmentId: string; assetId: string; filename: string; mimeType: string; byteSize: number }) {
    const objectPath = `organizations/${input.organizationId}/departments/${input.departmentId}/assets/${input.assetId}/${input.filename}`
    const service = this.getServiceClient()
    const signed = await service.storage.from('raw-media').createSignedUploadUrl(objectPath)
    if (signed.error) throw signed.error
    return {
      uploadUrl: signed.data.signedUrl,
      objectPath,
      // Supabase's signed upload token has a fixed, non-configurable 2h server-side lifetime --
      // this is descriptive of that fact, not a value this code controls.
      expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    }
  }

  async complete(input: { assetId: string; sha256: string }): Promise<{ accepted: true }> {
    const service = this.getServiceClient()
    const existing = await service.from('media_assets').select('bucket_id, object_path, upload_status').eq('id', input.assetId).single()
    if (existing.error) throw existing.error
    // Idempotent: a second /complete call for an asset that already left 'initiated' (ready,
    // failed, quarantined, ...) must not re-download and re-process bytes that may since have
    // been superseded -- the same "never silently re-render" discipline media_derivatives already
    // enforces via enforce_immutable_derivative().
    if (existing.data.upload_status !== 'initiated') return { accepted: true }

    const markFailed = async () => {
      const update = await service.from('media_assets').update({ structural_validation_status: 'failed', upload_status: 'failed' }).eq('id', input.assetId)
      if (update.error) throw update.error
      return { accepted: true as const }
    }

    const download = await service.storage.from(existing.data.bucket_id).download(existing.data.object_path)
    if (download.error) throw download.error
    const buffer = Buffer.from(await download.data.arrayBuffer())

    if (createHash('sha256').update(buffer).digest('hex') !== input.sha256) return markFailed()

    const detectedMimeType = detectMediaMimeType(buffer)
    if (!detectedMimeType) return markFailed()

    let normalizedBuffer = buffer
    let width: number | null = null
    let height: number | null = null
    if (detectedMimeType !== 'video/mp4') {
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

    const upload = await service.storage.from(existing.data.bucket_id).upload(existing.data.object_path, normalizedBuffer, { contentType: detectedMimeType, upsert: true })
    if (upload.error) throw upload.error

    // Entscheidung (Betreiber, 2026-08-18, siehe Migration 2026081801): kein separater
    // Malware-Scanner. Ein erfolgreicher Struktur-Befund setzt scan_status direkt auf 'clean' --
    // es gibt keine zweite, unabhaengige Scan-Stufe in diesem Pfad.
    const update = await service.from('media_assets').update({
      structural_validation_status: 'valid',
      scan_status: 'clean',
      upload_status: 'ready',
      sha256: createHash('sha256').update(normalizedBuffer).digest('hex'),
      byte_size: normalizedBuffer.length,
      mime_type: detectedMimeType,
      width, height,
      exif_stripped_at: detectedMimeType === 'video/mp4' ? null : new Date().toISOString(),
    }).eq('id', input.assetId)
    if (update.error) throw update.error

    return { accepted: true }
  }
}
