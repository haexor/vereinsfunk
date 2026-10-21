import { ImageStyleFilterSchema } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { GmicImageEffectError } from '@vereinsfunk/media-processing'
import { renderImageStyle } from '../imageStyle.js'
import { GmicNotEnabledError } from '../imageStyleFilters.js'
import { ImageTooLargeError } from '../imageStyleInput.js'
import type { ApiRouteContext } from '../routes/context.js'
import { BrandAssetNotReadyError, loadResolvedBrandColors } from './brandResolution.js'

// style-render und die Werkstatt teilen dieselben erwartbaren Ablehnungen: G'MIC fehlt, die
// referenzierte Rahmen-/Logografik ist zwischen Pruefung und Download nicht mehr 'ready', oder das
// Foto ist zu gross. Ohne diese Zuordnung landeten sie im generischen Fehlerhandler als 500.
export function renderRejection(error: unknown): { status: number; error: string } | null {
  if (error instanceof GmicNotEnabledError) return { status: 422, error: 'gmic_not_enabled' }
  if (error instanceof BrandAssetNotReadyError) return { status: 422, error: 'brand_asset_not_ready' }
  if (error instanceof ImageTooLargeError) return { status: 413, error: 'image_too_large' }
  return null
}

// Die Galerie wird angeschaut, nicht veroeffentlicht -- deshalb NICHT das Format aus encodeResult
// (imageStyle.ts) uebernehmen: das waehlt fuer jedes Ergebnis mit echter Transparenz und fuer jede
// PNG-Quelle verlustfreies PNG. WebP q80 behaelt den Alphakanal und bleibt als Base64 im JSON klein.
async function encodePreview(buffer: Buffer, maxWidth: number): Promise<{ buffer: Buffer; width: number; height: number }> {
  const encoded = await sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true })
  return { buffer: encoded.data, width: encoded.info.width, height: encoded.info.height }
}

type FilterPreviewsResult = {
  previews: { filter: (typeof ImageStyleFilterSchema.options)[number]; imageBase64: string; contentType: 'image/webp'; filterProvider: string }[]
  unavailableFilters: (typeof ImageStyleFilterSchema.options)[number][]
}

/** Renders each gallery filter server-side and reports unavailable provider effects separately. */
async function renderImageStyleFilterPreviews(
  context: ApiRouteContext,
  sourceBuffer: Buffer,
  brandColors: { primaryColor: string; accentColor: string },
  signal?: AbortSignal,
): Promise<FilterPreviewsResult> {
  // Der vollständige Katalog wird auf einem kleinen Eingangsfoto gerechnet.
  const gallerySource = await sharp(sourceBuffer).resize({ width: 360, withoutEnlargement: true }).png().toBuffer()
  const previews: FilterPreviewsResult['previews'] = []
  const unavailableFilters: FilterPreviewsResult['unavailableFilters'] = []
  // Nie den kompletten Satz gleichzeitig starten: G'MIC läuft pro Rezept in einem eigenen
  // Prozess. Dreier-Batches halten die Galerie zügig, ohne den API-Container zu überfahren.
  for (let start = 0; start < ImageStyleFilterSchema.options.length; start += 3) {
    signal?.throwIfAborted()
    const batch = ImageStyleFilterSchema.options.slice(start, start + 3)
    const results = await Promise.all(batch.map(async (filter) => {
      try {
        const rendered = await renderImageStyle({
          sourceBuffer: gallerySource,
          preset: {
            frameType: 'none', frameStyle: null, frameColor: null, frameWidthPx: null,
            frameCornerRadiusPx: null, logoEnabled: false, logoPosition: 'bottom_right',
            logoSizePercent: null, logoMarginPercent: null, filter,
          },
          brandColors,
          ...(signal ? { signal } : {}),
          ...(context.imageEffects ? { imageEffects: context.imageEffects } : {}),
        })
        const preview = await encodePreview(rendered.buffer, 360)
        return { available: true as const, filter, imageBase64: preview.buffer.toString('base64'), contentType: 'image/webp' as const, filterProvider: rendered.filterProvider }
      } catch (error) {
        if (error instanceof GmicNotEnabledError || error instanceof GmicImageEffectError)
          return { available: false as const, filter }
        throw error
      }
    }))
    for (const result of results) {
      if (result.available) previews.push(result)
      else unavailableFilters.push(result.filter)
    }
  }
  return { previews, unavailableFilters }
}

/** Resolves brand colors for an uploaded crop and renders its complete filter gallery. */
export async function previewWorkshopImageStyleFilters(
  service: SupabaseClient,
  context: ApiRouteContext,
  sourceBuffer: Buffer,
  input: { organizationId: string },
  scope: { departmentId?: string; teamId?: string },
  signal?: AbortSignal,
): Promise<FilterPreviewsResult> {
  const brandColors = await loadResolvedBrandColors(
    service,
    input.organizationId,
    scope.departmentId ?? null,
    scope.teamId ?? null,
  )
  return renderImageStyleFilterPreviews(context, sourceBuffer, brandColors, signal)
}
