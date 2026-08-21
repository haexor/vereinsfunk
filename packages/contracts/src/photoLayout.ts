import { z } from 'zod'
import { UuidSchema } from './content.js'

// Plan 047, PR 1: "Bildkomposition" -- mehrere Fotos zu einem Layout zusammensetzen. Interne
// Bezeichner heissen bewusst "photoLayout", nicht "composition"/"collage": beide Woerter sind im
// Code schon fuer etwas anderes vergeben (composition_session* fuer die Textwerkstatt-Sitzung,
// layoutFamily: 'collage' fuer das noch ungebaute Remotion-Video-Layout, siehe plans/047) -- ein
// drittes, eigenes "Kompositions"-Konzept unter demselben Wortstamm waere im Code kaum noch
// auseinanderzuhalten. Die deutsche Oberflaeche bleibt "Bildkomposition"/"Layout", wie schon
// "Bildstil" ueber den intern englischen image_style_presets liegt.
export const PhotoLayoutKindSchema = z.enum(['diagonal_split', 'grid_2x2', 'mixed_grid'])
export type PhotoLayoutKind = z.infer<typeof PhotoLayoutKindSchema>

// Wie viele Fotos ein Layout entgegennimmt -- einzige Quelle fuer diese Grenzen, von der Route
// (Validierung), der Rendering-Geometrie (apps/api/src/photoLayout.ts) UND der Galerie in
// erstellen.vue (welche Kacheln bei der aktuellen Foto-Anzahl anklickbar sind) gemeinsam genutzt.
// diagonal_split/grid_2x2 sind fest (die Form selbst verlangt genau 2 bzw. 4), mixed_grid ist "1
// gross + N klein" mit N zwischen 1 und 4 -- eine Deckelung bei insgesamt 5 haelt die kleinen
// Kacheln in einem "Layout-Startsatz" noch lesbar gross.
export const PHOTO_LAYOUT_PHOTO_COUNTS: Record<PhotoLayoutKind, { min: number; max: number }> = {
  diagonal_split: { min: 2, max: 2 },
  grid_2x2: { min: 4, max: 4 },
  mixed_grid: { min: 2, max: 5 },
}
export const PHOTO_LAYOUT_MIN_PHOTOS = Math.min(...Object.values(PHOTO_LAYOUT_PHOTO_COUNTS).map((range) => range.min))
export const PHOTO_LAYOUT_MAX_PHOTOS = Math.max(...Object.values(PHOTO_LAYOUT_PHOTO_COUNTS).map((range) => range.max))

// Deckungsgleiche Kopie der Farb-Union aus imageStyle.ts (dort bewusst modul-privat, kein
// Re-Export -- siehe dessen eigener Kommentar): Vereinsfarbe/Akzentfarbe als Rolle oder eine feste
// Hex-Farbe fuer die Trennlinie/den Gutter zwischen den Fotos.
const HexOrRoleColorSchema = z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.enum(['primary', 'accent'])])

const PhotoLayoutPresetFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: PhotoLayoutKindSchema,
  dividerColor: HexOrRoleColorSchema,
  dividerWidthPx: z.int().min(0).max(100),
  cornerRadiusPx: z.int().min(0).max(200).nullable(),
})

export const PhotoLayoutPresetSchema = PhotoLayoutPresetFieldsSchema.extend({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  isActive: z.boolean(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const CreatePhotoLayoutPresetRequestSchema = PhotoLayoutPresetFieldsSchema.extend({
  organizationId: UuidSchema,
  departmentId: UuidSchema.optional(),
  teamId: UuidSchema.optional(),
}).superRefine((preset, context) => {
  if (preset.teamId !== undefined && preset.departmentId === undefined) {
    context.addIssue({ code: 'custom', path: ['teamId'], message: 'teamId requires departmentId' })
  }
})

// Scope ist unveraendlich, wie bei UpdateImageStylePresetRequestSchema -- PATCH leitet ihn aus der
// bestehenden Zeile her.
export const UpdatePhotoLayoutPresetRequestSchema = PhotoLayoutPresetFieldsSchema.extend({
  isActive: z.boolean().optional(),
})

// POST /v1/photo-layout-presets/render: nimmt die bereits einzeln geprueften Fotos einer noch
// nicht existierenden Sitzung (erstellen.vue, vor der eigentlichen Textwerkstatt-Anlage) und ein
// Layout-Preset entgegen. departmentId ist verpflichtend wie bei POST /v1/media/uploads --
// mediaAssetIds.department_id (media_assets.department_id) muss dazu passen. Die array-Grenzen
// spiegeln die Gesamtspanne aus PHOTO_LAYOUT_PHOTO_COUNTS; welche Anzahl das gewaehlte Preset
// TATSAECHLICH verlangt, prueft erst die Route gegen dessen kind.
export const RenderPhotoLayoutRequestSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  presetId: UuidSchema,
  mediaAssetIds: z.array(UuidSchema).min(PHOTO_LAYOUT_MIN_PHOTOS).max(PHOTO_LAYOUT_MAX_PHOTOS),
})
export const RenderPhotoLayoutResponseSchema = z.object({
  mediaAssetId: UuidSchema,
  objectPath: z.string().min(1),
  signedUrl: z.url(),
})

export type PhotoLayoutPreset = z.infer<typeof PhotoLayoutPresetSchema>
export type CreatePhotoLayoutPresetRequest = z.infer<typeof CreatePhotoLayoutPresetRequestSchema>
export type UpdatePhotoLayoutPresetRequest = z.infer<typeof UpdatePhotoLayoutPresetRequestSchema>
export type RenderPhotoLayoutRequest = z.infer<typeof RenderPhotoLayoutRequestSchema>
export type RenderPhotoLayoutResponse = z.infer<typeof RenderPhotoLayoutResponseSchema>
