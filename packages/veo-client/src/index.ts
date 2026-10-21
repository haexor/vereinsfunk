// Paket 053, PR 1: Client fuer Veos inoffizielle Web-API (Anmeldung, Token, Spiele, Statistiken).
// Spec 002: Abrufe fuer die Spielanalyse (analysis.ts, matchReport.ts).
export {
  analyticsVersionOf,
  fetchMatchDetail,
  fetchMatchDetails,
  fetchMatchEvents,
  fetchMomentum,
  fetchPassingNetwork,
  fetchPeriods,
  fetchPlayerHeatmaps,
  fetchProcessingStatus,
  fetchRasStatus,
  fetchTrackingWindow,
  parseMatchDetails,
  parseMatchEvents,
  parsePlayerHeatmaps,
  parseTrackingWindow,
  type VeoAnalyticsVersion,
  type VeoEvent,
  type VeoMatchDetail,
  type VeoPassingNetwork,
  type VeoPassPossessionPeriod,
  type VeoPeriod,
  type VeoPlayerHeatmap,
  type VeoProcessingStatus,
  type VeoRasStatus,
  type VeoSideValues,
  type VeoTrackingSample,
} from './analysis.js'
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
  type VeoPlayerStatCategory,
  type VeoPlayerStats,
  type VeoTeam,
  type VeoTeamStat,
} from './client.js'
export { VeoError, type VeoErrorCode } from './errors.js'
export { fetchMatchReport, parseMatchReport, type VeoMatchReport } from './matchReport.js'
export { VEO_HOSTS, VEO_RAS_HOST, type FetchLike, type VeoHttpOptions } from './http.js'
export { captureSessionViaLogin, type LoginBrowser, type LoginBrowserContext, type LoginLocator, type LoginPage } from './login.js'
