import { z } from 'zod'
import { UuidSchema } from './primitives.js'

export const ObscuringStyleSchema = z.enum(['club_mascot', 'sports_ball', 'emoji', 'confetti_badge', 'brand_shape', 'scribble', 'pixelate', 'solid_blur'])
export const FaceDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('consented'), consentRecordId: UuidSchema }),
  z.object({ kind: z.literal('obscure'), style: ObscuringStyleSchema }), z.object({ kind: z.literal('exclude') }),
])
// Paket 015 ergaenzt drei Blocker: consent_scope_mismatch (Zeile gueltig, deckt aber nicht den
// angefragten Umfang), naming_not_allowed und sensitive_text_data (beide textbasiert, siehe
// scanTextForSensitiveData in packages/domain -- wirken unabhaengig davon, ob ueberhaupt ein Foto
// existiert).
// Plan 045, PR 0 Schritt 2: people_review_pending ist ein eigener Wert statt einer Ueberladung
// von face_pending -- "das Foto wurde noch nie gesichtet" und "eine markierte Box wartet noch auf
// eine Entscheidung" sind fuer die anzeigende Person unterschiedliche naechste Schritte.
export const MediaGateBlockerSchema = z.enum([
  'scan_pending', 'people_review_pending', 'face_pending', 'consent_invalid', 'derivative_stale', 'minor_review_required',
  'original_selected', 'consent_scope_mismatch', 'naming_not_allowed', 'sensitive_text_data',
])
export const MediaGateResultSchema = z.object({ publishable: z.boolean(), blockers: z.array(MediaGateBlockerSchema) })

// Medien-/Postuebersicht: Zusammenfassung eines media_assets-Datensatzes fuer Galerie-Ansichten
// (Beitraege-Uebersicht, Chat-Anhang-Auswahl). signedUrl ist nur fuer Bilder gesetzt -- es gibt
// keine Thumbnail-Pipeline fuer Video/Audio.
export const MediaAssetSummarySchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  peopleReviewedAt: z.iso.datetime({ offset: true }).nullable(),
  signedUrl: z.url().nullable(),
})

export type FaceDecision = z.infer<typeof FaceDecisionSchema>
export type MediaGateResult = z.infer<typeof MediaGateResultSchema>
export type MediaAssetSummary = z.infer<typeof MediaAssetSummarySchema>
export type MediaGateBlocker = z.infer<typeof MediaGateBlockerSchema>
