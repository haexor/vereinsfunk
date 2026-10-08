// Paket 053, PR 1: Client fuer Veos inoffizielle Web-API (Anmeldung, Token, Spiele, Statistiken).
export { exchangeSessionCookieForToken, type VeoAccessToken } from './auth.js'
export {
  CURATED_PLAYER_STATS,
  fetchPlayerStats,
  fetchTeamStats,
  listClubTeams,
  listMatches,
  listOwnClubs,
  parseMatchList,
  parsePlayerStats,
  parseTeamStats,
  type VeoClub,
  type VeoMatch,
  type VeoPlayerStats,
  type VeoTeam,
  type VeoTeamStat,
} from './client.js'
export { VeoError, type VeoErrorCode } from './errors.js'
export { VEO_HOSTS, type FetchLike, type VeoHttpOptions } from './http.js'
export { captureSessionViaLogin, type LoginBrowser, type LoginBrowserContext, type LoginLocator, type LoginPage } from './login.js'
