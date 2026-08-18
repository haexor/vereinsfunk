import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

const EXTENSION_BY_MIME_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' }
const ExistingDerivativeSchema = z.object({ id: z.string().uuid(), recipe: z.unknown().nullable(), status: z.string().min(1) })
const MediaAssetSchema = z.object({
  bucket_id: z.string().min(1), object_path: z.string().min(1), mime_type: z.string().min(1), byte_size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(), upload_status: z.string().min(1),
})
const DownloadDataSchema = z.instanceof(Blob)
const DerivativeInsertSchema = z.object({ id: z.string().uuid() })

function parseSupabaseData<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data
  const error = new Error('Unexpected Supabase response')
  error.name = 'SupabaseResponseError'
  throw error
}

/**
 * Plan 045, PR 0 Step 4: a photo attached to a composition session (composition_session_post_media)
 * becomes publishable through exactly one media_derivatives row -- a byte-for-byte copy of the
 * already-normalized original into the rendered-media bucket, tagged recipe.kind = 'pass_through_v1'.
 * PR 2 adds real Sharp compositing (frame/logo/filter) as a separate, additional derivative on the
 * same media_asset; this function only ever produces or reuses the pass-through one.
 *
 * A plain SQL function (accept_text_generation_candidate) cannot copy storage bytes between
 * buckets, so this resolution happens here, in the API route, BEFORE that RPC is called.
 */
export async function ensurePassThroughDerivative(
  service: SupabaseClient, organizationId: string, mediaAssetId: string,
): Promise<{ id: string } | { error: 'media_asset_not_ready' }> {
  const existingRows = await service.from('media_derivatives').select('id, recipe, status').eq('organization_id', organizationId).eq('media_asset_id', mediaAssetId)
  if (existingRows.error) throw existingRows.error
  const existingDerivativeRows = parseSupabaseData(z.array(ExistingDerivativeSchema), existingRows.data)
  const readyPassThrough = existingDerivativeRows.find((row) => row.status === 'ready' && (row.recipe as { kind?: string } | null)?.kind === 'pass_through_v1')
  if (readyPassThrough) return { id: readyPassThrough.id }

  const asset = await service.from('media_assets').select('bucket_id, object_path, mime_type, byte_size, sha256, width, height, upload_status').eq('id', mediaAssetId).eq('organization_id', organizationId).single()
  if (asset.error) throw asset.error
  const assetData = parseSupabaseData(MediaAssetSchema, asset.data)
  // The attaching route already required a 'ready' asset, but this stays a hard precondition
  // here too -- a still-'initiated'/'quarantined' asset has no normalized bytes worth copying.
  if (assetData.upload_status !== 'ready') return { error: 'media_asset_not_ready' }

  const download = await service.storage.from(assetData.bucket_id).download(assetData.object_path)
  if (download.error) throw download.error
  const downloadData = parseSupabaseData(DownloadDataSchema, download.data)
  const buffer = Buffer.from(await downloadData.arrayBuffer())

  const extension = EXTENSION_BY_MIME_TYPE[assetData.mime_type] ?? 'bin'
  const targetPath = `organizations/${organizationId}/derivatives/${mediaAssetId}/pass-through.${extension}`
  const upload = await service.storage.from('rendered-media').upload(targetPath, buffer, { contentType: assetData.mime_type, upsert: true })
  if (upload.error) throw upload.error

  const inserted = await service.from('media_derivatives').upsert({
    organization_id: organizationId, media_asset_id: mediaAssetId,
    recipe: { kind: 'pass_through_v1' }, recipe_version: 'pass-through-v1',
    object_path: targetPath, sha256: assetData.sha256, mime_type: assetData.mime_type, byte_size: assetData.byte_size,
    width: assetData.width, height: assetData.height, status: 'ready', ready_at: new Date().toISOString(),
  }, { onConflict: 'bucket_id,object_path' }).select('id').single()
  if (inserted.error) throw inserted.error
  return parseSupabaseData(DerivativeInsertSchema, inserted.data)
}
