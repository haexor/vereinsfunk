// Bildet die technischen error_reason-Werte des Workers (apps/worker/src/brandWebsiteAnalysis.ts,
// websiteRenderer.ts, providerSecrets.ts und VisionAnalysisError) auf wenige verständliche Gründe
// ab, statt sie roh anzuzeigen -- siehe Plandokument 048, Abschnitt "Abweichungen". Reine
// Konfigurationsfehler benennen den Betreiber, weil der Verein sie nicht selbst beheben kann.
const OPERATOR_ACTION = 'Bitte den Betreiber informieren.'

export function brandAnalysisFailureMessage(reason: string | null): string {
  switch (reason) {
    case 'timeout':
      return 'Die Analyse hat zu lange gedauert. Bitte erneut versuchen.'
    case 'website_unreachable':
    case 'blocked_url':
      return 'Die Webseite konnte nicht geladen werden. Bitte die Adresse prüfen und erneut versuchen.'
    case 'no_vision_provider_configured':
    case 'unsupported_provider_configuration':
      return `Für die Analyse ist noch kein KI-Anbieter eingerichtet. ${OPERATOR_ACTION}`
    case 'secret_configuration':
    case 'provider_secret_encoding':
    case 'provider_configuration':
      return `Der KI-Anbieter ist fehlerhaft konfiguriert (Zugangsdaten oder Adresse). ${OPERATOR_ACTION}`
    case 'provider_rate_limit':
      return 'Der KI-Anbieter ist gerade ausgelastet. Bitte in einigen Minuten erneut versuchen.'
    case 'provider_network':
    case 'provider_server':
      return 'Der KI-Anbieter ist gerade nicht erreichbar. Bitte später erneut versuchen.'
    case 'provider_schema':
      return `Der KI-Anbieter hat keine verwertbare Antwort geliefert. Bitte erneut versuchen oder den Betreiber informieren.`
    case 'poll_failed':
      return 'Der Status der Analyse konnte nicht abgerufen werden. Bitte die Seite neu laden.'
    default:
      return 'Die Analyse ist fehlgeschlagen. Bitte später erneut versuchen.'
  }
}
