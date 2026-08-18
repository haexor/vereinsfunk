import type { SupabaseClient } from '@supabase/supabase-js'

const EXTENSION_BY_MIME_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' }

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
  const readyPassThrough = existingRows.data.find((row) => row.status === 'ready' && (row.recipe as { kind?: string } | null)?.kind === 'pass_through_v1')
  if (readyPassThrough) return { id: readyPassThrough.id as string }

  const asset = await service.from('media_assets').select('bucket_id, object_path, mime_type, byte_size, sha256, width, height, upload_status').eq('id', mediaAssetId).single()
  if (asset.error) throw asset.error
  // The attaching route already required a 'ready' asset, but this stays a hard precondition
  // here too -- a still-'initiated'/'quarantined' asset has no normalized bytes worth copying.
  if (asset.data.upload_status !== 'ready') return { error: 'media_asset_not_ready' }

  const download = await service.storage.from(asset.data.bucket_id).download(asset.data.object_path)
  if (download.error) throw download.error
  const buffer = Buffer.from(await download.data.arrayBuffer())

  const extension = EXTENSION_BY_MIME_TYPE[asset.data.mime_type] ?? 'bin'
  const targetPath = `organizations/${organizationId}/derivatives/${mediaAssetId}/pass-through.${extension}`
  const upload = await service.storage.from('rendered-media').upload(targetPath, buffer, { contentType: asset.data.mime_type, upsert: true })
  if (upload.error) throw upload.error

  const inserted = await service.from('media_derivatives').insert({
    organization_id: organizationId, media_asset_id: mediaAssetId,
    recipe: { kind: 'pass_through_v1' }, recipe_version: 'pass-through-v1',
    object_path: targetPath, sha256: asset.data.sha256, mime_type: asset.data.mime_type, byte_size: asset.data.byte_size,
    width: asset.data.width, height: asset.data.height, status: 'ready', ready_at: new Date().toISOString(),
  }).select('id').single()
  if (inserted.error) throw inserted.error
  return { id: inserted.data.id as string }
}
