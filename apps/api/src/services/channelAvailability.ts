import type { OAuthPlatform, SocialPlatform } from '@vereinsfunk/contracts'
import { SocialPlatformSchema } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAvailableChannels, type ChannelCandidate, type ScopeLevelName } from '@vereinsfunk/domain'
import { z } from 'zod'
import { parseSupabaseData } from '../supabase.js'
import { scopeLevelOf } from './scopeAuthorization.js'

// maxCharacters bleibt null, wenn fuer die Plattform keine Vorgabezeile existiert: eine fehlende
// Zeile darf die Laenge weder heimlich hochsetzen noch heimlich senken, also entscheidet erst der
// Aufrufer, was ihr Fehlen bedeutet (Anzeige: Fallback, min()-Bildung: nicht mitzaehlen).
export type TextGenerationPlatformResolution = { available: boolean; maxCharacters: number | null; reason?: 'no_channel' | 'restricted_by_policy' }

type ChannelConnectionRow = { id: unknown; status: unknown; archived_at: unknown; responsible_profile_id: unknown }

type ChannelScopeRow = { social_connection_id: unknown; scope: unknown; department_id: unknown; team_id: unknown; can_schedule: unknown }

// Baut die Kandidatenliste, die resolveAvailableChannels erwartet, aus den beiden Rohtabellen.
// Stand wortgleich in routes/channels.ts (Kanalauswahl eines bestehenden Beitrags) und hier --
// zwei Kopien haetten frueher oder later zwei Antworten auf "worauf darf dieser Scope senden".
export function toChannelCandidates(connections: readonly ChannelConnectionRow[], scopeRows: readonly ChannelScopeRow[]): ChannelCandidate[] {
  return connections.map((connection) => ({
    socialConnectionId: connection.id as string,
    status: connection.status as ChannelCandidate['status'],
    archivedAt: connection.archived_at as string | null,
    responsibleProfileId: connection.responsible_profile_id as string | null,
    scopeGrants: scopeRows
      .filter((row) => row.social_connection_id === connection.id)
      .map((row) => ({
        scope: row.scope as ScopeLevelName,
        ...(row.department_id ? { departmentId: row.department_id as string } : {}),
        ...(row.team_id ? { teamId: row.team_id as string } : {}),
        canSchedule: row.can_schedule as boolean,
      })),
  }))
}

// effective_config_snapshot ist jsonb ohne Formgarantie. Eine stille Fehlinterpretation von
// allowedChannelIds als "nicht gesetzt" hiesse "keine Einschraenkung" -- also lieber ein 500.
const ChannelSnapshotSchema = z.object({ config: z.object({ allowedChannelIds: z.array(z.string()).nullable().optional() }).optional() })

// "Auf welche Kanaele darf diese Beitragsfassung eingeplant werden" -- die Anzeige zu
// schedule_publication (2026082504), die die verbindliche Pruefung in SQL traegt. Der Scope folgt
// dem Beitrag: Team, Abteilung oder (department_id null) der Verein. Website-Kanaele sind
// ausgenommen, sie sind noch kein Veroeffentlichungsziel (Plan 039, publications_platform_check).
// platform engt auf eine Plattform ein (Agenten-Vorschlag, services/agentProposalAuthorization.ts).
export async function resolveAvailableChannelIdsForPostVersion(
  client: SupabaseClient,
  target: { organizationId: string; departmentId: string | null; teamId: string | null; effectiveConfigSnapshot: unknown },
  platform?: OAuthPlatform,
): Promise<string[]> {
  let connectionQuery = client.from('social_connections').select('id, status, archived_at, responsible_profile_id').eq('organization_id', target.organizationId).neq('platform', 'website')
  if (platform) connectionQuery = connectionQuery.eq('platform', platform)
  const [connections, scopeRows, policyRow] = await Promise.all([
    connectionQuery,
    client.from('channel_scopes').select('social_connection_id, scope, department_id, team_id, can_schedule').eq('organization_id', target.organizationId),
    client.from('policy_settings').select('require_channel_responsible').eq('organization_id', target.organizationId).eq('scope', 'organization').maybeSingle(),
  ])
  if (connections.error) throw connections.error
  if (scopeRows.error) throw scopeRows.error
  if (policyRow.error) throw policyRow.error
  const snapshot = parseSupabaseData(ChannelSnapshotSchema, target.effectiveConfigSnapshot)
  return resolveAvailableChannels({
    scope: scopeLevelOf(target),
    ...(target.departmentId ? { departmentId: target.departmentId } : {}),
    ...(target.teamId ? { teamId: target.teamId } : {}),
    channels: toChannelCandidates(connections.data, scopeRows.data),
    allowedChannelIds: snapshot.config?.allowedChannelIds ?? null,
    requireChannelResponsible: policyRow.data?.require_channel_responsible ?? false,
  })
}

// Plan 042, PR 3 Step 3: "auf welchen Plattformen darf dieser Scope ueberhaupt veroeffentlichen"
// -- dieselbe Frage, die routes/channels.ts's GET /v1/post-versions/:id/available-channels fuer
// einen bestehenden Beitrag beantwortet, hier aber vor der Erzeugung und je Plattform statt je
// Kanal-ID. Zwei Aufloesungen, um "kein Kanal eingerichtet" von "ein Kanal existiert, ist aber per
// Richtlinie ausgeschlossen" zu unterscheiden -- beides fuehrt sonst ununterscheidbar zu "nicht
// verfuegbar". Die Vergleichsaufloesung laesst BEIDE Richtlinien fallen (allowedChannelIds und
// require_channel_responsible): ein Kanal ohne eingetragene verantwortliche Person ist per
// Richtlinie ausgeschlossen, nicht "nicht eingerichtet" -- sonst schickt der Hinweistext einen
// Verein einen zweiten Kanal anlegen, statt die Person einzutragen (Review dieses PRs).
export async function resolveTextGenerationPlatformAvailability(
  client: SupabaseClient, organizationId: string, departmentId: string | null, teamId: string | null, allowedChannelIds: readonly string[] | null,
): Promise<Map<SocialPlatform, TextGenerationPlatformResolution>> {
  const [connections, scopeRows, policyRow, platformDefaults] = await Promise.all([
    client.from('social_connections').select('id, platform, status, archived_at, responsible_profile_id, max_characters').eq('organization_id', organizationId),
    client.from('channel_scopes').select('social_connection_id, scope, department_id, team_id, can_schedule').eq('organization_id', organizationId),
    client.from('policy_settings').select('require_channel_responsible').eq('organization_id', organizationId).eq('scope', 'organization').maybeSingle(),
    client.from('text_generation_platform_defaults').select('platform, max_characters'),
  ])
  if (connections.error) throw connections.error
  if (scopeRows.error) throw scopeRows.error
  if (policyRow.error) throw policyRow.error
  if (platformDefaults.error) throw platformDefaults.error

  const targetScope = scopeLevelOf({ departmentId, teamId })
  const requireChannelResponsible = policyRow.data?.require_channel_responsible ?? false
  const maxCharactersByPlatform = new Map(platformDefaults.data.map((row) => [row.platform as SocialPlatform, row.max_characters as number]))
  // Plan 039, PR 1 Step 3: je Kanal eine eigene Laengengrenze (social_connections.max_characters).
  const maxCharactersByConnectionId = new Map(connections.data.map((row) => [row.id as string, row.max_characters as number | null]))

  const result = new Map<SocialPlatform, TextGenerationPlatformResolution>()
  const scopeInput = { scope: targetScope, ...(departmentId ? { departmentId } : {}), ...(teamId ? { teamId } : {}) }
  for (const platform of SocialPlatformSchema.options) {
    // 'plaintext' hat strukturell nie einen Kanal (primitives.ts) -- immer verfuegbar, ohne
    // social_connections/channel_scopes ueberhaupt zu befragen.
    if (platform === 'plaintext') {
      result.set(platform, { available: true, maxCharacters: maxCharactersByPlatform.get(platform) ?? null })
      continue
    }
    const candidates = toChannelCandidates(connections.data.filter((connection) => connection.platform === platform), scopeRows.data)
    const withoutPolicies = resolveAvailableChannels({ ...scopeInput, channels: candidates, allowedChannelIds: null, requireChannelResponsible: false })
    const withPolicies = resolveAvailableChannels({ ...scopeInput, channels: candidates, allowedChannelIds, requireChannelResponsible })
    const platformDefault = maxCharactersByPlatform.get(platform) ?? null
    // Kleinste, nicht erste: stehen einem Scope zwei Kanaele derselben Plattform mit
    // unterschiedlicher eigener Grenze zur Verfuegung, muss ein Text auf beiden erscheinen koennen.
    // Ein Kanal ohne eigenen Wert geht mit der globalen Plattform-Vorgabe als seinem Kandidaten in
    // dieselbe Minimumbildung ein -- er faellt nicht aus der min() heraus, nur weil er selbst null
    // traegt (sonst zoege eine fehlende Kanal-Grenze eine hoeher gesetzte Vorgabe faelschlich herab).
    // Die globale Vorgabe ist Deckel, nicht nur Ersatzwert (Review dieses PRs): sie beschreibt bei
    // Instagram/Facebook die tatsaechliche Grenze der fremden Plattform, und die kann ein Verein
    // nicht durch einen eigenen Kanalwert anheben -- ein 10000-Zeichen-Instagram-Text waere beim
    // Veroeffentlichen schlicht unbrauchbar. Nach unten bleibt der Kanalwert frei: kuerzer als die
    // Plattform erlaubt darf jeder Kanal sein, laenger nicht. Fehlt eine Vorgabezeile
    // (platformDefault null), gilt allein der Kanalwert -- dann gibt es nichts zu deckeln.
    const perChannelLimits = withPolicies
      .map((socialConnectionId) => {
        const channelLimit = maxCharactersByConnectionId.get(socialConnectionId) ?? null
        if (channelLimit === null) return platformDefault
        return platformDefault === null ? channelLimit : Math.min(channelLimit, platformDefault)
      })
      .filter((limit): limit is number => limit !== null)
    const maxCharacters = withPolicies.length > 0 ? (perChannelLimits.length > 0 ? Math.min(...perChannelLimits) : null) : platformDefault
    result.set(platform, withPolicies.length > 0
      ? { available: true, maxCharacters }
      : { available: false, maxCharacters, reason: withoutPolicies.length > 0 ? 'restricted_by_policy' : 'no_channel' })
  }
  return result
}
