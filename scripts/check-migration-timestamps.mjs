// Jede Migrationsdatei muss einen eindeutigen fuehrenden Zeitstempel-Praefix haben.
//
// Der Grund ist ein realer Produktionsausfall: PR #101 und PR #102 wurden parallel entwickelt und
// vergaben unabhaengig voneinander dieselben Praefixe (2026081801/02/03) fuer denselben Tag. PR #101
// wurde zuerst gemergt und deployed, seine Migrationen waren auf der Produktions-DB bereits
// angewendet. Als das PR-#102-Image spaeter deployte, verweigerte "supabase db push" die
// gleichnummerierten neuen Dateien, weil sie lexikalisch vor bereits angewendeten Migrationen
// einsortierten -- vereinsfunk-api und vereinsfunk-worker crash-loopten in Produktion (503).
// Nebenbei hatte dieselbe Kollision PR #102s Migrationen in jeder lokalen Dev-Datenbank, die PR #101
// zuerst hatte, schon vorher still uebersprungen (kein Fehler, nur fehlende Tabellen).
//
// Geprueft wird nur die Eindeutigkeit des Praefixes vor dem ersten Unterstrich -- das ist genau die
// Form, in der der Fehler auftrat, und sie erfordert keine Datenbankverbindung.
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationsDir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()

const byPrefix = new Map()
for (const name of files) {
  const match = name.match(/^(\d+)_/)
  if (!match) continue
  const prefix = match[1]
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
  byPrefix.get(prefix).push(name)
}

const collisions = [...byPrefix.entries()].filter(([, names]) => names.length > 1)

if (collisions.length > 0) {
  console.error(`\n${collisions.length} Zeitstempel-Praefix(e) werden von mehreren Migrationsdateien geteilt:\n`)
  for (const [prefix, names] of collisions) {
    console.error(`  - ${prefix}: ${names.join(', ')}`)
  }
  console.error(
    '\nZwei Migrationen mit demselben Praefix koennen parallel auf unabhaengigen Branches entstehen,\n' +
    'wenn beide vom selben main-Stand abzweigen. "supabase db push" ordnet Migrationen lexikalisch nach\n' +
    'Dateinamen -- eine Datenbank, die eine der beiden schon angewendet hat, lehnt die andere entweder\n' +
    'ab (Absturz beim Start) oder ueberspringt sie still (fehlende Tabellen). Einen der beiden Praefixe\n' +
    'auf den naechsten freien Zeitstempel anheben, relative Reihenfolge der umbenannten Dateien\n' +
    'zueinander beibehalten.\n',
  )
  process.exit(1)
}

console.log(`Migrations-Zeitstempel: ${files.length} Dateien, alle Praefixe eindeutig`)
