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
//
// 'plaintext' ("Nur Text"): einzige echte Ausnahme von "Plattform = hat einen Kanal" -- braucht nie
// eine social_connections-Zeile, damit sich LLM/Stilprofil-Ergebnisse auch ohne verbundenen Kanal
// testen lassen. Bekommt deshalb nie eine publications-Zeile (dort bewusst nicht mit aufgenommen,
// wie schon 'website') und ist exklusiv, nicht mit anderen Plattformen kombinierbar
// (createTextGenerationSession in apps/api).
export const SocialPlatformSchema = z.enum(['instagram', 'facebook', 'twitter', 'linkedin', 'website', 'plaintext'])
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>

// Eine Quelle fuer 'plaintext ist exklusiv', geteilt von jeder Stelle, die eine Plattformliste
// entgegennimmt (createTextGenerationSession, policy.ts defaultTargetPlatforms, der
// save_content_brief-Bestaetigungspfad in apps/api/src/routes/agent.ts) -- vorher an mehreren
// Stellen unabhaengig nachgebaut, teils gar nicht (Review PR #181).
export function hasExclusivePlatformConflict(platforms: readonly SocialPlatform[]): boolean {
  return platforms.includes('plaintext') && platforms.length > 1
}

// Paket 045: die Menge aller Plattformen, die ueberhaupt per OAuth verbunden werden -- Instagram und
// Facebook laufen ueber den Meta-Adapter (MetaOAuthPlatformSchema in channels.ts), Twitter/LinkedIn
// ueber eigene Adapter mit strukturell anderem Flow (PKCE bei Twitter, Organisations-Listing bei
// LinkedIn). Eigenes Schema statt SocialPlatformSchema direkt zu nehmen, weil 'website' (nie OAuth,
// Plan 039) sonst auch hier durchginge -- channelOAuth.ts und PublicationSchema (policy.ts) kennen
// mit diesem Schema 'website' gar nicht erst.
export const OAuthPlatformSchema = z.enum(['instagram', 'facebook', 'twitter', 'linkedin'])
export type OAuthPlatform = z.infer<typeof OAuthPlatformSchema>
