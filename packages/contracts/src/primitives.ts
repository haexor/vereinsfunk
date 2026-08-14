import { z } from 'zod'

// Kleine Bausteine, die mehrere Fachmodule teilen. Bewusst NICHT im Barrel: sie waren im
// urspruenglichen index.ts modul-privat und sollen es nach der Aufteilung bleiben.
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/)

// Eine einzige Quelle fuer die Social-Media-Plattformen. Liegt hier und nicht in channels.ts, weil
// content.ts sie ebenfalls braucht (Ziel-Plattformen eines Beitrags) und channels.ts UuidSchema aus
// content.ts importiert -- ein Import in die andere Richtung waere ein Zyklus.
//
// Bewusst EINE Menge fuer Kanaele und Textwerkstatt: auf welchen Plattformen ein Beitrag entstehen
// darf, ist genau die Menge, auf die ueberhaupt veroeffentlicht werden kann. Eine getrennte
// Textwerkstatt-Kopie wuerde bei jedem neuen Kanal (Twitter/LinkedIn/Mastodon sind vorgesehen)
// auseinanderlaufen. Jede neue Plattform braucht dafuer eine Zeile in
// text_generation_platform_defaults -- siehe STOP conditions in plans/042.
//
// 'website' (Plan 039): die eigene Vereinswebsite/der eigene Blog ist ein Kanal wie jeder andere,
// kein Sonderfall. Was ihn von Instagram/Facebook unterscheidet -- kein OAuth-Token, eine eigene
// Adresse statt einer externen Konto-ID -- sitzt an den Spalten von social_connections, nicht an
// diesem Enum (siehe MetaOAuthPlatformSchema in channels.ts fuer die enger gefasste OAuth-Menge).
export const SocialPlatformSchema = z.enum(['instagram', 'facebook', 'website'])
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>
