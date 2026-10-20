import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Gelingt die eigentliche Aktion und scheitert nur das anschliessende Nachladen, darf die Seite die
// Aktion nicht als gescheitert melden. Ohne Seiten-Mount nur im Quelltext festzuhalten -- dieselbe
// Bauart wie targetPlatformDefaults.test.ts.
describe('Aktualisierung nach einer Aktion', () => {
  it('legt eine verarbeitete Nachricht nicht als unverarbeitet in das Eingabefeld zurueck', () => {
    const page = readFileSync(join(PAGES_DIR, 'assistent.vue'), 'utf8')

    // Ein erneutes Senden verdoppelte Nachricht und Agentenlauf.
    expect(page).toContain('if (!isCurrent()) return\n    delivered = true')
    expect(page).toContain("if (delivered) {\n      errorMessage.value = 'Die Nachricht wurde verarbeitet")
    expect(page).toContain("} else {\n      prompt.value = content\n      errorMessage.value = 'Die Nachricht konnte nicht verarbeitet werden. Es wurde keine Aktion ausgeführt.'")
  })

  it('meldet einen bestaetigten Vorschlag nicht als unbestaetigt, wenn nur das Nachladen scheitert', () => {
    const page = readFileSync(join(PAGES_DIR, 'assistent.vue'), 'utf8')

    expect(page).toContain('const updated = await api.request(`/v1/agent/action-proposals/${proposal.id}/${action}`')
    expect(page).toContain('executed = true\n    proposals.value = proposals.value.map((entry) => (entry.id === updated.id ? updated : entry))')
    expect(page).toContain("'Die Aktion wurde bestätigt, die Übersicht konnte aber nicht aktualisiert werden.")
  })

  it('meldet einen ausgefuehrten Loeschlauf nicht als fehlgeschlagen, wenn nur die Loeschliste scheitert', () => {
    const page = readFileSync(join(PAGES_DIR, 'einstellungen/recht.vue'), 'utf8')

    expect(page).toContain('runWasDry.value = dryRun\n    ran = true')
    expect(page).toContain("runError.value = ran ? 'Der Lauf wurde ausgeführt, die Löschliste konnte aber nicht aktualisiert werden.")
  })
})
