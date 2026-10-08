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
  // Der Kader-Eintrag der aufrufenden Person (ihr Konto ist mit der Verzeichnisperson verknuepft):
  // die Spieleransicht hebt die eigene Zeile hervor.
  isSelf: z.boolean(),
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

export const PlayerboardInviteResponseSchema = z.object({
  emailDelivered: z.boolean(),
})

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
  // Nur Mannschaft mit Slug: Pfad der oeffentlichen Mannschaftsseite (/mannschaft/{verein}/{mannschaft}).
  publicPath: z.string().nullable(),
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

// Einwilligungsstand je Kaderspieler fuer oeffentliche Trainingsfotos: die juengste Einwilligung,
// die der Foto-Review akzeptieren wuerde, oder null.
export const PlayerboardPhotoConsentSchema = z.object({
  playerId: UuidSchema,
  directoryPersonId: UuidSchema,
  consentRecordId: UuidSchema.nullable(),
})

// --- Oeffentliche Mannschaftsseite --------------------------------------------------------------

export const PublicPlayerboardTeamSchema = z.object({
  organizationName: z.string(),
  teamName: z.string(),
  tabs: z.object({ points: z.boolean(), veoStats: z.boolean(), photos: z.boolean() }),
  // Anfang der laufenden Saison (wirksamer Saisonbeginn der Mannschaft), null ohne Saisonbeginn:
  // die oeffentliche Rangliste zeigt dann die gesamte Zeit.
  seasonFrom: DateSchema.nullable(),
  // Wirksame Vereinsfarben der Mannschaft (resolveBrand).
  brand: z.object({ primaryColor: z.string(), accentColor: z.string() }),
  // Zeitzone des Vereins fuer Anstosszeiten der Spiele (Paket 053).
  timezone: z.string().min(1),
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

// --- Veo (Paket 053) ------------------------------------------------------------------------------

// E-Mail und Passwort dienen nur der einmaligen Anmeldung bei Veo und werden nie gespeichert.
export const PlayerboardVeoLoginRequestSchema = z.object({
  teamId: UuidSchema,
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
}).strict()

const VeoSlugSchema = z.string().trim().min(1).max(200)

export const PlayerboardVeoClubSchema = z.object({
  slug: VeoSlugSchema,
  name: z.string().min(1).max(200),
  teams: z.array(z.object({ slug: VeoSlugSchema, name: z.string().min(1).max(200) })),
})

// linkToken: das verschluesselte Session-Cookie fuer den folgenden Link-Aufruf, kurz gueltig und
// an Mannschaft und Person gebunden. Der Browser kann es nicht entschluesseln.
export const PlayerboardVeoLoginResponseSchema = z.object({
  linkToken: z.string().min(1),
  clubs: z.array(PlayerboardVeoClubSchema),
})

export const PlayerboardVeoLinkRequestSchema = z.object({
  teamId: UuidSchema,
  linkToken: z.string().min(1).max(16_384),
  veoClubSlug: VeoSlugSchema,
  veoTeamSlug: VeoSlugSchema,
}).strict()

export const PlayerboardVeoSyncRunSchema = z.object({
  id: UuidSchema,
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled', 'aborted_loss_threshold']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  createdCount: z.number().int(),
  updatedCount: z.number().int(),
  skippedCount: z.number().int(),
  conflictCount: z.number().int(),
  errorClass: z.string().nullable(),
})

export const PlayerboardVeoStatusSchema = z.object({
  teamId: UuidSchema,
  linked: z.boolean(),
  veoClubName: z.string().nullable(),
  veoTeamName: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  lastErrorCode: z.string().nullable(),
  // Veo nimmt das gespeicherte Cookie nicht mehr an; nur eine neue Anmeldung hilft.
  needsReconnect: z.boolean(),
  runs: z.array(PlayerboardVeoSyncRunSchema),
})

export const PlayerboardVeoSyncRequestSchema = z.object({ teamId: UuidSchema }).strict()

export const PlayerboardVeoSyncAcceptedSchema = z.object({
  runId: UuidSchema,
  state: z.enum(['queued', 'already_running', 'replay']),
})

// Spiele mit Veo-Werten (PR 3). value ist Veos Rohwert: Meter, Sekunden, km/h oder eine Anzahl.
export const PlayerboardVeoStatSchema = z.object({
  statType: z.string().min(1),
  category: z.string().min(1),
  value: z.number(),
})
export const PlayerboardVeoTeamStatSchema = PlayerboardVeoStatSchema.extend({
  teamAssociation: z.enum(['own', 'opponent']),
})
const VeoMatchBaseSchema = z.object({
  kickoffAt: z.string(),
  opponentName: z.string().nullable(),
  isHome: z.boolean().nullable(),
  ownScore: z.number().int().nullable(),
  opponentScore: z.number().int().nullable(),
  teamStats: z.array(PlayerboardVeoTeamStatSchema),
})
export const PlayerboardVeoMatchSchema = VeoMatchBaseSchema.extend({
  fixtureId: UuidSchema,
  players: z.array(z.object({
    jerseyNumber: z.number().int(),
    playerId: UuidSchema.nullable(),
    name: z.string().nullable(),
    matchedManually: z.boolean(),
    stats: z.array(PlayerboardVeoStatSchema),
  })),
})
// Oeffentlich: keine IDs, Spieler nur als "#7 M. K." bzw. "#7".
export const PublicPlayerboardVeoMatchSchema = VeoMatchBaseSchema.extend({
  players: z.array(z.object({
    jerseyNumber: z.number().int(),
    label: z.string(),
    stats: z.array(PlayerboardVeoStatSchema),
  })),
})

export const AssignPlayerboardVeoJerseyRequestSchema = z.object({
  fixtureId: UuidSchema,
  jerseyNumber: z.number().int().min(0),
  // null = bewusst nicht zugeordnet.
  playerId: UuidSchema.nullable(),
  // Dieselbe Nummer in allen Spielen uebernehmen, in denen sie noch offen ist.
  applyToUnassigned: z.boolean().default(false),
}).strict()
export const AssignPlayerboardVeoJerseyResponseSchema = z.object({ changed: z.number().int() })

// Ein Veo-Spiel, das der Abgleich keinem Spiel im Spielplan eindeutig zuordnen konnte.
export const PlayerboardVeoConflictSchema = z.object({
  id: UuidSchema,
  label: z.string(),
  veoStart: z.string().nullable(),
  candidates: z.array(z.object({
    fixtureId: UuidSchema,
    kickoffAt: z.string().nullable(),
    opponentName: z.string().nullable(),
    isHome: z.boolean().nullable(),
  })),
})
export const ResolvePlayerboardVeoConflictRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fixture'), fixtureId: UuidSchema }).strict(),
  z.object({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('ignore') }).strict(),
])

export type PlayerboardStatsVisibility = z.infer<typeof PlayerboardStatsVisibilitySchema>
export type PlayerboardOverridableField = z.infer<typeof PlayerboardOverridableFieldSchema>
export type PlayerboardPlayer = z.infer<typeof PlayerboardPlayerSchema>
export type CreatePlayerboardPlayerRequest = z.infer<typeof CreatePlayerboardPlayerRequestSchema>
export type UpdatePlayerboardPlayerRequest = z.infer<typeof UpdatePlayerboardPlayerRequestSchema>
export type PlayerboardInviteResponse = z.infer<typeof PlayerboardInviteResponseSchema>
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
export type PlayerboardPhotoConsent = z.infer<typeof PlayerboardPhotoConsentSchema>
export type ReviewPlayerboardPhotoRequest = z.infer<typeof ReviewPlayerboardPhotoRequestSchema>
export type PublicPlayerboardTeam = z.infer<typeof PublicPlayerboardTeamSchema>
export type PublicPlayerboardRankingEntry = z.infer<typeof PublicPlayerboardRankingEntrySchema>
export type PublicPlayerboardPhoto = z.infer<typeof PublicPlayerboardPhotoSchema>
export type PlayerboardVeoLoginRequest = z.infer<typeof PlayerboardVeoLoginRequestSchema>
export type PlayerboardVeoLoginResponse = z.infer<typeof PlayerboardVeoLoginResponseSchema>
export type PlayerboardVeoLinkRequest = z.infer<typeof PlayerboardVeoLinkRequestSchema>
export type PlayerboardVeoStatus = z.infer<typeof PlayerboardVeoStatusSchema>
export type PlayerboardVeoSyncAccepted = z.infer<typeof PlayerboardVeoSyncAcceptedSchema>
export type PlayerboardVeoStat = z.infer<typeof PlayerboardVeoStatSchema>
export type PlayerboardVeoTeamStat = z.infer<typeof PlayerboardVeoTeamStatSchema>
export type PlayerboardVeoMatch = z.infer<typeof PlayerboardVeoMatchSchema>
export type PublicPlayerboardVeoMatch = z.infer<typeof PublicPlayerboardVeoMatchSchema>
export type AssignPlayerboardVeoJerseyRequest = z.infer<typeof AssignPlayerboardVeoJerseyRequestSchema>
export type PlayerboardVeoConflict = z.infer<typeof PlayerboardVeoConflictSchema>
export type ResolvePlayerboardVeoConflictRequest = z.infer<typeof ResolvePlayerboardVeoConflictRequestSchema>
export type PlayerboardVeoSyncRun = z.infer<typeof PlayerboardVeoSyncRunSchema>
