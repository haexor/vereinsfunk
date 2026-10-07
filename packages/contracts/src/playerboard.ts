import { z } from 'zod'
import { UuidSchema } from './content.js'
import { ScopeLevelSchema } from './structure.js'

// --- Paket 052: Modul PlayerBoard ----------------------------------------------------------------

const DateSchema = z.iso.date()
const DateTimeSchema = z.iso.datetime({ offset: true })

export const PlayerboardStatsVisibilitySchema = z.enum(['team', 'department', 'organization'])
export const PlayerboardOverridableFieldSchema = z.enum(['season_start', 'stats_visibility'])
export const PlayerboardTrainingStatusSchema = z.enum(['draft', 'saved'])
export const PlayerboardPhotoReviewStatusSchema = z.enum(['pending', 'approved', 'blocked'])
export const PlayerboardPhotoContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

const JerseyNumberSchema = z.int().min(0).max(99)
const PositionSchema = z.string().trim().max(40)
const OptionalEmailSchema = z.string().trim().toLowerCase().pipe(z.email())

// --- Kader --------------------------------------------------------------------------------------

export const PlayerboardPlayerSchema = z.object({
  id: UuidSchema,
  teamId: UuidSchema,
  directoryPersonId: UuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  jerseyNumber: JerseyNumberSchema.nullable(),
  position: z.string().nullable(),
  active: z.boolean(),
  hasAccount: z.boolean(),
  // Nur fuer Trainer (training.manage) -- Spieler sehen keine E-Mail-Adressen ihrer Mitspieler.
  email: z.string().nullable().optional(),
})

// Entweder eine neue Person (die Verzeichnisperson entsteht im Hintergrund in der Mannschaft) oder
// eine vorhandene Person aus dem Verzeichnis der Mannschaft.
export const CreatePlayerboardPlayerRequestSchema = z.union([
  z.object({
    teamId: UuidSchema,
    directoryPersonId: UuidSchema,
    jerseyNumber: JerseyNumberSchema.nullable().optional(),
    position: PositionSchema.nullable().optional(),
  }).strict(),
  z.object({
    teamId: UuidSchema,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    birthYear: z.int().min(1900).max(2100).nullable().optional(),
    email: OptionalEmailSchema.nullable().optional(),
    jerseyNumber: JerseyNumberSchema.nullable().optional(),
    position: PositionSchema.nullable().optional(),
  }).strict(),
])

export const UpdatePlayerboardPlayerRequestSchema = z.object({
  jerseyNumber: JerseyNumberSchema.nullable().optional(),
  position: PositionSchema.nullable().optional(),
  active: z.boolean().optional(),
  // Ergaenzt die E-Mail an der Verzeichnisperson (Paket 054) -- Voraussetzung fuer eine Einladung.
  email: OptionalEmailSchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })

// Einladung eines Kaderspielers: Adresse aus dem Verzeichnis; fehlt sie dort, wird die hier
// angegebene an der Person gespeichert.
export const InvitePlayerboardPlayerRequestSchema = z.object({
  email: OptionalEmailSchema.optional(),
}).strict()

// --- Kategorien ---------------------------------------------------------------------------------

export const PlayerboardCategorySchema = z.object({
  id: UuidSchema,
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  name: z.string(),
  active: z.boolean(),
  sortOrder: z.int(),
  valueMin: z.int(),
  valueMax: z.int(),
  // Fuer eine Mannschaft: wirkt die Kategorie dort (aktiv und, bei Mannschaftskategorien,
  // team_categories_allowed)? Geerbte Kategorien zeigt die Oberflaeche schreibgeschuetzt.
  effective: z.boolean(),
  inherited: z.boolean(),
  canEdit: z.boolean(),
})

const CategoryFieldsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  sortOrder: z.int().min(0).max(10_000),
  valueMin: z.int().min(-1000).max(1000),
  valueMax: z.int().min(-1000).max(1000),
})

export const CreatePlayerboardCategoryRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  name: CategoryFieldsSchema.shape.name,
  sortOrder: CategoryFieldsSchema.shape.sortOrder.optional(),
  valueMin: CategoryFieldsSchema.shape.valueMin.default(0),
  valueMax: CategoryFieldsSchema.shape.valueMax.default(10),
}).strict().refine((value) => value.valueMin < value.valueMax, { message: 'valueMin must be below valueMax' })

export const UpdatePlayerboardCategoryRequestSchema = CategoryFieldsSchema.partial().extend({
  active: z.boolean().optional(),
}).strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })
  .refine((value) => value.valueMin === undefined || value.valueMax === undefined || value.valueMin < value.valueMax, { message: 'valueMin must be below valueMax' })

// --- Trainings und Punkte -----------------------------------------------------------------------

export const PlayerboardTrainingSchema = z.object({
  id: UuidSchema,
  teamId: UuidSchema,
  trainingDate: DateSchema,
  title: z.string().nullable(),
  status: PlayerboardTrainingStatusSchema,
  // null, wenn keine Notiz existiert ODER der Aufrufer sie nicht sehen darf (Werte nur ueber
  // stats_visibility sichtbar).
  note: z.string().nullable(),
  createdAt: DateTimeSchema,
})

export const CreatePlayerboardTrainingRequestSchema = z.object({
  teamId: UuidSchema,
  trainingDate: DateSchema,
  title: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
}).strict()

export const UpdatePlayerboardTrainingRequestSchema = z.object({
  trainingDate: DateSchema.optional(),
  title: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  status: PlayerboardTrainingStatusSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })

export const PlayerboardPointEntrySchema = z.object({
  playerId: UuidSchema,
  categoryId: UuidSchema,
  value: z.int(),
})

export const PlayerboardTrainingDetailSchema = z.object({
  training: PlayerboardTrainingSchema,
  entries: z.array(PlayerboardPointEntrySchema),
})

export const SetPlayerboardTrainingPointsRequestSchema = z.object({
  // value null = Eintrag loeschen. Bis zu 60 Spieler x 10 Kategorien je Speichern.
  entries: z.array(PlayerboardPointEntrySchema.extend({ value: z.int().nullable() })).max(600),
}).strict().refine(
  (value) => new Set(value.entries.map((entry) => `${entry.playerId}:${entry.categoryId}`)).size === value.entries.length,
  { message: 'each player and category may appear only once' },
)

export const PlayerboardRankingQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
})

export const PlayerboardRankingEntrySchema = z.object({
  playerId: UuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  jerseyNumber: JerseyNumberSchema.nullable(),
  rank: z.int().min(1),
  total: z.int(),
  // Summe je Kategorie-ID im Zeitraum.
  categoryTotals: z.record(UuidSchema, z.int()),
})

// --- Einstellungen ------------------------------------------------------------------------------

export const PlayerboardSettingsValuesSchema = z.object({
  seasonStart: DateSchema.nullable(),
  statsVisibility: PlayerboardStatsVisibilitySchema.nullable(),
  overridableFields: z.array(PlayerboardOverridableFieldSchema),
  teamCategoriesAllowed: z.boolean().nullable(),
  publicSharingAllowed: z.boolean().nullable(),
  // nur Mannschaft:
  publicPointsEnabled: z.boolean().nullable(),
  publicVeoStatsEnabled: z.boolean().nullable(),
  publicPhotosEnabled: z.boolean().nullable(),
  publicSlug: z.string().nullable(),
})

export const PlayerboardEffectiveSettingsSchema = z.object({
  seasonStart: DateSchema.nullable(),
  statsVisibility: PlayerboardStatsVisibilitySchema,
  teamCategoriesAllowed: z.boolean(),
  publicSharingAllowed: z.boolean(),
})

export const ScopePlayerboardSettingsSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  name: z.string(),
  departmentId: UuidSchema.nullable(),
  own: PlayerboardSettingsValuesSchema,
  effective: PlayerboardEffectiveSettingsSchema,
  // Ersetzbare Felder, die auf dieser Ebene keine Wirkung haben, weil oben verbindlich gesetzt.
  locked: z.object({ seasonStart: z.boolean(), statsVisibility: z.boolean() }),
  canEdit: z.boolean(),
})

const PublicSlugSchema = z.string().trim().toLowerCase().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const UpdatePlayerboardSettingsRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  patch: z.object({
    seasonStart: DateSchema.nullable(),
    statsVisibility: PlayerboardStatsVisibilitySchema.nullable(),
    overridableFields: z.array(PlayerboardOverridableFieldSchema)
      .refine((fields) => new Set(fields).size === fields.length, { message: 'fields must be unique' }),
    teamCategoriesAllowed: z.boolean().nullable(),
    publicSharingAllowed: z.boolean().nullable(),
    publicPointsEnabled: z.boolean().nullable(),
    publicVeoStatsEnabled: z.boolean().nullable(),
    publicPhotosEnabled: z.boolean().nullable(),
    publicSlug: PublicSlugSchema.nullable(),
  }).partial().strict().refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' }),
}).strict().superRefine((value, context) => {
  const teamOnly = ['publicPointsEnabled', 'publicVeoStatsEnabled', 'publicPhotosEnabled', 'publicSlug'] as const
  if (value.scope !== 'team' && teamOnly.some((field) => value.patch[field] !== undefined && value.patch[field] !== null)) {
    context.addIssue({ code: 'custom', message: 'public team page settings exist only on a team' })
  }
})

// --- Fotos --------------------------------------------------------------------------------------

export const PlayerboardPhotoPersonSchema = z.object({
  directoryPersonId: UuidSchema,
  consentRecordId: UuidSchema,
})

export const PlayerboardPhotoSchema = z.object({
  id: UuidSchema,
  trainingId: UuidSchema,
  url: z.url(),
  contentType: PlayerboardPhotoContentTypeSchema,
  sizeBytes: z.int().positive(),
  public: z.boolean(),
  consentReviewStatus: PlayerboardPhotoReviewStatusSchema,
  allRecognizablePeopleListed: z.boolean(),
  people: z.array(PlayerboardPhotoPersonSchema),
  uploadedAt: DateTimeSchema,
})

export const CreatePlayerboardPhotoUploadRequestSchema = z.object({
  contentType: PlayerboardPhotoContentTypeSchema,
  sizeBytes: z.int().positive().max(15 * 1024 * 1024),
}).strict()

export const PlayerboardPhotoUploadSchema = z.object({
  photoId: UuidSchema,
  uploadUrl: z.url(),
  expiresAt: DateTimeSchema,
})

export const ReviewPlayerboardPhotoRequestSchema = z.object({
  people: z.array(PlayerboardPhotoPersonSchema).max(60)
    .refine((people) => new Set(people.map((person) => person.directoryPersonId)).size === people.length, { message: 'each person may appear only once' }),
  // Ausdrueckliche Bestaetigung, dass keine weitere erkennbare Person uebersehen wurde.
  allRecognizablePeopleListed: z.literal(true),
  makePublic: z.boolean(),
}).strict()

export const SetPlayerboardPhotoPublicRequestSchema = z.object({ public: z.boolean() }).strict()

// --- Oeffentliche Mannschaftsseite --------------------------------------------------------------

export const PublicPlayerboardTeamSchema = z.object({
  organizationName: z.string(),
  teamName: z.string(),
  tabs: z.object({ points: z.boolean(), veoStats: z.boolean(), photos: z.boolean() }),
})

export const PublicPlayerboardRankingEntrySchema = z.object({
  rank: z.int().min(1),
  // "#7 M. K." -- nie ein Klarname (gebildet in der Datenbank, playerboard_public_label).
  label: z.string(),
  total: z.int(),
  categories: z.array(z.object({ category: z.string(), points: z.int() })),
})

export const PublicPlayerboardPhotoSchema = z.object({
  url: z.url(),
  trainingDate: DateSchema,
})

export type PlayerboardStatsVisibility = z.infer<typeof PlayerboardStatsVisibilitySchema>
export type PlayerboardOverridableField = z.infer<typeof PlayerboardOverridableFieldSchema>
export type PlayerboardPlayer = z.infer<typeof PlayerboardPlayerSchema>
export type CreatePlayerboardPlayerRequest = z.infer<typeof CreatePlayerboardPlayerRequestSchema>
export type UpdatePlayerboardPlayerRequest = z.infer<typeof UpdatePlayerboardPlayerRequestSchema>
export type PlayerboardCategory = z.infer<typeof PlayerboardCategorySchema>
export type CreatePlayerboardCategoryRequest = z.infer<typeof CreatePlayerboardCategoryRequestSchema>
export type UpdatePlayerboardCategoryRequest = z.infer<typeof UpdatePlayerboardCategoryRequestSchema>
export type PlayerboardTraining = z.infer<typeof PlayerboardTrainingSchema>
export type PlayerboardTrainingDetail = z.infer<typeof PlayerboardTrainingDetailSchema>
export type PlayerboardPointEntry = z.infer<typeof PlayerboardPointEntrySchema>
export type SetPlayerboardTrainingPointsRequest = z.infer<typeof SetPlayerboardTrainingPointsRequestSchema>
export type PlayerboardRankingEntry = z.infer<typeof PlayerboardRankingEntrySchema>
export type PlayerboardSettingsValues = z.infer<typeof PlayerboardSettingsValuesSchema>
export type PlayerboardEffectiveSettings = z.infer<typeof PlayerboardEffectiveSettingsSchema>
export type ScopePlayerboardSettings = z.infer<typeof ScopePlayerboardSettingsSchema>
export type UpdatePlayerboardSettingsRequest = z.infer<typeof UpdatePlayerboardSettingsRequestSchema>
export type PlayerboardPhoto = z.infer<typeof PlayerboardPhotoSchema>
export type PlayerboardPhotoUpload = z.infer<typeof PlayerboardPhotoUploadSchema>
export type ReviewPlayerboardPhotoRequest = z.infer<typeof ReviewPlayerboardPhotoRequestSchema>
export type PublicPlayerboardTeam = z.infer<typeof PublicPlayerboardTeamSchema>
export type PublicPlayerboardRankingEntry = z.infer<typeof PublicPlayerboardRankingEntrySchema>
export type PublicPlayerboardPhoto = z.infer<typeof PublicPlayerboardPhotoSchema>
