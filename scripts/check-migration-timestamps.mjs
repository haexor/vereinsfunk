// Jede Migrationsdatei muss einen eindeutigen fuehrenden Zeitstempel-Praefix haben, und jede fuer
// diesen Branch neue Migration muss nach der zuletzt auf origin/main vorhandenen einsortieren.
//
// Der Grund fuer die Eindeutigkeitspruefung ist ein realer Produktionsausfall: PR #101 und PR #102
// wurden parallel entwickelt und vergaben unabhaengig voneinander dieselben Praefixe
// (2026081801/02/03) fuer denselben Tag. PR #101 wurde zuerst gemergt und deployed, seine
// Migrationen waren auf der Produktions-DB bereits angewendet. Als das PR-#102-Image spaeter
// deployte, verweigerte "supabase db push" die gleichnummerierten neuen Dateien, weil sie
// lexikalisch vor bereits angewendeten Migrationen einsortierten -- vereinsfunk-api und
// vereinsfunk-worker crash-loopten in Produktion (503). Nebenbei hatte dieselbe Kollision PR #102s
// Migrationen in jeder lokalen Dev-Datenbank, die PR #101 zuerst hatte, schon vorher still
// uebersprungen (kein Fehler, nur fehlende Tabellen).
//
// Die Eindeutigkeitspruefung allein reicht nicht: PR #111 (2026-08-19) zweigte vor PR #110 ab und
// vergab eigene, untereinander eindeutige Praefixe (2026081902/03) -- aber PR #110
// (2026081910-14) mergte zuerst und war auf haex.space bereits angewendet, als PR #111s Image
// deployte. "supabase db push" lehnte PR #111s Migrationen exakt wie beim ersten Vorfall ab. Die
// zweite Pruefung unten faengt das ab, indem sie neue Dateien (die es auf origin/main noch nicht
// gibt) gegen den hoechsten dort bereits vorhandenen Praefix vergleicht.
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
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

// '||' statt '??': images.yml setzt die Variable in Faellen, wo sie nicht gilt (Tag-Push,
// workflow_dispatch), auf einen leeren String statt sie wegzulassen -- der soll denselben
// Fallback wie "gar nicht gesetzt" nehmen.
const baseRef = process.env.MIGRATION_CHECK_BASE_REF || 'origin/main'

function migrationsAtRef(ref) {
  try {
    execFileSync('git', ['fetch', '--quiet', '--depth=1', 'origin', '+refs/heads/main:refs/remotes/origin/main'], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    const output = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', 'supabase/migrations'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return new Set(output.split('\n').filter(Boolean).map((path) => path.split('/').pop()))
  } catch {
    return null
  }
}

const baseFiles = migrationsAtRef(baseRef)

if (baseFiles === null) {
  console.warn(`Warnung: "${baseRef}" nicht aufloesbar (kein Netzwerk/Remote?) -- Reihenfolge-Check gegen den Zielbranch wird uebersprungen.`)
} else {
  const basePrefixes = [...baseFiles].map((name) => name.match(/^(\d+)_/)?.[1]).filter(Boolean).sort()
  const maxBasePrefix = basePrefixes.at(-1)
  const newFiles = files.filter((name) => !baseFiles.has(name))
  const outOfOrder = maxBasePrefix
    ? newFiles.filter((name) => {
        const prefix = name.match(/^(\d+)_/)?.[1]
        return prefix !== undefined && prefix <= maxBasePrefix
      })
    : []

  if (outOfOrder.length > 0) {
    console.error(
      `\n${outOfOrder.length} neue Migration(en) sortieren vor oder gleich der letzten auf "${baseRef}" ` +
      `bereits vorhandenen Migration (${maxBasePrefix}):\n`,
    )
    for (const name of outOfOrder) console.error(`  - ${name}`)
    console.error(
      `\nDer eigene Branch ist vor einem parallel gemergten Branch abgezweigt, dessen Migrationen einen\n` +
      'hoeheren Praefix bekamen und bereits auf main sind. "supabase db push" lehnt neue Migrationen ab,\n' +
      'die lexikalisch vor bereits angewendeten einsortieren -- das crash-loopt vereinsfunk-api und\n' +
      `vereinsfunk-worker in Produktion. Die betroffenen Praefixe auf den naechsten freien Zeitstempel\n` +
      `nach ${maxBasePrefix} anheben, relative Reihenfolge zueinander beibehalten.\n`,
    )
    process.exit(1)
  }
}

console.log(`Migrations-Zeitstempel: ${files.length} Dateien, alle Praefixe eindeutig und in Reihenfolge zu ${baseRef}`)
