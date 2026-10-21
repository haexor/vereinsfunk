import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Ablauf- und Reihenfolgefragen der Textwerkstatt, die sich ohne Seiten-Mount nur im Quelltext
// festhalten lassen -- dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Textwerkstatt-Entwurf', () => {
  it('begrenzt das Freitextfeld auf die Laenge, die der Werkstatt-Entwurf speichern kann', () => {
    const page = readFileSync(join(PAGES_DIR, 'erstellen.vue'), 'utf8')

    // Vorher erlaubte das Feld 10.000 Zeichen, der Entwurfsvertrag aber nur 5.000 -- die vor jeder
    // Generierung verpflichtende Speicherung scheiterte und blockierte die Generierung.
    expect(page).not.toContain('maxlength="10000"')
    expect(page).toContain('const CONTENT_TEXT_MAX_LENGTH = TextWorkshopDraftPayloadSchema.shape.observation.maxLength')
    expect(page).toContain(':maxlength="CONTENT_TEXT_MAX_LENGTH"')
    expect(page).toContain('if (contentText.value.length > CONTENT_TEXT_MAX_LENGTH)')
  })

  it('legt nach dem Einreichen beim Verlassen der Seite keinen neuen Entwurf an', () => {
    const page = readFileSync(join(PAGES_DIR, 'erstellen.vue'), 'utf8')

    // acceptCandidate setzt serverDraftId zurueck, behaelt aber den Formularinhalt -- ohne die
    // Sperre speicherte onBeforeRouteLeave ihn unter einer frischen UUID als verwaisten Entwurf.
    expect(page).toContain("RequestApprovalResponseSchema)\n      submittedForApproval = true\n      clearDraft()\n      serverDraftId.value = null\n      await navigateTo('/beitraege')")
    expect(page).toContain('if (submittedForApproval || restoringDraft || !scope.value?.organizationId')
    expect(page).toContain('if (submittedForApproval || restoringDraft || !hasDraftContent()) return')
    expect(page).toContain('onBeforeRouteLeave(async () => { await saveServerDraft() })')
  })

  it('verwirft eine Sitzungsantwort, deren Sitzung inzwischen ersetzt wurde', () => {
    const page = readFileSync(join(PAGES_DIR, 'erstellen.vue'), 'utf8')

    // Nach einem Bereichswechsel (sessionId = null) schrieb eine noch laufende Poll-Antwort den
    // alten Kandidaten zurueck; der Poll lief dann unbegrenzt weiter.
    expect(page).toContain('const requestedSessionId = sessionId.value')
    expect(page).toContain('/v1/text-workshop/sessions/${requestedSessionId}')
    expect(page).toContain('if (sessionId.value !== requestedSessionId) return\n  sessionProfile.value =')
  })

  it('erklaert, warum eine ueberholte Fassung nicht zur Freigabe eingereicht werden kann', () => {
    const page = readFileSync(join(PAGES_DIR, 'erstellen.vue'), 'utf8')

    // request-approval lehnt eine nicht mehr aktuelle Fassung mit 409 version_not_current ab.
    expect(page).toContain("version_not_current: 'Inzwischen gibt es eine neuere Fassung dieses Beitrags.")
    expect(page).toContain('notice.value = REQUEST_APPROVAL_ERROR_MESSAGES[code] ??')
  })

  // Kalender und Anlassvorschlaege verlinkten schon auf ?fixtureId=/?clubEventId=, die Seite
  // ignorierte beides und zeigte ein leeres Formular.
  it('startet aus einem Termin-Link einen neuen Beitrag mit dem Termin statt den letzten Entwurf', () => {
    const page = readFileSync(join(PAGES_DIR, 'erstellen.vue'), 'utf8')

    expect(page).toContain('const linkedOccasion = occasionReferenceFromQuery(route.query)')
    expect(page).toContain("else if (linkedOccasion && linkedOccasion !== 'invalid') {")
    expect(page).toContain('if (occasion.value) communicationGoal.value = occasion.value.suggestedGoal')
    expect(page).toContain('<TextWorkshopOccasion v-if="occasion" :occasion="occasion" :timezone="organizationTimezone" @remove="clearOccasion" />')
  })

  it('erzeugt aus den Fakten des Termins auch ohne eigenen Text und behaelt den Termin im Entwurf', () => {
    const page = readFileSync(join(PAGES_DIR, 'erstellen.vue'), 'utf8')

    expect(page).toContain("if (!contentText.value.trim() && !Object.keys(occasionFacts.value).length)")
    expect(page).toContain('return { facts: { ...occasionFacts.value }, observations, quotes: [] }')
    expect(page).toContain('targetPlatforms: selectedPlatforms.value, ...occasionReference(occasion.value),')
    expect(page).toContain("maxCharactersOverride: String(maxCharactersOverride.value), ...occasionReference(occasion.value) }")
    // Ein nur geoeffneter Termin-Link legt beim Verlassen keinen Entwurf an.
    expect(page).toContain('const hasContent = hasDraftContent() || ((explicit || required) && occasion.value !== null)')
  })
})
