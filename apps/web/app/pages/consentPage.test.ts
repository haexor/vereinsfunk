import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Formular- und Ladezustand der Einwilligungsseite -- ohne Seiten-Mount nur im Quelltext
// festzuhalten, dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Einwilligungen', () => {
  it('leert das Datei-Feld nach dem Hinterlegen einer Papiererklaerung', () => {
    const page = readFileSync(join(PAGES_DIR, 'einwilligungen.vue'), 'utf8')

    expect(page).toContain('registerForm.file = null; registerFileInputKey.value += 1')
    const fileInput = page.match(/<input :key="registerFileInputKey" type="file"[^>]*>/)?.[0] ?? ''
    expect(fileInput).not.toContain('required')
  })

  it('laesst den Zweck einer Einwilligung in beiden Formularen waehlen', () => {
    const page = readFileSync(join(PAGES_DIR, 'einwilligungen.vue'), 'utf8')

    // Vorher war der Zweck fest 'social_media': eine ueber die Oberflaeche erfasste Einwilligung
    // konnte nie fuer die Website gelten, PlayerBoard-Fotos blieben deshalb immer intern.
    expect(readFileSync(join(PAGES_DIR, '../utils/consentPurposes.ts'), 'utf8')).toContain("{ value: 'website', label: 'Vereinswebsite' }")
    expect(page).toContain('const purposeOptions = CONSENT_PURPOSE_OPTIONS')
    expect(page).toContain('v-model="registerForm.purposes"')
    expect(page).toContain('v-model="requestForm.purposes"')
    expect(page).toContain('if (registerForm.purposes.length === 0)')
    expect(page).toContain('if (requestForm.purposes.length === 0)')
  })

  it('laesst eine Papiererklaerung als neue Version bearbeiten, ohne ihre uebrigen Einschraenkungen zu verlieren', () => {
    const page = readFileSync(join(PAGES_DIR, 'einwilligungen.vue'), 'utf8')
    const form = readFileSync(join(PAGES_DIR, '../components/ConsentEditForm.vue'), 'utf8')

    // Vorher liess sich eine Einwilligung nur widerrufen -- ein vergessener Zweck "Website" hiess,
    // alles neu zu erfassen. Bearbeiten ist eine Abloesung; die alte Version bleibt bestehen.
    expect(page).toContain("return consent.origin === 'paper' && !consent.revokedAt && !consent.supersededBy")
    expect(page).toContain('<ConsentEditForm v-if="editingId === consent.id"')
    expect(form).toContain('/supersede')
    // Plattformen, Anlaesse und Abteilungen kommen aus der bisherigen Version.
    expect(form).toContain('scopeStructured: { ...original, purposes: form.purposes')
  })

  it('laesst eine veraltete Ladung auch im Fehlerfall nichts mehr schreiben', () => {
    const page = readFileSync(join(PAGES_DIR, 'einwilligungen.vue'), 'utf8')

    // Vorher war nur der Erfolgsweg geschuetzt; eine aeltere, scheiternde Anfrage setzte die
    // Fehlermeldung ueber frische Daten.
    expect(page).toContain('useScopedLoad(')
    expect(page).toContain("if (isLatest()) errorMessage.value = 'Die Einwilligungen konnten nicht geladen werden.'")
    expect(page).toContain('if (isLatest()) loading.value = false')
  })

  it('erklaert einen bereits erfolgten Widerruf und eine nicht mehr offene Anfrage', () => {
    const page = readFileSync(join(PAGES_DIR, 'einwilligungen.vue'), 'utf8')

    // Beide Faelle meldete die Seite vorher nur als allgemeinen Speicherfehler.
    expect(page).toContain("revokeError.value = errorCodeOf(error) === 'already_revoked'")
    expect(page).toContain("requestError.value = errorCodeOf(error) === 'request_not_open'")
  })

  it('setzt das Eingangsdatum einer Betroffenenanfrage auf den heutigen Tag in der Vereinszeitzone', () => {
    const page = readFileSync(join(PAGES_DIR, 'datenschutz/anfragen.vue'), 'utf8')

    // toISOString() ist UTC: zwischen 0 und 2 Uhr deutscher Zeit stand dort der Vortag.
    expect(page).not.toContain('new Date().toISOString().slice(0, 10)')
    expect(page).toContain('receivedAt: localDateKey(new Date(), organizationTimezone.value),')
  })
})
