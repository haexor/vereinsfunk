import { describe, expect, it } from 'vitest'
import { brandAnalysisFailureMessage } from './brandAnalysisFailure'

describe('brandAnalysisFailureMessage', () => {
  it.each([
    ['no_vision_provider_configured', 'KI-Anbieter eingerichtet'],
    ['unsupported_provider_configuration', 'KI-Anbieter eingerichtet'],
    ['secret_configuration', 'fehlerhaft konfiguriert'],
    ['provider_secret_encoding', 'fehlerhaft konfiguriert'],
    ['provider_configuration', 'fehlerhaft konfiguriert'],
    ['provider_rate_limit', 'ausgelastet'],
    ['provider_network', 'nicht erreichbar'],
    ['provider_server', 'nicht erreichbar'],
    ['provider_schema', 'keine verwertbare Antwort'],
    ['poll_failed', 'Status der Analyse'],
    ['timeout', 'zu lange gedauert'],
    ['blocked_url', 'Webseite konnte nicht geladen'],
    ['website_unreachable', 'Webseite konnte nicht geladen'],
  ])('maps %s to a specific message', (reason, fragment) => {
    expect(brandAnalysisFailureMessage(reason)).toContain(fragment)
  })

  it('falls back to the generic message for unknown or missing reasons', () => {
    const generic = 'Die Analyse ist fehlgeschlagen. Bitte später erneut versuchen.'
    expect(brandAnalysisFailureMessage('website_analysis_failed')).toBe(generic)
    expect(brandAnalysisFailureMessage(null)).toBe(generic)
  })
})
