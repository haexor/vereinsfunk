import { z } from 'zod'
import { UuidSchema } from './content.js'

// Plan 045, PR 1: Bildstil-Presets (Rahmen, Logo-Wasserzeichen, Filter) fuer Beitragsfotos --
// mehrschichtig wie Marke (Verein/Abteilung/Mannschaft), aber ein eigener Datensatz je Preset
// statt eines Singleton-Profils je Ebene, siehe supabase/migrations/2026081916_image_style_presets.sql.
export const ImageStyleFrameTypeSchema = z.enum(['none', 'parametric', 'custom'])
// Bildstil-Nachbesserung: mehrere fertige visuelle Stile fuer den parametrischen Rahmen statt nur
// eines Vollrands -- ueber frameColor/frameWidthPx parametrisiert, siehe
// supabase/migrations/2026082001_image_style_presets_frame_style.sql. 'festlich' ist die
// Ausnahme: bewusst fest golden, ignoriert frameColor (supabase/migrations/2026082003_...).
export const ImageStyleFrameStyleSchema = z.enum([
  'solid',
  'double',
  'corner_marks',
  'bottom_bar',
  'festlich',
])
// Effekte sind absichtlich Teil des serverseitig gerenderten Presets, nicht ein CSS-Filter im
// Browser. So ist das veröffentlichte Bild reproduzierbar und auch nach einem späteren Render
// noch exakt dasselbe. "comic" ist eine stilisierte, nicht-generative Bildbearbeitung;
// "konfetti" legt eine deterministische Vektor-Dekoration über das Foto.
export const ImageStyleFilterSchema = z.enum([
  'original',
  'schwarz_weiss',
  'kontrastreich',
  'warm',
  'vereinsfarben_duoton',
  'comic',
  'konfetti',
  'gmic_vintage',
  'gmic_poster',
])
export const ImageStyleLogoPositionSchema = z.enum([
  'bottom_right',
  'bottom_left',
  'top_right',
  'top_left',
  'center',
])

// Eigene, kleine Regex statt eines geteilten Symbols aus organization.ts: dort ist HexColorSchema
// bewusst modul-privat (nicht exportiert), und jede CHECK-Constraint im Schema definiert ihr
// eigenes Muster ohnehin unabhaengig -- dieselbe Form hier zu wiederholen ist kein zusaetzliches
// Risiko, ein Re-Export waere die groessere, hier unnoetige Aenderung.
const HexOrRoleColorSchema = z.union([
  z.string().regex(/^#[0-9a-fA-F]{6}$/),
  z.enum(['primary', 'accent']),
])

const ImageStylePresetFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  frameType: ImageStyleFrameTypeSchema,
  frameStyle: ImageStyleFrameStyleSchema.nullable(),
  frameColor: HexOrRoleColorSchema.nullable(),
  frameWidthPx: z.int().min(1).max(200).nullable(),
  frameCornerRadiusPx: z.int().min(0).max(200).nullable(),
  frameBrandAssetId: UuidSchema.nullable(),
  logoEnabled: z.boolean(),
  logoBrandAssetId: UuidSchema.nullable(),
  logoPosition: ImageStyleLogoPositionSchema,
  logoSizePercent: z.int().min(4).max(30).nullable(),
  logoMarginPercent: z.int().min(0).max(15).nullable(),
  filter: ImageStyleFilterSchema,
})

// Spiegelt die CHECK-Constraints der Migration 1:1 -- ein Preset ist ein zusammenhaengendes
// Ganzes, keine Menge unabhaengiger Einzelfelder. Von Create UND Update geteilt (per superRefine
// auf beiden konkreten Schemas unten): PATCH ersetzt deshalb den gesamten Bildstil-Anteil auf
// einmal (wie das Formular auf /bildstil ihn haelt), nicht Feld fuer Feld -- ein partielles
// Patchen einzelner Rahmen-/Logo-Felder koennte sonst eine Kombination erzeugen, die dieser
// API-seitigen Pruefung entgeht, aber an der DB-CHECK-Constraint scheitert.
function checkImageStylePresetFields(
  preset: z.infer<typeof ImageStylePresetFieldsSchema>,
  context: z.RefinementCtx,
): void {
  if (
    preset.frameType === 'parametric' &&
    (preset.frameColor === null || preset.frameWidthPx === null)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['frameColor'],
      message: 'parametric frame requires frameColor and frameWidthPx',
    })
  }
  if ((preset.frameType === 'parametric') !== (preset.frameStyle !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['frameStyle'],
      message: 'parametric frame requires frameStyle, other frame types must not set it',
    })
  }
  if ((preset.frameType === 'custom') !== (preset.frameBrandAssetId !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['frameBrandAssetId'],
      message: 'custom frame requires frameBrandAssetId, other frame types must not set it',
    })
  }
  const logoFieldsComplete =
    preset.logoBrandAssetId !== null &&
    preset.logoSizePercent !== null &&
    preset.logoMarginPercent !== null
  if (preset.logoEnabled !== logoFieldsComplete) {
    context.addIssue({
      code: 'custom',
      path: ['logoBrandAssetId'],
      message:
        'logoEnabled must match presence of logoBrandAssetId, logoSizePercent and logoMarginPercent',
    })
  }
}

export const ImageStylePresetSchema = ImageStylePresetFieldsSchema.extend({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  isActive: z.boolean(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const CreateImageStylePresetRequestSchema = ImageStylePresetFieldsSchema.extend({
  organizationId: UuidSchema,
  departmentId: UuidSchema.optional(),
  teamId: UuidSchema.optional(),
}).superRefine((preset, context) => {
  checkImageStylePresetFields(preset, context)
  if (preset.teamId !== undefined && preset.departmentId === undefined) {
    context.addIssue({ code: 'custom', path: ['teamId'], message: 'teamId requires departmentId' })
  }
})

// Scope (organizationId/departmentId/teamId) ist unveraendlich -- PATCH /v1/image-style-presets/:id
// leitet ihn aus der bestehenden Zeile her, wie PATCH /v1/content-style-profiles/:id (routes/content.ts).
export const UpdateImageStylePresetRequestSchema = ImageStylePresetFieldsSchema.extend({
  isActive: z.boolean().optional(),
}).superRefine(checkImageStylePresetFields)

// Bildstil-Nachbesserung: zustandslose Vorschau eines noch nicht gespeicherten Entwurfs (Bildstil,
// PR fabric.js-Editor). name ist hier -- anders als bei Create/Update -- optional: die Vorschau muss
// schon fuer einen frisch angelegten, noch namenlosen Entwurf funktionieren (siehe
// emptyImageStylePresetDraft() in apps/web/app/utils/imageStylePresetDraft.ts).
export const PreviewImageStylePresetRequestSchema = ImageStylePresetFieldsSchema.extend({
  name: z.string().trim().max(80).optional(),
  organizationId: UuidSchema,
  departmentId: UuidSchema.optional(),
  teamId: UuidSchema.optional(),
}).superRefine((preset, context) => {
  checkImageStylePresetFields({ ...preset, name: preset.name ?? '' }, context)
  if (preset.teamId !== undefined && preset.departmentId === undefined) {
    context.addIssue({ code: 'custom', path: ['teamId'], message: 'teamId requires departmentId' })
  }
})

// Immer WebP, anders als ApplyImageStyleRenderResponse: die Vorschau geht nicht in den
// 'rendered-media'-Bucket (der nur image/jpeg und image/png zulaesst), sondern als data:-URL in ein
// Canvas -- WebP behaelt den Alphakanal bei einem Bruchteil der Base64-Groesse (siehe encodePreview
// in apps/api/src/routes/imageStyle.ts).
export const PreviewImageStylePresetResponseSchema = z.object({
  imageBase64: z.string().min(1),
  contentType: z.literal('image/webp'),
  width: z.int(),
  height: z.int(),
  filterProvider: z.string(),
})

// Plan 045, PR 2: POST /v1/post-media/:postMediaId/style-render. Antwort trägt objectPath
// zusätzlich zur signedUrl mit -- dieselbe Signatur wie marke.vue/bildstil.vue sie sich später
// selbst über supabase.storage...createSignedUrl(objectPath, 600) neu holen können, ohne die
// (nur 600s gültige) URL dieser Antwort zwischenspeichern zu müssen.
export const ApplyImageStyleRenderRequestSchema = z.object({ stylePresetId: UuidSchema })
export const ApplyImageStyleRenderResponseSchema = z.object({
  mediaDerivativeId: UuidSchema,
  objectPath: z.string().min(1),
  signedUrl: z.url(),
})

export type ImageStyleFrameType = z.infer<typeof ImageStyleFrameTypeSchema>
export type ImageStyleFrameStyle = z.infer<typeof ImageStyleFrameStyleSchema>
export type ImageStyleFilter = z.infer<typeof ImageStyleFilterSchema>
export type ImageStyleLogoPosition = z.infer<typeof ImageStyleLogoPositionSchema>
export type ImageStylePreset = z.infer<typeof ImageStylePresetSchema>
export type CreateImageStylePresetRequest = z.infer<typeof CreateImageStylePresetRequestSchema>
export type UpdateImageStylePresetRequest = z.infer<typeof UpdateImageStylePresetRequestSchema>
export type ApplyImageStyleRenderRequest = z.infer<typeof ApplyImageStyleRenderRequestSchema>
export type ApplyImageStyleRenderResponse = z.infer<typeof ApplyImageStyleRenderResponseSchema>
export type PreviewImageStylePresetRequest = z.infer<typeof PreviewImageStylePresetRequestSchema>
export type PreviewImageStylePresetResponse = z.infer<typeof PreviewImageStylePresetResponseSchema>
