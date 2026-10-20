import { ImageStyleFilterSchema, type PreviewImageStylePresetRequest } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { GmicImageEffectError } from '@vereinsfunk/media-processing'
import { renderImageStyle } from '../imageStyle.js'
import { GmicNotEnabledError } from '../imageStyleFilters.js'
import { ImageTooLargeError } from '../imageStyleInput.js'
import type { ApiRouteContext } from '../routes/context.js'
import { BrandAssetNotReadyError, downloadBrandAssetBuffer, loadResolvedBrandColors } from './brandResolution.js'

// Vorschau und style-render teilen dieselben erwartbaren Ablehnungen: G'MIC fehlt, die
// referenzierte Rahmen-/Logografik ist zwischen Pruefung und Download nicht mehr 'ready', oder das
// Foto ist zu gross. Ohne diese Zuordnung landeten sie im generischen Fehlerhandler als 500.
export function renderRejection(error: unknown): { status: number; error: string } | null {
  if (error instanceof GmicNotEnabledError) return { status: 422, error: 'gmic_not_enabled' }
  if (error instanceof BrandAssetNotReadyError) return { status: 422, error: 'brand_asset_not_ready' }
  if (error instanceof ImageTooLargeError) return { status: 413, error: 'image_too_large' }
  return null
}

// Bildstil-Vorschau: rendert einen noch nicht gespeicherten Entwurf gegen das feste Beispielfoto
// (context.samplePhotoLoader). Reine Berechnung -- kein Storage-Upload, kein DB-Write, keine RPC,
// anders als style-render (routes/imageStyleRender.ts).
interface ImageStylePreviewResult {
  imageBase64: string
  contentType: 'image/webp'
  width: number
  height: number
  filterProvider: string
}

// Die Vorschau wird angeschaut, nicht veroeffentlicht -- deshalb NICHT das Format aus encodeResult
// (imageStyle.ts) uebernehmen: das waehlt fuer jedes Ergebnis mit echter Transparenz (abgerundete
// Ecken, 'double'-Rahmen) und fuer jede PNG-Quelle verlustfreies PNG und liefert damit
// gemessene 4,3 MB -- als Base64 im JSON-Body 5,7 MB, und das bei bis zu 30 Anfragen/Minute je
// Nutzer. WebP q80 auf 1200 px Breite behaelt den Alphakanal, ist auf derselben Messung 0,26 MB
// Base64 und immer noch doppelt so breit wie die Editorspalte je darstellt (~600 CSS-px).
const PREVIEW_MAX_WIDTH = 1200

async function encodePreview(
  buffer: Buffer,
  maxWidth = PREVIEW_MAX_WIDTH,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const encoded = await sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true })
  return { buffer: encoded.data, width: encoded.info.width, height: encoded.info.height }
}

export async function previewImageStyle(
  service: SupabaseClient,
  context: ApiRouteContext,
  input: PreviewImageStylePresetRequest,
  scope: { departmentId?: string; teamId?: string },
): Promise<ImageStylePreviewResult> {
  const [sourceBuffer, frameAssetBuffer, logoAssetBuffer, brandColors] = await Promise.all([
    context.samplePhotoLoader(),
    input.frameType === 'custom' && input.frameBrandAssetId
      ? downloadBrandAssetBuffer(service, input.organizationId, input.frameBrandAssetId)
      : Promise.resolve(undefined),
    input.logoEnabled && input.logoBrandAssetId
      ? downloadBrandAssetBuffer(service, input.organizationId, input.logoBrandAssetId)
      : Promise.resolve(undefined),
    loadResolvedBrandColors(
      service,
      input.organizationId,
      scope.departmentId ?? null,
      scope.teamId ?? null,
    ),
  ])
  const rendered = await renderImageStyle({
    sourceBuffer,
    preset: input,
    brandColors,
    ...(context.imageEffects ? { imageEffects: context.imageEffects } : {}),
    ...(frameAssetBuffer ? { frameAssetBuffer } : {}),
    ...(logoAssetBuffer ? { logoAssetBuffer } : {}),
  })
  const preview = await encodePreview(rendered.buffer)
  return {
    imageBase64: preview.buffer.toString('base64'),
    contentType: 'image/webp',
    width: preview.width,
    height: preview.height,
    filterProvider: rendered.filterProvider,
  }
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
  // Der vollständige Katalog wird auf einem kleinen Eingangsfoto gerechnet. Die große
  // Live-Vorschau verwendet weiterhin das hochauflösende Beispielbild.
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

/** Loads the sample image and resolved brand colors before rendering the preset gallery. */
export async function previewImageStyleFilters(
  service: SupabaseClient,
  context: ApiRouteContext,
  input: { organizationId: string; departmentId?: string | undefined; teamId?: string | undefined },
  scope: { departmentId?: string; teamId?: string },
): Promise<FilterPreviewsResult> {
  const [sourceBuffer, brandColors] = await Promise.all([
    context.samplePhotoLoader(),
    loadResolvedBrandColors(service, input.organizationId, scope.departmentId ?? null, scope.teamId ?? null),
  ])
  return renderImageStyleFilterPreviews(context, sourceBuffer, brandColors)
}

/** Resolves brand colors for an uploaded crop and renders its complete filter gallery. */
export async function previewWorkshopImageStyleFilters(
  service: SupabaseClient,
  context: ApiRouteContext,
  sourceBuffer: Buffer,
  input: { organizationId: string },
  scope: { departmentId?: string; teamId?: string },
  signal?: AbortSignal,
): ReturnType<typeof previewImageStyleFilters> {
  const brandColors = await loadResolvedBrandColors(
    service,
    input.organizationId,
    scope.departmentId ?? null,
    scope.teamId ?? null,
  )
  return renderImageStyleFilterPreviews(context, sourceBuffer, brandColors, signal)
}
