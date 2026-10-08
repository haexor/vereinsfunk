import {
  AssignPlayerboardVeoJerseyResponseSchema,
  PlayerboardVeoConflictSchema,
  PlayerboardVeoLoginResponseSchema,
  PlayerboardVeoMatchSchema,
  PlayerboardVeoStatusSchema,
  PlayerboardVeoSyncAcceptedSchema,
  type AssignPlayerboardVeoJerseyRequest,
  type ResolvePlayerboardVeoConflictRequest,
} from '@vereinsfunk/contracts'
import type { RankingRange } from '../utils/playerboardRanking'

// Paket 053, PR 3: Aufrufe der Veo-Routen. E-Mail und Passwort gehen nur durch login() an die
// API und werden im Browser nicht aufbewahrt.
export function usePlayerboardVeo() {
  const api = useApiClient()

  /** Spiele mit Veo-Werten einer Mannschaft im Zeitraum, neueste zuerst. */
  function loadMatches(teamId: string, range: RankingRange) {
    return api.request(`/v1/playerboard/teams/${teamId}/veo/matches`, { query: { ...range } }, PlayerboardVeoMatchSchema.array())
  }

  /** Verbindungsstatus und letzte Laeufe. */
  function loadStatus(teamId: string) {
    return api.request('/v1/playerboard/veo/status', { query: { teamId } }, PlayerboardVeoStatusSchema)
  }

  /** Meldet sich bei Veo an und liefert die waehlbaren Veo-Mannschaften samt Link-Token. */
  function login(teamId: string, email: string, password: string) {
    return api.request('/v1/playerboard/veo/login', { method: 'POST', body: { teamId, email, password } }, PlayerboardVeoLoginResponseSchema)
  }

  /** Verbindet die Mannschaft mit der gewaehlten Veo-Mannschaft und startet den ersten Abgleich. */
  function link(teamId: string, linkToken: string, veoClubSlug: string, veoTeamSlug: string) {
    return api.request('/v1/playerboard/veo/link', { method: 'POST', body: { teamId, linkToken, veoClubSlug, veoTeamSlug } }, PlayerboardVeoStatusSchema)
  }

  /** Startet einen Abgleich; ein neuer Schluessel je Klick, damit ein Doppelklick nur einen Lauf ergibt. */
  function sync(teamId: string, idempotencyKey: string) {
    return api.request('/v1/playerboard/veo/sync', { method: 'POST', body: { teamId }, headers: { 'idempotency-key': idempotencyKey } }, PlayerboardVeoSyncAcceptedSchema)
  }

  /** Ordnet eine Rueckennummer eines Spiels einem Kader-Eintrag zu (null = offen lassen). */
  function assign(input: AssignPlayerboardVeoJerseyRequest) {
    return api.request('/v1/playerboard/veo/assignments', { method: 'PUT', body: input }, AssignPlayerboardVeoJerseyResponseSchema)
  }

  /** Offene, mehrdeutige Veo-Spiele mit Kandidaten aus dem Spielplan. */
  function loadConflicts(teamId: string) {
    return api.request('/v1/playerboard/veo/conflicts', { query: { teamId } }, PlayerboardVeoConflictSchema.array())
  }

  /** Loest ein mehrdeutiges Spiel auf; ausser beim Ignorieren startet die API gleich einen Abgleich. */
  async function resolveConflict(conflictId: string, input: ResolvePlayerboardVeoConflictRequest) {
    await api.request(`/v1/playerboard/veo/conflicts/${conflictId}/resolve`, { method: 'POST', body: input })
  }

  return { loadMatches, loadStatus, login, link, sync, assign, loadConflicts, resolveConflict }
}
