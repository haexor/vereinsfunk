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
export const SocialPlatformSchema = z.enum(['instagram', 'facebook'])
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>
