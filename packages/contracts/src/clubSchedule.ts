import { z } from 'zod'
import { UuidSchema } from './content.js'

// Paket 019: Mannschaften, Spielplaene, Ergebnisse und Veranstaltungen.
export const FixtureKindSchema = z.enum(['match', 'friendly', 'tournament', 'cup'])
export const FixtureStatusSchema = z.enum(['scheduled', 'postponed', 'cancelled', 'played', 'unknown'])
export const FixtureSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  teamId: UuidSchema.nullable(),
  kind: FixtureKindSchema,
  competition: z.string().nullable(),
  isHome: z.boolean().nullable(),
  ownTeamLabel: z.string().nullable(),
  opponentName: z.string().nullable(),
  kickoffAt: z.iso.datetime({ offset: true }).nullable(),
  kickoffTimeConfirmed: z.boolean(),
  venueName: z.string().nullable(),
  venueAddress: z.string().nullable(),
  status: FixtureStatusSchema,
  homeScore: z.int().min(0).nullable(),
  awayScore: z.int().min(0).nullable(),
  note: z.string().nullable(),
  announcementDismissedAt: z.iso.datetime({ offset: true }).nullable(),
  resultDismissedAt: z.iso.datetime({ offset: true }).nullable(),
  sourceId: UuidSchema.nullable(),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const ClubEventCategorySchema = z.enum([
  'general_meeting', 'festival', 'tournament', 'training_camp', 'course', 'social', 'fundraiser', 'ceremony', 'other',
])
export const ClubEventStatusSchema = z.enum(['scheduled', 'postponed', 'cancelled'])
export const ClubEventSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  category: ClubEventCategorySchema,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  allDay: z.boolean(),
  locationName: z.string().nullable(),
  locationAddress: z.string().nullable(),
  registrationUrl: z.string().nullable(),
  status: ClubEventStatusSchema,
  invitationDismissedAt: z.iso.datetime({ offset: true }).nullable(),
  sourceId: UuidSchema.nullable(),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

// Herkunftsnachweis einer vorbelegten Tatsache (plans/019, Abschnitt 3): je Fakt, aus welcher
// Quellenzeile und von welchem Stand er kommt. Von der API selbst aus der referenzierten
// fixture/club_event-Zeile berechnet, nie vom Client uebernommen.
export const FactProvenanceSchema = z.object({
  source: z.enum(['fixture', 'club_event']),
  sourceId: UuidSchema,
  capturedAt: z.iso.datetime({ offset: true }),
})
export const SourceProvenanceMapSchema = z.record(z.string(), FactProvenanceSchema)

export const ContentSuggestionKindSchema = z.enum(['fixture_announcement', 'fixture_result', 'event_invitation', 'quota_reminder'])
export const ContentSuggestionSchema = z.object({
  kind: ContentSuggestionKindSchema,
  label: z.string().min(1),
  departmentId: UuidSchema.nullable(),
  fixtureId: UuidSchema.optional(),
  clubEventId: UuidSchema.optional(),
  occursAt: z.iso.datetime({ offset: true }).optional(),
}).refine((value) => {
  if (value.kind === 'fixture_announcement' || value.kind === 'fixture_result') return value.fixtureId !== undefined && value.clubEventId === undefined
  if (value.kind === 'event_invitation') return value.clubEventId !== undefined && value.fixtureId === undefined
  return value.fixtureId === undefined && value.clubEventId === undefined
}, { message: 'reference id must match the suggestion kind' })
export const ContentSuggestionsResponseSchema = z.object({ suggestions: z.array(ContentSuggestionSchema) })

export type FixtureKind = z.infer<typeof FixtureKindSchema>
export type FixtureStatus = z.infer<typeof FixtureStatusSchema>
export type Fixture = z.infer<typeof FixtureSchema>
export type ClubEventCategory = z.infer<typeof ClubEventCategorySchema>
export type ClubEventStatus = z.infer<typeof ClubEventStatusSchema>
export type ClubEvent = z.infer<typeof ClubEventSchema>
export type FactProvenance = z.infer<typeof FactProvenanceSchema>
export type SourceProvenanceMap = z.infer<typeof SourceProvenanceMapSchema>
export type ContentSuggestionKind = z.infer<typeof ContentSuggestionKindSchema>
export type ContentSuggestion = z.infer<typeof ContentSuggestionSchema>
export type ContentSuggestionsResponse = z.infer<typeof ContentSuggestionsResponseSchema>
