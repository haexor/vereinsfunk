import { z } from 'zod'
import { UuidSchema } from './primitives.js'
import { DirectoryPersonStatusSchema } from './integrations.js'

// --- Spielerprofil auf Vereinsebene --------------------------------------------------------------
// GET /v1/people/:id/profile. Das Profil gehoert der Verzeichnisperson, nicht einem Kader-Eintrag:
// eine Person in mehreren Mannschaften hat genau ein Profil. Bewusst ohne Geburtsjahr und ohne
// isMinor -- beides bleibt im Kader und im Verzeichnis.

export const PersonProfilePeriodSchema = z.enum(['season', 'all'])

export const PersonProfileQuerySchema = z.object({
  // season = laufende Saison je Mannschaft (Saisonbeginn der Mannschaft), all = gesamte Zeit.
  period: PersonProfilePeriodSchema.default('season'),
})

export const PersonProfileVeoMatchSchema = z.object({
  fixtureId: UuidSchema,
  kickoffAt: z.string(),
  opponentName: z.string().nullable(),
  jerseyNumber: z.int().nonnegative(),
  // Rohwerte je Spiel; die Web-App berechnet daraus dieselben Saisonkennzahlen wie Veo.
  stats: z.record(z.string().min(1), z.number()),
})

export const PersonProfileTeamSchema = z.object({
  teamId: UuidSchema,
  teamName: z.string(),
  playerId: UuidSchema,
  jerseyNumber: z.int().min(0).max(99).nullable(),
  position: z.string().nullable(),
  active: z.boolean(),
  // Das Konto der aufrufenden Person ist mit dieser Verzeichnisperson verknuepft.
  isSelf: z.boolean(),
  // null, wenn die Person im Zeitraum nicht in der Rangliste steht (inaktiv und ohne Punkte).
  rank: z.int().nullable(),
  total: z.int(),
  // In der Reihenfolge der Mannschaft; nur Kategorien mit Punkten im Zeitraum.
  categories: z.array(z.object({ name: z.string(), points: z.int() })),
  // Nur Veo-Spiele, in denen die Person dieser Rueckennummer zugeordnet ist und Werte vorliegen.
  veoMatches: z.array(PersonProfileVeoMatchSchema),
})

export const PersonProfileSchema = z.object({
  id: UuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  status: DirectoryPersonStatusSchema,
  teams: z.array(PersonProfileTeamSchema),
  // Nur mit training.manage in mindestens einer sichtbaren Mannschaft der Person; sonst fehlen
  // beide Schluessel (nicht null), damit ein Fehlen nicht mit "keine E-Mail hinterlegt" verwechselt wird.
  email: z.string().nullable().optional(),
  hasAccount: z.boolean().optional(),
})

export type PersonProfilePeriod = z.infer<typeof PersonProfilePeriodSchema>
export type PersonProfileVeoMatch = z.infer<typeof PersonProfileVeoMatchSchema>
export type PersonProfileTeam = z.infer<typeof PersonProfileTeamSchema>
export type PersonProfile = z.infer<typeof PersonProfileSchema>
